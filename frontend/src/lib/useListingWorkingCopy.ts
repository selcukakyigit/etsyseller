"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ListingEdit, Personalization, PublishResult, VariationImage, WorkingCopy } from "./api";

export type SaveState = "idle" | "saving" | "saved" | "error";

function build(edit: ListingEdit, variationImages: VariationImage[], personalization: Personalization | null): WorkingCopy {
  return {
    ...edit,
    personalization,
    managed_property_ids: [],
    variation_links: {
      property_id: variationImages[0]?.property_id ?? null,
      images: Object.fromEntries(variationImages.filter((v) => v.value).map((v) => [v.value as string, v.image_id])),
    },
  };
}

const sig = (v: WorkingCopy | null) => (v ? JSON.stringify(v) : "");

/** Eski sürümde kaydedilmiş tek-soruluk kişiselleştirme biçimini (enabled/instructions…) Etsy'deki güncel
 * sorularla değiştirir; aksi halde yayında var olan diğer sorular silinirdi. */
function migrate(saved: WorkingCopy | null, live: WorkingCopy): WorkingCopy | null {
  if (!saved) return null;
  const p = saved.personalization as unknown as { questions?: unknown } | null;
  if (p && !Array.isArray(p.questions)) return { ...saved, personalization: live.personalization };
  return saved;
}

/**
 * Listing düzenleme durumu; üç ayrı kayıt eylemi vardır:
 *  - saveLocal()  "Kaydet": yerel listing'e yazar (liste sayfası bunu gösterir, Etsy'ye gitmez)
 *  - saveDraft()  "Taslak kaydet": ara kayıt; listeyi değiştirmez, editör tekrar açılınca geri gelir
 *  - publish()    "Etsy'de yayınla": yerel sürümü Etsy'ye uygular
 * `live` = Etsy'deki hâl, `local` = kaydedilmiş yerel sürüm (yoksa null), `work` = ekrandaki form.
 */
export function useListingWorkingCopy(shopId: number | undefined, listingId: number) {
  const [live, setLive] = useState<WorkingCopy | null>(null);
  const [local, setLocal] = useState<WorkingCopy | null>(null);
  const [localAt, setLocalAt] = useState<string | null>(null);
  const [work, setWork] = useState<WorkingCopy | null>(null);
  const [draft, setDraft] = useState<WorkingCopy | null>(null);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [version, setVersion] = useState(0); // bölümleri yeniden başlatmak için (yayın/atma sonrası)

  const base = local ?? live;
  /** Son Kaydet'ten (yoksa Etsy'den) beri kaydedilmemiş değişiklik var mı. */
  const unsaved = !!base && !!work && sig(base) !== sig(work);
  /** Ekrandaki form taslağa kaydedilmiş hâliyle aynı mı. */
  const draftCurrent = !!draft && sig(draft) === sig(work);
  const hasLocal = local !== null;
  const hasDraft = draft !== null;

  const fetchAll = useCallback(async () => {
    if (shopId === undefined) return null;
    const [edit, vimages, pers, localRes, draftRes] = await Promise.all([
      api.listings.getEdit(shopId, listingId),
      api.listings.variationImages(shopId, listingId).catch(() => [] as VariationImage[]),
      api.listings.getPersonalization(shopId, listingId).catch(() => null),
      api.listings.getLocal(shopId, listingId),
      api.listings.getDraft(shopId, listingId),
    ]);
    return { live: build(edit, vimages, pers), local: localRes, draft: draftRes };
  }, [shopId, listingId]);

  const apply = useCallback((data: Awaited<ReturnType<typeof fetchAll>>) => {
    if (!data) return;
    const localData = migrate(data.local.exists ? data.local.data : null, data.live);
    const draftData = migrate(data.draft.exists ? data.draft.data : null, data.live);
    setError(null);
    setLive(data.live);
    setLocal(localData);
    setLocalAt(data.local.updated_at);
    setDraft(draftData);
    setDraftAt(data.draft.updated_at);
    setWork(draftData ?? localData ?? data.live);
    setSaveState("idle");
    setVersion((v) => v + 1);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await fetchAll());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    }
  }, [fetchAll, apply]);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then((data) => !cancelled && apply(data))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
    return () => {
      cancelled = true;
    };
  }, [fetchAll, apply]);

  // Kaydedilmemiş değişiklikle sekme kapatılırsa tarayıcı uyarsın.
  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);

  const patch = useCallback((fields: Partial<WorkingCopy>) => {
    setWork((prev) => (prev ? { ...prev, ...fields } : prev));
    setSaveState("idle");
  }, []);

  /** Bir özelliği (attribute) formda değiştirir; null = Etsy'den kaldırılacak. */
  const setProperty = useCallback((propertyId: number, value: { value_ids: number[]; values: string[]; scale_id: number | null } | null) => {
    setWork((prev) => {
      if (!prev) return prev;
      const others = prev.properties.filter((p) => p.property_id !== propertyId);
      const existing = prev.properties.find((p) => p.property_id === propertyId);
      const next = value
        ? [...others, { property_id: propertyId, property_name: existing?.property_name ?? "", ...value }]
        : others;
      return {
        ...prev,
        properties: next,
        managed_property_ids: prev.managed_property_ids.includes(propertyId)
          ? prev.managed_property_ids
          : [...prev.managed_property_ids, propertyId],
      };
    });
    setSaveState("idle");
  }, []);

  /** Bir görsel yeni bir görselle değiştiğinde varyasyon fotoğraf bağlarını da taşır. */
  const remapImageRefs = useCallback((oldId: number, newId: number) => {
    setWork((prev) => {
      if (!prev) return prev;
      const images = Object.fromEntries(
        Object.entries(prev.variation_links.images).map(([name, id]) => [name, id === oldId ? newId : id])
      );
      return { ...prev, variation_links: { ...prev.variation_links, images } };
    });
  }, []);

  /** "Kaydet": formu yerel listing'e yazar. Etsy ile aynıysa yerel sürüm gereksizdir, silinir. */
  async function saveLocal(): Promise<boolean> {
    if (shopId === undefined || !work || !live) return false;
    setSaveState("saving");
    try {
      if (sig(work) === sig(live) && listingId > 0) {  // yeni (negatif kimlikli) listing'in Etsy karşılığı yok; silinmez
        await api.listings.discardLocal(shopId, listingId);
        setLocal(null);
        setLocalAt(null);
      } else {
        const res = await api.listings.saveLocal(shopId, listingId, work, live);
        setLocal(work);
        setLocalAt(res.updated_at);
      }
      setDraft(null); // sunucu kaydederken taslağı siler
      setDraftAt(null);
      setSaveState("saved");
      return true;
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Kaydedilemedi");
      return false;
    }
  }

  /** "Taslak kaydet": listeyi değiştirmeden ara kayıt alır. */
  async function saveDraft() {
    if (shopId === undefined || !work) return;
    setSaveState("saving");
    try {
      const res = await api.listings.saveDraft(shopId, listingId, work);
      setDraft(work);
      setDraftAt(res.updated_at);
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Taslak kaydedilemedi");
    }
  }

  /** "Etsy'de yayınla": önce formu yerel sürüme kaydeder, sonra Etsy'ye uygular. */
  async function publish(force = false): Promise<PublishResult | null> {
    if (shopId === undefined || !work) return null;
    setPublishing(true);
    setError(null);
    try {
      if (unsaved && !(await saveLocal())) return null;
      const result = await api.listings.publishLocal(shopId, listingId, force);
      if (result.ok) await load();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yayınlanamadı");
      return null;
    } finally {
      setPublishing(false);
    }
  }

  /** Yerel değişiklikleri ve taslağı atar; listing Etsy'deki hâline döner. */
  async function discard() {
    if (shopId === undefined) return;
    await api.listings.discardLocal(shopId, listingId);
    await load();
  }

  return {
    live,
    work,
    unsaved,
    hasLocal,
    hasDraft,
    draftCurrent,
    localAt,
    draftAt,
    saveState,
    error,
    publishing,
    version,
    patch,
    setProperty,
    remapImageRefs,
    saveLocal,
    saveDraft,
    publish,
    discard,
    reload: load,
  };
}

export type ListingWorkingCopy = ReturnType<typeof useListingWorkingCopy>;

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, BulkChanges, FadedInfo, FadedListings, Listing, RanksSummary, ShopAttention } from "@/lib/api";
import { onRanksChanged } from "@/lib/syncEvents";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import { useIncrementalList } from "@/lib/useIncrementalList";
import AppShell from "@/components/AppShell";
import ListingRow from "@/components/ListingRow";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { onPublishFinished, startPublish, usePublishJobs } from "@/lib/publishJobs";
import ListingCard, { CardAction } from "@/components/listings/ListingCard";
import ListingPreviewModal from "@/components/listings/ListingPreviewModal";
import BulkEditModal, { BulkOp } from "@/components/listings/BulkEditModal";
import ListingAnalysisPanel from "@/components/listings/analysis/ListingAnalysisPanel";
import { Modal, btnGhost } from "@/components/listing-editor/Modal";
import { ReconnectNotice, isPermissionError } from "@/components/shipping/shared";
import ListingFilters, { applyFilters, EMPTY_FILTERS, Filters, Reference } from "@/components/listings/ListingFilters";
import ListingsToolbar, { ListingSort } from "@/components/listings/ListingsToolbar";
import SelectionBar from "@/components/listings/SelectionBar";
import { useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";
import { useStoredState } from "@/lib/useStoredState";
import { PageSpinner, Spinner } from "@/components/ui/Spinner";
import { useResponsiveFilters } from "@/components/ui/ResponsiveFilters";
import { changedCount } from "@/lib/filters";

type PublishOutcome = { id: number; title: string; ok: boolean; error?: string; updated?: string[]; warnings?: string[] };

const SYNC_POLL_INTERVAL_MS = 3000;
const EMPTY_REFERENCE: Reference = { sections: [], shipping: [], returns: [], partners: [] };
const DEFAULT_FILTERS: Filters = { ...EMPTY_FILTERS, status: "active" };
const STALE_AFTER_MS = 5 * 60 * 60 * 1000; // 5 saat: 6 saatlik sınırın altında kal

export default function Home() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  const cacheShopId = activeShop?.id;
  const [listings, setListings] = useCached<Listing[]>(cacheShopId !== undefined ? `listings:${cacheShopId}` : null);
  const [bootstrapSyncing, setBootstrapSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useStoredState<ListingSort>("listings.sort", "ending");
  const [view, setView] = useStoredState<"grid" | "list">("listings.view", "grid", ["grid", "list"]);
  const [cachedReference, setReference] = useCached<Reference>(cacheShopId !== undefined ? `listing-reference:${cacheShopId}` : null);
  const reference = cachedReference ?? EMPTY_REFERENCE;
  const [publishingIds, setPublishingIds] = useState<Set<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const jobs = usePublishJobs();
  const [bulk, setBulk] = useState<{ total: number; results: PublishOutcome[]; running: boolean } | null>(null);

  const loadListings = useCallback(() => {
    if (!activeShop) return;
    api.listings
      .list(activeShop.id)
      .then(setListings)
      .catch((e) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShop, setListings]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  // Arka planda süren bir yayın bitince (editörden başlatılmış olabilir) liste kendini yeniler.
  useEffect(() => onPublishFinished(() => loadListings()), [loadListings]);

  // Önbellek bayatsa sessizce yenile. Etsy kuralı: ilan verisi en fazla 6 saat eski gösterilebilir; sunucu 4 saatte bir
  // kendi yeniler, bu da sayfayı uzun süre sonra açan (ya da sunucu işinin kaçırıldığı) durumlar için ikinci güvence.
  // Yenileme sürerken eski liste görünmeye devam eder; bitince liste tazelenir.
  const shopIdForStale = activeShop?.id;
  const hasListings = (listings?.length ?? 0) > 0;
  useEffect(() => {
    if (!shopIdForStale || !hasListings) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        const status = await api.listings.syncStatus(shopIdForStale);
        if (cancelled || status.syncing) return;
        const last = status.last_synced_at ? Date.parse(`${status.last_synced_at}Z`) : 0; // sunucu UTC, saat dilimi eki yok
        if (Date.now() - last < STALE_AFTER_MS) return;
        await api.listings.sync(shopIdForStale);
        timer = setInterval(async () => {
          try {
            const s = await api.listings.syncStatus(shopIdForStale);
            if (!s.syncing) {
              clearInterval(timer);
              if (!cancelled) loadListings();
            }
          } catch {
            // ağ hatası: bir sonraki tikte tekrar dener
          }
        }, SYNC_POLL_INTERVAL_MS);
      } catch {
        // sessiz arka plan yenilemesi: hata kullanıcıyı rahatsız etmesin
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [shopIdForStale, hasListings, loadListings]);

  // Listing'ler hiç senkronize edilmemişse (mağaza yeni bağlandığında cache
  // boştur) arka planda bir kerelik senkronizasyon başlat ve bitene kadar
  // durumu göster — sayfayı 3 dakika bloklamak yerine.
  useEffect(() => {
    if (!activeShop || listings === null || listings.length > 0) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    function pollUntilDone() {
      interval = setInterval(async () => {
        try {
          const status = await api.listings.syncStatus(activeShop!.id);
          if (cancelled) return;
          if (!status.syncing) {
            clearInterval(interval);
            setBootstrapSyncing(false);
            loadListings();
          }
        } catch {
          // ağ hatası — bir sonraki tikte tekrar dener
        }
      }, SYNC_POLL_INTERVAL_MS);
    }

    async function ensureSynced() {
      try {
        const status = await api.listings.syncStatus(activeShop!.id);
        if (cancelled) return;
        if (status.syncing) {
          setBootstrapSyncing(true);
          pollUntilDone();
        } else if (status.last_synced_at === null) {
          await api.listings.sync(activeShop!.id);
          if (cancelled) return;
          setBootstrapSyncing(true);
          pollUntilDone();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
      }
    }

    ensureSynced();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShop, listings, loadListings]);

  // Filtre paneli için Etsy referans verileri (sunucuda önbellekli). Bölümler modalinde ekle/sil/yeniden
  // adlandır sonrası da çağrılır ki filtre listesi hemen tazelensin.
  const loadReference = useCallback(() => {
    if (!activeShop) return;
    const id = activeShop.id;
    Promise.all([
      api.shops.sections(id).catch(() => []),
      api.shops.shippingProfiles(id).catch(() => []),
      api.shops.returnPolicies(id).catch(() => []),
      api.shops.productionPartners(id).catch(() => []),
    ]).then(([sections, shipping, returns, partners]) => setReference({ sections, shipping, returns, partners }));
  }, [activeShop, setReference]);

  useEffect(() => {
    loadReference();
  }, [loadReference]);

  const [editModal, setEditModal] = useState<{ ids: number[]; only?: BulkOp } | null>(null);
  const [stageMsg, setStageMsg] = useState<{ text: string; errors: { title: string; error: string }[] } | null>(null);
  const [statsFor, setStatsFor] = useState<Listing | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  /** Toplu/tekil değişiklikleri yerel sürümlere işler (Etsy'ye gitmez); sonucu özetler. */
  async function stage(ids: number[], changes: BulkChanges) {
    if (!activeShop) return;
    const res = await api.listings.bulkStage(activeShop.id, ids, changes);
    const byId = new Map((listings ?? []).map((l) => [l.listing_id, l]));
    const errors = res.filter((r) => !r.ok).map((r) => ({ title: byId.get(r.id)?.title ?? String(r.id), error: r.error ?? t("Hata", "Error") }));
    const changed = res.filter((r) => r.ok && r.changed).length;
    setStageMsg({
      text: t(
        `${changed} listing yerelde hazırlandı${errors.length ? `, ${errors.length} listing hatalı` : ""}. Etsy'ye göndermek için "Etsy'de yayınla" de.`,
        `${changed} listings prepared locally${errors.length ? `, ${errors.length} failed` : ""}. Use "Publish to Etsy" to send them to Etsy.`,
      ),
      errors,
    });
    loadListings();
  }

  async function changeState(items: Listing[], state: "active" | "inactive", renew = false) {
    const verb = renew ? "yenilensin" : state === "active" ? "aktif edilsin" : "pasife alınsın";
    const verbEn = renew ? "Renew" : state === "active" ? "Activate" : "Deactivate";
    const ok = await confirm({
      title: t(`${items.length} listing ${verb} mi?`, `${verbEn} ${items.length} listings?`),
      message: renew
        ? t(
            "Süresi dolmuş/tükenmiş listing'ler yeniden aktif edilir; Etsy yenileme için listing ücreti (0,20 $) alır ve tükenmiş olanların stoğu 1 olur. Değişiklik yerelde hazırlanır, ücret ancak \"Etsy'de yayınla\" deyince alınır.",
            "Expired or sold-out listings become active again; Etsy charges the listing fee ($0.20) to renew, and sold-out ones get a quantity of 1. The change is prepared locally; the fee is only charged when you use \"Publish to Etsy\".",
          )
        : t("Değişiklik yerelde hazırlanır; Etsy'ye \"Etsy'de yayınla\" deyince gider.", "The change is prepared locally and goes to Etsy when you use \"Publish to Etsy\"."),
      confirmLabel: renew ? t("Yenile", "Renew") : state === "active" ? t("Aktif et", "Activate") : t("Pasife al", "Deactivate"),
    });
    if (!ok) return;
    setBusyAction(true);
    try {
      await stage(items.map((l) => l.listing_id), { state });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
    } finally {
      setBusyAction(false);
    }
  }

  async function deleteListings(items: Listing[]) {
    if (!activeShop || items.length === 0) return;
    if (items.every((l) => l.is_new)) {
      // Yalnızca yerelde var olan yeni listing'ler: Etsy'ye dokunulmaz.
      const okLocal = await confirm({
        title: t(`${items.length} yerel listing silinsin mi?`, `Delete ${items.length} local listings?`),
        message: t("Bunlar henüz Etsy'de yok; yalnızca yerel kopya silinir.", "These are not on Etsy yet; only the local copy is deleted."),
        confirmLabel: t("Sil", "Delete"),
        destructive: true,
      });
      if (!okLocal) return;
      for (const l of items) await api.listings.deleteListing(activeShop.id, l.listing_id).catch(() => undefined);
      setSelected(new Set());
      loadListings();
      return;
    }
    const ok = await confirm({
      title: t(`${items.length} listing kalıcı olarak silinsin mi?`, `Permanently delete ${items.length} listings?`),
      message: (
        <>
          {t("Listing'ler", "The listings")} <b>{t("Etsy'den silinir ve geri alınamaz", "are deleted from Etsy and this cannot be undone")}</b>.{" "}
          {items.length <= 3
            ? items.map((l) => `"${l.title}"`).join(", ")
            : `${t("İlk üçü", "First three")}: ${items.slice(0, 3).map((l) => `"${l.title}"`).join(", ")}…`}
        </>
      ),
      confirmLabel: t("Kalıcı olarak sil", "Delete permanently"),
      destructive: true,
    });
    if (!ok) return;
    setBusyAction(true);
    const errors: { title: string; error: string }[] = [];
    let deleted = 0;
    for (const l of items) {
      try {
        await api.listings.deleteListing(activeShop.id, l.listing_id);
        deleted++;
      } catch (e) {
        if (isPermissionError(e)) setNeedsReconnect(true);
        errors.push({ title: l.title, error: e instanceof Error ? e.message : t("Hata", "Error") });
      }
    }
    setSelected(new Set());
    setStageMsg({
      text: t(`${deleted} listing silindi${errors.length ? `, ${errors.length} silinemedi` : ""}.`, `${deleted} listings deleted${errors.length ? `, ${errors.length} could not be deleted` : ""}.`),
      errors,
    });
    setBusyAction(false);
    loadListings();
  }

  async function newListing(sourceId?: number) {
    if (!activeShop) return;
    setBusyAction(true);
    try {
      const res = await api.listings.newListing(activeShop.id, sourceId);
      if (res.warnings && res.warnings.length > 0) {
        await confirm({
          title: t("Kopya hazır", "Copy ready"),
          message: (
            <ul className="list-disc space-y-1 pl-5">
              {res.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ),
          confirmLabel: t("Düzenle", "Edit"),
        });
      }
      router.push(`/listings/${res.listing_id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
      setBusyAction(false);
    }
  }

  function handleAction(action: CardAction, listing: Listing) {
    if (action === "preview") setPreviewId(listing.listing_id);
    else if (action === "stats") setStatsFor(listing);
    else if (action === "copy") void newListing(listing.listing_id);
    else if (action === "publish") void publishOne(listing);
    else if (action === "activate") void changeState([listing], "active");
    else if (action === "deactivate") void changeState([listing], "inactive");
    else if (action === "renew") void changeState([listing], "active", true);
    else if (action === "section") setEditModal({ ids: [listing.listing_id], only: "section" });
    else if (action === "delete") void deleteListings([listing]);
  }

  // Satışı düşen listing'ler ("Düşüşte" filtresi): teşhis sunucuda gün boyu önbellekte; filtre seçilince yüklenir.
  const [attention, setAttention] = useCached<ShopAttention>(activeShop ? `attention:${activeShop.id}` : null);
  const wantsTrend = filters.trend === "declining";
  useEffect(() => {
    if (!activeShop || !wantsTrend) return;
    let cancelled = false;
    api.insights
      .attention(activeShop.id)
      .then((r) => {
        if (!cancelled) setAttention(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeShop, wantsTrend, setAttention]);
  const decliningIds = useMemo(() => new Set(attention?.declining_ids ?? []), [attention]);

  // Sönmüş listing'ler (eskiden satan, 90+ gündür satmayan): rozet her satırda gösterildiği için hep yüklenir; hafif istek.
  const [faded, setFaded] = useCached<FadedListings>(activeShop ? `faded:${activeShop.id}` : null);
  useEffect(() => {
    if (!activeShop) return;
    let cancelled = false;
    api.insights
      .faded(activeShop.id)
      .then((r) => {
        if (!cancelled) setFaded(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeShop, setFaded]);
  // Yalnızca aktif listing'ler sönmüş sayılır (pasif/süresi dolmuş zaten satamaz).
  const fadedOf = useCallback(
    (l: Listing): FadedInfo | undefined => (l.state === "active" ? faded?.listings[String(l.listing_id)] : undefined),
    [faded],
  );
  // Sıra takibindeki listing'ler: rozet ve "Takipte" filtresi için (en fazla 10 kayıt; hafif istek).
  const [ranks, setRanks] = useCached<RanksSummary>(activeShop ? `ranks:${activeShop.id}` : null);
  useEffect(() => {
    if (!activeShop) return;
    let cancelled = false;
    const load = () =>
      api.insights
        .ranksSummary(activeShop.id)
        .then((r) => {
          if (!cancelled) setRanks(r);
        })
        .catch(() => undefined);
    load();
    const off = onRanksChanged(load); // Analiz panelinde takip değişince
    return () => {
      cancelled = true;
      off();
    };
  }, [activeShop, setRanks]);
  const trackedIds = useMemo(() => new Set(Object.keys(ranks?.listings ?? {}).map(Number)), [ranks]);
  const fadedIds = useMemo(() => new Set((listings ?? []).filter((l) => fadedOf(l)).map((l) => l.listing_id)), [listings, fadedOf]);

  const draftListings = (listings ?? []).filter((l) => l.has_local);
  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searched = applyFilters(listings ?? [], filters, decliningIds, fadedIds, trackedIds).filter(
      (l) =>
        !q ||
        l.title.toLowerCase().includes(q) ||
        l.tags.some((t) => t.toLowerCase().includes(q)) ||
        (l.skus ?? []).some((k) => k.toLowerCase().includes(q))
    );
    const cmp: Record<string, (a: Listing, b: Listing) => number> = {
      ending: (a, b) => (b.ending_timestamp ?? 0) - (a.ending_timestamp ?? 0),
      modified: (a, b) => (b.last_modified_timestamp ?? 0) - (a.last_modified_timestamp ?? 0),
      views: (a, b) => (b.views ?? 0) - (a.views ?? 0),
      favorites: (a, b) => (b.favorites ?? 0) - (a.favorites ?? 0),
      price_asc: (a, b) => (a.price_min ?? 0) - (b.price_min ?? 0),
      price_desc: (a, b) => (b.price_min ?? 0) - (a.price_min ?? 0),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...searched].sort(cmp[sort] ?? cmp.ending);
  }, [listings, filters, query, sort, decliningIds, fadedIds, trackedIds]);
  // Yüzlerce kartı bir anda çizmek sayfayı kasıyor: 12 ile başla (xl ekranda 3 sıra), kaydırdıkça 12 daha ekle.
  const { shown, hasMore, sentinelRef } = useIncrementalList(
    visibleListings,
    view === "grid" ? 12 : 8,
    `${view}|${query}|${sort}|${JSON.stringify(filters)}`,
  );
  const selectedDrafts = draftListings.filter((l) => selected.has(l.listing_id));
  const selectedListings = (listings ?? []).filter((l) => selected.has(l.listing_id));
  const allRenewable = selectedListings.length > 0 && selectedListings.every((l) => l.state === "expired" || l.state === "sold_out");
  const allVisibleSelected = visibleListings.length > 0 && visibleListings.every((l) => selected.has(l.listing_id));

  function toggleSelected(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Taslakları sırayla Etsy'de yayınlar (Etsy oran sınırı nedeniyle paralel değil). */
  async function runPublish(items: Listing[], showProgress: boolean) {
    if (!activeShop) return;
    setRowErrors({});
    if (showProgress) setBulk({ total: items.length, results: [], running: true });
    const results: PublishOutcome[] = [];
    for (const item of items) {
      setPublishingIds((prev) => new Set(prev).add(item.listing_id));
      let outcome: PublishOutcome;
      try {
        const res = await api.listings.publishLocal(activeShop.id, item.listing_id);
        outcome = {
          id: item.listing_id,
          title: item.title,
          ok: res.ok,
          error: res.error ?? undefined,
          updated: res.steps.filter((st) => st.changed).map((st) => st.name),
          warnings: res.warnings,
        };
      } catch (e) {
        outcome = { id: item.listing_id, title: item.title, ok: false, error: e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error") };
      }
      results.push(outcome);
      setPublishingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.listing_id);
        return next;
      });
      if (!outcome.ok) setRowErrors((prev) => ({ ...prev, [item.listing_id]: outcome.error ?? t("Yayınlanamadı", "Could not publish") }));
      if (showProgress) setBulk({ total: items.length, results: [...results], running: true });
    }
    if (showProgress) setBulk({ total: items.length, results, running: false });
    setSelected((prev) => {
      const next = new Set(prev);
      results.filter((r) => r.ok).forEach((r) => next.delete(r.id));
      return next;
    });
    loadListings();
  }

  async function publishOne(listing: Listing) {
    const ok = await confirm({
      title: t("Etsy'de yayınlansın mı?", "Publish to Etsy?"),
      message: t(`"${listing.title}" için kaydedilmiş değişiklikler Etsy'deki canlı listing'e uygulanacak.`, `The saved changes for "${listing.title}" will be applied to the live listing on Etsy.`),
      confirmLabel: t("Etsy'de yayınla", "Publish to Etsy"),
    });
    if (ok && activeShop) startPublish(activeShop.id, listing.listing_id); // kart üzerinde doluluk çubuğu; sonuç bitince liste yenilenir
  }

  async function publishSelected() {
    if (selectedDrafts.length === 0) return;
    const skipped = selected.size - selectedDrafts.length;
    const ok = await confirm({
      title: t(`${selectedDrafts.length} listing Etsy'de yayınlansın mı?`, `Publish ${selectedDrafts.length} listings to Etsy?`),
      message: (
        <>
          {t(
            "Seçili listing'lerin kaydedilmiş değişiklikleri Etsy'deki canlı listing'lere sırayla uygulanacak.",
            "The saved changes of the selected listings will be applied to the live listings on Etsy one by one.",
          )}
          {skipped > 0 && <> {t(`Yerel değişikliği olmayan ${skipped} seçili listing atlanacak.`, `${skipped} selected listings without local changes will be skipped.`)}</>}
        </>
      ),
      confirmLabel: t("Etsy'de yayınla", "Publish to Etsy"),
    });
    if (ok) await runPublish(selectedDrafts, true);
  }

  async function fullSync() {
    if (!activeShop) return;
    const ok = await confirm({
      title: t("Tam senkronizasyon başlatılsın mı?", "Start a full sync?"),
      message: t(
        "Normal senkronizasyon yalnızca Etsy'de değişen listing'leri çeker. Tam senkronizasyon hepsini baştan çeker: birkaç dakika sürer ve Etsy API kotanı harcar. Yalnızca veri tutarsız görünüyorsa kullan.",
        "A normal sync only fetches listings that changed on Etsy. A full sync fetches all of them again: it takes a few minutes and uses your Etsy API quota. Only use it if the data looks inconsistent.",
      ),
      confirmLabel: t("Tam senkronize et", "Run full sync"),
    });
    if (!ok) return;
    await api.listings.sync(activeShop.id, true).catch((e) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error")));
    setStageMsg({
      text: t(
        "Tam senkronizasyon arka planda başladı; birkaç dakika sürebilir. Bitince listeyi yenile.",
        "Full sync started in the background; it can take a few minutes. Refresh the list when it is done.",
      ),
      errors: [],
    });
  }

  // Mobilde filtre paneli "Filtreler" düğmesiyle alttan açılır; masaüstünde listenin sağında durur.
  const filterUI = useResponsiveFilters({
    activeCount: changedCount(filters, DEFAULT_FILTERS),
    onReset: () => setFilters(DEFAULT_FILTERS),
    children: activeShop && listings ? (
      <ListingFilters
        listings={listings}
        filters={filters}
        onChange={setFilters}
        reference={reference}
        shopId={activeShop.id}
        onSectionsChanged={loadReference}
        decliningCount={attention?.declining_count}
        fadedCount={faded ? fadedIds.size : undefined}
        tracked={ranks ? { count: trackedIds.size, max: ranks.max_listings } : undefined}
      />
    ) : null,
  });

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/listings">
      <div className={`mx-auto max-w-7xl px-3 pt-0 sm:px-6 ${selected.size > 0 ? "pb-28" : "pb-8"}`}>
        <div>
          {!user && !bootError && <PageSpinner />}
        </div>

        {(bootError || error) && <p className="text-sm text-red-600 mb-4">{bootError ?? error}</p>}

        <div>
          {user && shops === null && !bootError && <PageSpinner />}
        </div>

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center">
            <p className="text-neutral-600 dark:text-neutral-300 mb-4">{t("Devam etmek için Etsy mağazanı bağlaman gerekiyor.", "Connect your Etsy shop to continue.")}</p>
            <a
              href={api.shops.connectUrl()}
              className="inline-block text-sm font-medium px-4 py-2 rounded-lg bg-[#D97757] text-white hover:bg-[#C6613F] transition"
            >
              {t("Etsy'ye Bağlan", "Connect Etsy")}
            </a>
          </div>
        )}

        {activeShop && listings === null && !error && (
          <PageSpinner />
        )}

        {activeShop && listings && listings.length === 0 && bootstrapSyncing && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center">
            <p className="text-neutral-600 dark:text-neutral-300">{t("İlk senkronizasyon çalışıyor…", "Running the first sync…")}</p>
            <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-1">
              {t(
                "Mağazandaki listing sayısına göre birkaç dakika sürebilir, bu sayfa otomatik güncellenecek.",
                "Depending on how many listings your shop has, this can take a few minutes. This page updates automatically.",
              )}
            </p>
          </div>
        )}

        {activeShop && listings && listings.length === 0 && !bootstrapSyncing && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Aktif listing bulunamadı.", "No active listings found.")}</p>
        )}

        {activeShop && listings && listings.length > 0 && (
          <>
            <div className="z-[9] -mx-3 bg-neutral-50 px-3 pb-3 pt-3 dark:bg-neutral-950 sm:-mx-6 sm:px-6 lg:sticky lg:top-[49px]">
              <ListingsToolbar
                total={listings.length}
                visible={visibleListings.length}
                draftCount={draftListings.length}
                query={query}
                onQuery={setQuery}
                sort={sort}
                onSort={setSort}
                view={view}
                onView={setView}
                filterButton={filterUI.button}
                onNew={() => void newListing()}
                busy={busyAction}
                allSelected={allVisibleSelected}
                selectedCount={selected.size}
                onToggleAll={(on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    visibleListings.forEach((l) => (on ? next.add(l.listing_id) : next.delete(l.listing_id)));
                    return next;
                  })
                }
                onSelectUnpublished={() => setSelected(new Set(draftListings.map((l) => l.listing_id)))}
                onFullSync={() => void fullSync()}
              />
            </div>

            {needsReconnect && (
              <div className="mb-3">
                <ReconnectNotice scope="listings_d" />
              </div>
            )}
            {stageMsg && (
              <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-neutral-800 dark:text-neutral-100">{stageMsg.text}</p>
                  <button onClick={() => setStageMsg(null)} className="text-xs text-neutral-500 hover:underline">
                    {t("Kapat", "Close")}
                  </button>
                </div>
                {stageMsg.errors.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-red-600">
                    {stageMsg.errors.slice(0, 8).map((e, i) => (
                      <li key={i}>
                        ✗ {e.title.slice(0, 60)} — {e.error}
                      </li>
                    ))}
                    {stageMsg.errors.length > 8 && <li>{t(`… ve ${stageMsg.errors.length - 8} tane daha`, `… and ${stageMsg.errors.length - 8} more`)}</li>}
                  </ul>
                )}
              </div>
            )}

            {bulk && (
              <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {bulk.running
                      ? `${t("Yayınlanıyor…", "Publishing…")} ${bulk.results.length}/${bulk.total}`
                      : t(
                          `Tamamlandı: ${bulk.results.filter((r) => r.ok).length} başarılı, ${bulk.results.filter((r) => !r.ok).length} hatalı`,
                          `Done: ${bulk.results.filter((r) => r.ok).length} succeeded, ${bulk.results.filter((r) => !r.ok).length} failed`,
                        )}
                  </p>
                  {!bulk.running && (
                    <button onClick={() => setBulk(null)} className="text-xs text-neutral-500 hover:underline">
                      {t("Kapat", "Close")}
                    </button>
                  )}
                </div>
                <ul className="space-y-1">
                  {bulk.results.map((r) => (
                    <li key={r.id} className={r.ok ? "text-neutral-600 dark:text-neutral-300" : "text-red-600"}>
                      {r.ok ? "✓" : "✗"} {r.title}
                      {r.error ? ` — ${r.error}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                {visibleListings.length === 0 && (
                  <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Bu filtrelerle eşleşen listing yok.", "No listings match these filters.")}</p>
                )}

                {view === "grid" ? (
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
                    {shown.map((listing) => (
                      <ListingCard
                        key={listing.listing_id}
                        listing={listing}
                        selected={selected.has(listing.listing_id)}
                        onSelectChange={(on) => toggleSelected(listing.listing_id, on)}
                        onAction={(a) => handleAction(a, listing)}
                        publishing={publishingIds.has(listing.listing_id) || jobs.get(listing.listing_id)?.phase === "running"}
                        publishError={rowErrors[listing.listing_id]}
                        job={jobs.get(listing.listing_id)}
                        faded={fadedOf(listing)}
                        rank={ranks?.listings[String(listing.listing_id)]}
                        rankMax={ranks?.max_results}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {shown.map((listing) => (
                      <ListingRow
                        key={listing.listing_id}
                        shopId={activeShop.id}
                        listing={listing}
                        selected={selected.has(listing.listing_id)}
                        onSelectChange={(on) => toggleSelected(listing.listing_id, on)}
                        onPublish={() => publishOne(listing)}
                        publishing={publishingIds.has(listing.listing_id) || jobs.get(listing.listing_id)?.phase === "running"}
                        publishError={rowErrors[listing.listing_id]}
                        job={jobs.get(listing.listing_id)}
                        faded={fadedOf(listing)}
                        rank={ranks?.listings[String(listing.listing_id)]}
                        rankMax={ranks?.max_results}
                      />
                    ))}
                  </div>
                )}
                {hasMore && (
                  <div ref={sentinelRef} className="py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
                    <Spinner size={20} />
                  </div>
                )}
              </div>

              {filterUI.panel}
            </div>
          </>
        )}
      </div>
      <SelectionBar
        count={selected.size}
        publishCount={selectedDrafts.length}
        publishing={!!bulk?.running}
        busy={busyAction}
        renewable={allRenewable}
        onPublish={() => void publishSelected()}
        onActivate={() => void changeState(selectedListings, "active")}
        onDeactivate={() => void changeState(selectedListings, "inactive")}
        onRenew={() => void changeState(selectedListings, "active", true)}
        onEdit={() => setEditModal({ ids: selectedListings.map((l) => l.listing_id) })}
        onDelete={() => void deleteListings(selectedListings)}
        onClear={() => setSelected(new Set())}
      />
      {confirmElement}
      {editModal && activeShop && (
        <BulkEditModal
          shopId={activeShop.id}
          count={editModal.ids.length}
          only={editModal.only}
          onCancel={() => setEditModal(null)}
          onApply={async (changes) => {
            await stage(editModal.ids, changes);
            setEditModal(null);
          }}
        />
      )}
      {previewId !== null && activeShop && <ListingPreviewModal shopId={activeShop.id} listingId={previewId} shopName={activeShop.shop_name} onClose={() => setPreviewId(null)} />}
      {statsFor && activeShop && (
        <Modal
          z={95}
          widthClass="max-w-3xl"
          title={statsFor.title.slice(0, 80)}
          footer={
            <button onClick={() => setStatsFor(null)} className={btnGhost}>
              {t("Kapat", "Close")}
            </button>
          }
        >
          <ListingAnalysisPanel shopId={activeShop.id} listingId={statsFor.listing_id} />
        </Modal>
      )}
    </AppShell>
  );
}

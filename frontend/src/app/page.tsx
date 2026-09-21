"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, BulkChanges, Listing } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import ListingRow from "@/components/ListingRow";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import SuccessDialog from "@/components/ui/SuccessDialog";
import ListingCard, { CardAction } from "@/components/listings/ListingCard";
import BulkEditModal, { BulkOp } from "@/components/listings/BulkEditModal";
import ListingHistoryPanel from "@/components/ListingHistoryPanel";
import { Modal, btnGhost } from "@/components/listing-editor/Modal";
import { ReconnectNotice, isPermissionError } from "@/components/shipping/shared";
import ListingFilters, { applyFilters, EMPTY_FILTERS, Filters, Reference } from "@/components/listings/ListingFilters";

type PublishOutcome = { id: number; title: string; ok: boolean; error?: string; updated?: string[]; warnings?: string[] };

const SYNC_POLL_INTERVAL_MS = 3000;

export default function Home() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [bootstrapSyncing, setBootstrapSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, status: "active" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("ending");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [reference, setReference] = useState<Reference>({ sections: [], shipping: [], returns: [], partners: [] });
  const [publishingIds, setPublishingIds] = useState<Set<number>>(new Set());
  const [published, setPublished] = useState<{ title: string; updated: string[]; warnings: string[] } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [bulk, setBulk] = useState<{ total: number; results: PublishOutcome[]; running: boolean } | null>(null);

  const loadListings = useCallback(() => {
    if (!activeShop) return;
    api.listings
      .list(activeShop.id)
      .then(setListings)
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [activeShop]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

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
        setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      }
    }

    ensureSynced();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [activeShop, listings, loadListings]);

  // Filtre paneli için Etsy referans verileri (sunucuda önbellekli, tek seferlik).
  useEffect(() => {
    if (!activeShop) return;
    const id = activeShop.id;
    Promise.all([
      api.shops.sections(id).catch(() => []),
      api.shops.shippingProfiles(id).catch(() => []),
      api.shops.returnPolicies(id).catch(() => []),
      api.shops.productionPartners(id).catch(() => []),
    ]).then(([sections, shipping, returns, partners]) => setReference({ sections, shipping, returns, partners }));
  }, [activeShop]);

  const [editModal, setEditModal] = useState<{ ids: number[]; only?: BulkOp } | null>(null);
  const [stageMsg, setStageMsg] = useState<{ text: string; errors: { title: string; error: string }[] } | null>(null);
  const [statsFor, setStatsFor] = useState<Listing | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  /** Toplu/tekil değişiklikleri yerel sürümlere işler (Etsy'ye gitmez); sonucu özetler. */
  async function stage(ids: number[], changes: BulkChanges) {
    if (!activeShop) return;
    const res = await api.listings.bulkStage(activeShop.id, ids, changes);
    const byId = new Map((listings ?? []).map((l) => [l.listing_id, l]));
    const errors = res.filter((r) => !r.ok).map((r) => ({ title: byId.get(r.id)?.title ?? String(r.id), error: r.error ?? "Hata" }));
    const changed = res.filter((r) => r.ok && r.changed).length;
    setStageMsg({
      text: `${changed} listing yerelde hazırlandı${errors.length ? `, ${errors.length} listing hatalı` : ""}. Etsy'ye göndermek için "Etsy'de yayınla" de.`,
      errors,
    });
    loadListings();
  }

  async function changeState(items: Listing[], state: "active" | "inactive", renew = false) {
    const verb = renew ? "yenilensin" : state === "active" ? "aktif edilsin" : "pasife alınsın";
    const ok = await confirm({
      title: `${items.length} listing ${verb} mi?`,
      message: renew
        ? "Süresi dolmuş/tükenmiş listing'ler yeniden aktif edilir; Etsy yenileme için listing ücreti (0,20 $) alır ve tükenmiş olanların stoğu 1 olur. Değişiklik yerelde hazırlanır, ücret ancak \"Etsy'de yayınla\" deyince alınır."
        : "Değişiklik yerelde hazırlanır; Etsy'ye \"Etsy'de yayınla\" deyince gider.",
      confirmLabel: renew ? "Yenile" : state === "active" ? "Aktif et" : "Pasife al",
    });
    if (!ok) return;
    setBusyAction(true);
    try {
      await stage(items.map((l) => l.listing_id), { state });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setBusyAction(false);
    }
  }

  async function deleteListings(items: Listing[]) {
    if (!activeShop || items.length === 0) return;
    if (items.every((l) => l.is_new)) {
      // Yalnızca yerelde var olan yeni listing'ler: Etsy'ye dokunulmaz.
      const okLocal = await confirm({ title: `${items.length} yerel listing silinsin mi?`, message: "Bunlar henüz Etsy'de yok; yalnızca yerel kopya silinir.", confirmLabel: "Sil", destructive: true });
      if (!okLocal) return;
      for (const l of items) await api.listings.deleteListing(activeShop.id, l.listing_id).catch(() => undefined);
      setSelected(new Set());
      loadListings();
      return;
    }
    const ok = await confirm({
      title: `${items.length} listing kalıcı olarak silinsin mi?`,
      message: (
        <>
          Listing&apos;ler <b>Etsy&apos;den silinir ve geri alınamaz</b>. {items.length <= 3 ? items.map((l) => `"${l.title}"`).join(", ") : `İlk üçü: ${items.slice(0, 3).map((l) => `"${l.title}"`).join(", ")}…`}
        </>
      ),
      confirmLabel: "Kalıcı olarak sil",
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
        errors.push({ title: l.title, error: e instanceof Error ? e.message : "Hata" });
      }
    }
    setSelected(new Set());
    setStageMsg({ text: `${deleted} listing silindi${errors.length ? `, ${errors.length} silinemedi` : ""}.`, errors });
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
          title: "Kopya hazır",
          message: (
            <ul className="list-disc space-y-1 pl-5">
              {res.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ),
          confirmLabel: "Düzenle",
        });
      }
      router.push(`/listings/${res.listing_id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      setBusyAction(false);
    }
  }

  function handleAction(action: CardAction, listing: Listing) {
    if (action === "stats") setStatsFor(listing);
    else if (action === "copy") void newListing(listing.listing_id);
    else if (action === "publish") void publishOne(listing);
    else if (action === "activate") void changeState([listing], "active");
    else if (action === "deactivate") void changeState([listing], "inactive");
    else if (action === "renew") void changeState([listing], "active", true);
    else if (action === "section") setEditModal({ ids: [listing.listing_id], only: "section" });
    else if (action === "delete") void deleteListings([listing]);
  }

  const draftListings = (listings ?? []).filter((l) => l.has_local);
  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searched = applyFilters(listings ?? [], filters).filter(
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
  }, [listings, filters, query, sort]);
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
        outcome = { id: item.listing_id, title: item.title, ok: false, error: e instanceof Error ? e.message : "Bilinmeyen hata" };
      }
      results.push(outcome);
      setPublishingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.listing_id);
        return next;
      });
      if (!outcome.ok) setRowErrors((prev) => ({ ...prev, [item.listing_id]: outcome.error ?? "Yayınlanamadı" }));
      if (showProgress) setBulk({ total: items.length, results: [...results], running: true });
    }
    if (showProgress) setBulk({ total: items.length, results, running: false });
    else if (results[0]?.ok) setPublished({ title: results[0].title, updated: results[0].updated ?? [], warnings: results[0].warnings ?? [] });
    setSelected((prev) => {
      const next = new Set(prev);
      results.filter((r) => r.ok).forEach((r) => next.delete(r.id));
      return next;
    });
    loadListings();
  }

  async function publishOne(listing: Listing) {
    const ok = await confirm({
      title: "Etsy'de yayınlansın mı?",
      message: `"${listing.title}" için kaydedilmiş değişiklikler Etsy'deki canlı listing'e uygulanacak.`,
      confirmLabel: "Etsy'de yayınla",
    });
    if (ok) await runPublish([listing], false);
  }

  async function publishSelected() {
    if (selectedDrafts.length === 0) return;
    const skipped = selected.size - selectedDrafts.length;
    const ok = await confirm({
      title: `${selectedDrafts.length} listing Etsy'de yayınlansın mı?`,
      message: (
        <>
          Seçili listing&apos;lerin kaydedilmiş değişiklikleri Etsy&apos;deki canlı listing&apos;lere sırayla uygulanacak.
          {skipped > 0 && <> Yerel değişikliği olmayan {skipped} seçili listing atlanacak.</>}
        </>
      ),
      confirmLabel: "Etsy'de yayınla",
    });
    if (ok) await runPublish(selectedDrafts, true);
  }

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {!user && !bootError && <p className="text-sm text-neutral-400 dark:text-neutral-500">Yükleniyor…</p>}

        {(bootError || error) && <p className="text-sm text-red-600 mb-4">{bootError ?? error}</p>}

        {user && shops === null && !bootError && <p className="text-sm text-neutral-400 dark:text-neutral-500">Mağazalar yükleniyor…</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center">
            <p className="text-neutral-600 dark:text-neutral-300 mb-4">Devam etmek için Etsy mağazanı bağlaman gerekiyor.</p>
            <a
              href={api.shops.connectUrl()}
              className="inline-block text-sm font-medium px-4 py-2 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition"
            >
              Etsy&apos;ye Bağlan
            </a>
          </div>
        )}

        {activeShop && listings === null && !error && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Listing&apos;ler yükleniyor…</p>
        )}

        {activeShop && listings && listings.length === 0 && bootstrapSyncing && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center">
            <p className="text-neutral-600 dark:text-neutral-300">İlk senkronizasyon çalışıyor…</p>
            <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-1">
              Mağazandaki listing sayısına göre birkaç dakika sürebilir, bu sayfa otomatik güncellenecek.
            </p>
          </div>
        )}

        {activeShop && listings && listings.length === 0 && !bootstrapSyncing && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Aktif listing bulunamadı.</p>
        )}

        {activeShop && listings && listings.length > 0 && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h1 className="mr-auto text-xl font-semibold text-neutral-900 dark:text-neutral-100">Listing&apos;ler</h1>
              <button
                onClick={() => newListing()}
                disabled={busyAction}
                className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                + Yeni listing
              </button>
              <div className="relative w-full sm:w-80">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Başlık, etiket veya SKU ara"
                  className="w-full rounded-full border border-neutral-300 bg-white py-2 pl-4 pr-10 text-sm outline-none focus:border-[#F1641E] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400">⌕</span>
              </div>
            </div>

            <div className="mb-3 space-y-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 pr-2 text-sm text-neutral-700 dark:text-neutral-200">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        visibleListings.forEach((l) => (e.target.checked ? next.add(l.listing_id) : next.delete(l.listing_id)));
                        return next;
                      })
                    }
                    className="h-4 w-4 accent-[#F1641E]"
                  />
                  {selected.size > 0 ? `${selected.size} seçili` : "Tümünü seç"}
                </label>
                {[
                  { label: "Yenile", show: allRenewable, run: () => changeState(selectedListings, "active", true) },
                  { label: "Pasife al", show: true, run: () => changeState(selectedListings, "inactive") },
                  { label: "Aktif et", show: true, run: () => changeState(selectedListings, "active") },
                  { label: "Sil", show: true, run: () => deleteListings(selectedListings), danger: true },
                ]
                  .filter((b) => b.show)
                  .map((b) => (
                    <button
                      key={b.label}
                      onClick={b.run}
                      disabled={selected.size === 0 || busyAction}
                      className={`rounded-full border px-4 py-1.5 text-sm font-medium disabled:opacity-40 ${
                        "danger" in b && b.danger
                          ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                          : "border-neutral-300 text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                <button
                  onClick={() => setEditModal({ ids: selectedListings.map((l) => l.listing_id) })}
                  disabled={selected.size === 0 || busyAction}
                  className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  Düzenleme seçenekleri ▾
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    aria-label="Sırala"
                    className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  >
                    <option value="ending">Bitiş: en yeni önce</option>
                    <option value="modified">Son düzenlenen</option>
                    <option value="views">En çok görüntülenen</option>
                    <option value="favorites">En çok favorilenen</option>
                    <option value="price_asc">Fiyat: düşükten yükseğe</option>
                    <option value="price_desc">Fiyat: yüksekten düşüğe</option>
                    <option value="title">Başlık (A–Z)</option>
                  </select>
                  {(["grid", "list"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      aria-label={v === "grid" ? "Kart görünümü" : "Liste görünümü"}
                      aria-pressed={view === v}
                      className={`rounded-full border px-3 py-1.5 text-sm ${
                        view === v
                          ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                          : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                      }`}
                    >
                      {v === "grid" ? "▦" : "☰"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {visibleListings.length}/{listings.length} listing · {draftListings.length} yayınlanmamış
                </span>
                <button
                  onClick={() => setSelected(new Set(draftListings.map((l) => l.listing_id)))}
                  disabled={draftListings.length === 0}
                  className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Yayınlanmamışları seç
                </button>
                <button
                  onClick={async () => {
                    if (!activeShop) return;
                    const ok = await confirm({
                      title: "Tam senkronizasyon başlatılsın mı?",
                      message: "Normal senkronizasyon yalnızca Etsy'de değişen listing'leri çeker. Tam senkronizasyon hepsini baştan çeker: birkaç dakika sürer ve Etsy API kotanı harcar. Yalnızca veri tutarsız görünüyorsa kullan.",
                      confirmLabel: "Tam senkronize et",
                    });
                    if (!ok) return;
                    await api.listings.sync(activeShop.id, true).catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
                    setStageMsg({ text: "Tam senkronizasyon arka planda başladı; birkaç dakika sürebilir. Bitince listeyi yenile.", errors: [] });
                  }}
                  className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
                >
                  Tam senkronizasyon
                </button>
                <button
                  onClick={publishSelected}
                  disabled={selectedDrafts.length === 0 || bulk?.running}
                  className="ml-auto rounded-lg bg-[#F1641E] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#d9560f] disabled:opacity-50"
                >
                  Seçilenleri Etsy&apos;de yayınla ({selectedDrafts.length})
                </button>
              </div>
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
                    Kapat
                  </button>
                </div>
                {stageMsg.errors.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-red-600">
                    {stageMsg.errors.slice(0, 8).map((e, i) => (
                      <li key={i}>
                        ✗ {e.title.slice(0, 60)} — {e.error}
                      </li>
                    ))}
                    {stageMsg.errors.length > 8 && <li>… ve {stageMsg.errors.length - 8} tane daha</li>}
                  </ul>
                )}
              </div>
            )}

            {bulk && (
              <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {bulk.running
                      ? `Yayınlanıyor… ${bulk.results.length}/${bulk.total}`
                      : `Tamamlandı: ${bulk.results.filter((r) => r.ok).length} başarılı, ${bulk.results.filter((r) => !r.ok).length} hatalı`}
                  </p>
                  {!bulk.running && (
                    <button onClick={() => setBulk(null)} className="text-xs text-neutral-500 hover:underline">
                      Kapat
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
                  <p className="text-sm text-neutral-400 dark:text-neutral-500">Bu filtrelerle eşleşen listing yok.</p>
                )}

                {view === "grid" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {visibleListings.map((listing) => (
                      <ListingCard
                        key={listing.listing_id}
                        listing={listing}
                        selected={selected.has(listing.listing_id)}
                        onSelectChange={(on) => toggleSelected(listing.listing_id, on)}
                        onAction={(a) => handleAction(a, listing)}
                        publishing={publishingIds.has(listing.listing_id)}
                        publishError={rowErrors[listing.listing_id]}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleListings.map((listing) => (
                      <ListingRow
                        key={listing.listing_id}
                        shopId={activeShop.id}
                        listing={listing}
                        selected={selected.has(listing.listing_id)}
                        onSelectChange={(on) => toggleSelected(listing.listing_id, on)}
                        onPublish={() => publishOne(listing)}
                        publishing={publishingIds.has(listing.listing_id)}
                        publishError={rowErrors[listing.listing_id]}
                      />
                    ))}
                  </div>
                )}
              </div>

              <ListingFilters listings={listings} filters={filters} onChange={setFilters} reference={reference} />
            </div>
          </>
        )}
      </div>
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
      {statsFor && activeShop && (
        <Modal
          z={95}
          widthClass="max-w-3xl"
          title={statsFor.title.slice(0, 80)}
          footer={
            <button onClick={() => setStatsFor(null)} className={btnGhost}>
              Kapat
            </button>
          }
        >
          <ListingHistoryPanel shopId={activeShop.id} listingId={statsFor.listing_id} />
        </Modal>
      )}
      {published && (
        <SuccessDialog
          message={
            published.updated.length > 0
              ? `"${published.title}" Etsy'de yayınlandı.`
              : `"${published.title}" için gönderilecek bir değişiklik bulunamadı.`
          }
          updated={published.updated}
          warnings={published.warnings}
          onClose={() => setPublished(null)}
        />
      )}
    </AppShell>
  );
}

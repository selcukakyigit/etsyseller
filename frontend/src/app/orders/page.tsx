"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, Order, OrderInsights, OrdersPage as OrdersPageData, OrdersSyncStatus } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import OrderCard from "@/components/orders/OrderCard";
import OrderFilterPanel from "@/components/orders/OrderFilterPanel";
import ShipModal from "@/components/orders/ShipModal";
import GiftCardModal, { configForOrder } from "@/components/orders/GiftCardModal";
import { printCards } from "@/components/orders/giftCard";
import { EMPTY_ORDER_FILTERS, OrderFilters, Tab, addressText, copyText, groupByShipBy } from "@/components/orders/orderUtils";

const TABS: [Tab, string][] = [
  ["toship", "Gönderilecek"],
  ["completed", "Tamamlandı"],
  ["canceled", "İptal / iade"],
  ["all", "Tümü"],
];

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function OrdersPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const [data, setData] = useState<OrdersPageData | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null); // hangi sorgunun sonucu ekranda
  const [insights, setInsights] = useState<OrderInsights | null>(null);
  const [syncInfo, setSyncInfo] = useState<OrdersSyncStatus | null>(null);
  const [tab, setTab] = useState<Tab>("toship");
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_ORDER_FILTERS);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("shipby");
  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(0);
  // Seçim sayfalar arasında korunur; sipariş nesneleri de tutulur (sayfa değişince kaybolmasın).
  const [selected, setSelected] = useState<Map<number, Order>>(new Map());
  const [shipFor, setShipFor] = useState<Order | null>(null);
  const [giftFor, setGiftFor] = useState<Order | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef<number | null>(null);
  const shopId = activeShop?.id;

  // Arama kutusu: yazmayı bitirince (350 ms) sunucuya gider.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(queryInput);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [queryInput]);

  const load = useCallback(() => {
    if (shopId === undefined) return;
    const key = JSON.stringify([shopId, tab, query, filters, sort, page, perPage]);
    api.orders
      .page(shopId, {
        tab,
        q: query,
        ship_by: filters.shipBy === "all" ? "" : filters.shipBy,
        destination: filters.destination,
        channel: filters.channel === "all" ? "" : filters.channel,
        note: filters.note,
        gift: filters.gift,
        personalized: filters.personalized,
        upgrade: filters.upgrade,
        sort,
        page,
        per_page: perPage,
        today: localToday(),
      })
      .then((d) => {
        setData(d);
        setError(null);
        setLoadedKey(key);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Bilinmeyen hata");
        setLoadedKey(key);
      });
  }, [shopId, tab, query, filters, sort, page, perPage]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (shopId === undefined) return;
    api.orders.insights(shopId).then(setInsights).catch(() => undefined);
    api.orders
      .syncStatus(shopId)
      .then(async (status) => {
        setSyncInfo(status);
        // İlk kullanım: yerelde hiç sipariş yoksa senkronizasyon kendiliğinden başlar (geçmiş arka planda iner).
        if (status.local === 0 && !status.backfilling && bootstrapped.current !== shopId) {
          bootstrapped.current = shopId;
          setSyncing(true);
          try {
            setSyncInfo(await api.orders.sync(shopId));
            load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Bilinmeyen hata");
          } finally {
            setSyncing(false);
          }
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  // Geçmiş siparişler arka planda iniyorsa ilerlemeyi izle; bitince listeyi tazele.
  useEffect(() => {
    if (shopId === undefined || !syncInfo?.backfilling) return;
    const id = setInterval(() => {
      api.orders
        .syncStatus(shopId)
        .then((s) => {
          setSyncInfo(s);
          if (!s.backfilling) load();
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(id);
  }, [shopId, syncInfo?.backfilling, load]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  async function handleSync() {
    if (shopId === undefined) return;
    setSyncing(true);
    setError(null);
    try {
      setSyncInfo(await api.orders.sync(shopId));
      load();
      api.orders.insights(shopId).then(setInsights).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setSyncing(false);
    }
  }

  const loading = loadedKey !== JSON.stringify([shopId, tab, query, filters, sort, page, perPage]);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? { toship: 0, completed: 0, canceled: 0, all: 0 };
  const pages = Math.max(1, Math.ceil(total / perPage));
  const groups = tab === "toship" && sort === "shipby" ? groupByShipBy(items) : [{ key: "all", label: "", orders: items }];
  const selectedOrders = [...selected.values()];
  const allVisibleSelected = items.length > 0 && items.every((o) => selected.has(o.receipt_id));

  const toggle = (o: Order, on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(o.receipt_id, o);
      else next.delete(o.receipt_id);
      return next;
    });

  function handleShipped(updated: Order) {
    setShipFor(null);
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(updated.receipt_id);
      return next;
    });
    load();
    if (shopId !== undefined) api.orders.insights(shopId).then(setInsights).catch(() => undefined);
  }

  async function copyAddresses() {
    setMenuOpen(false);
    const ok = await copyText(selectedOrders.map(addressText).join("\n\n"));
    setNotice(ok ? `${selectedOrders.length} adres kopyalandı.` : "Panoya kopyalanamadı.");
  }

  function printGiftCards() {
    setMenuOpen(false);
    const gifts = selectedOrders.filter((o) => o.is_gift);
    if (gifts.length === 0) {
      setNotice("Seçili siparişlerde hediye olarak işaretlenmiş sipariş yok.");
      return;
    }
    const withMsg = gifts.map(configForOrder).filter((c) => c.message.trim());
    if (withMsg.length === 0) {
      setNotice("Seçili hediye siparişlerinde mesaj yok. Önce kartı açıp mesajı yaz.");
      return;
    }
    printCards(withMsg);
    if (withMsg.length < gifts.length) setNotice(`${gifts.length - withMsg.length} siparişte mesaj olmadığı için atlandı.`);
  }

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/orders">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {!user && !bootError && <p className="text-sm text-neutral-400">Yükleniyor…</p>}
        {(bootError || error) && <p className="mb-4 text-sm text-red-600">{bootError ?? error}</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-4 text-neutral-600 dark:text-neutral-300">Siparişleri görmek için önce Etsy mağazanı bağlaman gerekiyor.</p>
            <a href={api.shops.connectUrl()} className="inline-block rounded-lg bg-[#F1641E] px-4 py-2 text-sm font-medium text-white hover:bg-[#d9560f]">
              Etsy&apos;ye Bağlan
            </a>
          </div>
        )}

        {activeShop && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h1 className="mr-auto text-xl font-semibold text-neutral-900 dark:text-neutral-100">Siparişler</h1>
              <div className="relative w-full sm:w-80">
                <input
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="Alıcı, sipariş no, ürün, kişiselleştirme ya da SKU ara"
                  className="w-full rounded-full border border-neutral-300 bg-white py-2 pl-4 pr-10 text-sm outline-none focus:border-[#F1641E] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400">⌕</span>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {syncing ? "Senkronize ediliyor…" : "Etsy ile senkronize et"}
              </button>
            </div>

            {syncInfo?.backfilling && (
              <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                Geçmiş siparişler arka planda indiriliyor: <b>{syncInfo.local}</b> / {syncInfo.remote_total ?? "…"}. Bu sayfayı kullanmaya devam edebilirsin, bitince liste otomatik güncellenir.
              </p>
            )}
            {syncInfo && !syncInfo.backfilling && syncInfo.remote_total !== null && syncInfo.local < syncInfo.remote_total && (
              <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Etsy&apos;de {syncInfo.remote_total} sipariş var, yerelde {syncInfo.local} tanesi görünüyor. Kalanı için &quot;Etsy ile senkronize et&quot;e bas.
              </p>
            )}
            {insights && <p className="mb-4 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">{insights.summary}</p>}

            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Map(prev);
                      items.forEach((o) => (e.target.checked ? next.set(o.receipt_id, o) : next.delete(o.receipt_id)));
                      return next;
                    })
                  }
                  className="h-4 w-4 accent-[#F1641E]"
                />
                {selected.size > 0 ? `${selected.size} seçili` : "Bu sayfayı seç"}
              </label>
              {selected.size > 0 && (
                <button onClick={() => setSelected(new Map())} className="text-xs text-neutral-500 hover:underline">
                  Seçimi temizle
                </button>
              )}
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  disabled={selected.size === 0}
                  className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  Diğer işlemler ▾
                </button>
                {menuOpen && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                    <button onClick={copyAddresses} className="block w-full px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800">
                      Seçili adresleri kopyala
                    </button>
                    <button onClick={printGiftCards} className="block w-full px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800">
                      Hediye kartlarını yazdır ({selectedOrders.filter((o) => o.is_gift).length})
                    </button>
                  </div>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(0);
                  }}
                  aria-label="Sırala"
                  className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  <option value="shipby">Sırala: gönderim tarihi</option>
                  <option value="newest">Sırala: en yeni</option>
                  <option value="oldest">Sırala: en eski</option>
                  <option value="total">Sırala: tutar</option>
                </select>
                <select
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setPage(0);
                  }}
                  aria-label="Sayfa başına"
                  className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      Sayfada {n} sipariş
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {notice && (
              <p className="mb-3 flex items-center justify-between rounded-lg bg-neutral-100 px-4 py-2 text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
                {notice}
                <button onClick={() => setNotice(null)} className="text-xs text-neutral-500 hover:underline">
                  Kapat
                </button>
              </p>
            )}

            <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 border-b border-neutral-200 dark:border-neutral-800">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setTab(key);
                    setPage(0);
                  }}
                  className={`-mb-px border-b-2 px-1 pb-2 text-sm ${
                    tab === key ? "border-neutral-900 font-semibold text-neutral-900 dark:border-neutral-100 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
                >
                  {label} {counts[key].toLocaleString("tr-TR")}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className={`min-w-0 flex-1 space-y-5 ${loading ? "opacity-60" : ""}`}>
                {data === null && !error && <p className="text-sm text-neutral-400">Siparişler yükleniyor…</p>}
                {data && (
                  <p className="text-xs text-neutral-500">
                    {total.toLocaleString("tr-TR")} sipariş · sayfa {page + 1}/{pages}
                  </p>
                )}
                {data && items.length === 0 && (
                  <p className="text-sm text-neutral-400">
                    {syncing || syncInfo?.backfilling ? "Siparişler Etsy'den indiriliyor…" : "Bu filtrelerle eşleşen sipariş yok."}
                  </p>
                )}
                {groups.map((g) => (
                  <section key={g.key} className="space-y-3">
                    {g.label && (
                      <div className="flex items-center gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-sm dark:bg-neutral-800">
                        <b className="text-neutral-900 dark:text-neutral-100">{g.label}</b>
                        <span className="rounded-full bg-white px-2 text-xs dark:bg-neutral-900">{g.orders.length}</span>
                        <button
                          onClick={() =>
                            setSelected((prev) => {
                              const next = new Map(prev);
                              g.orders.forEach((o) => next.set(o.receipt_id, o));
                              return next;
                            })
                          }
                          className="ml-1 text-xs text-neutral-600 underline underline-offset-2 dark:text-neutral-300"
                        >
                          Tümünü seç
                        </button>
                      </div>
                    )}
                    {g.orders.map((order) => (
                      <OrderCard
                        key={order.receipt_id}
                        order={order}
                        selected={selected.has(order.receipt_id)}
                        onSelect={(on) => toggle(order, on)}
                        onShip={() => setShipFor(order)}
                        onGift={() => setGiftFor(order)}
                      />
                    ))}
                  </section>
                ))}

                {pages > 1 && (
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                    <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-full px-3 py-1.5 text-sm disabled:opacity-30">
                      ←
                    </button>
                    {pageNumbers(page, pages).map((n, i) =>
                      n === null ? (
                        <span key={`gap${i}`} className="px-1 text-neutral-400">
                          …
                        </span>
                      ) : (
                        <button key={n} onClick={() => setPage(n)} className={`h-8 min-w-9 rounded-full px-2 text-sm ${n === page ? "border border-neutral-900 dark:border-neutral-100" : "bg-neutral-100 dark:bg-neutral-800"}`}>
                          {n + 1}
                        </button>
                      )
                    )}
                    <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded-full px-3 py-1.5 text-sm disabled:opacity-30">
                      →
                    </button>
                  </div>
                )}
              </div>

              <OrderFilterPanel
                destinations={data?.destinations ?? []}
                filters={filters}
                onChange={(f) => {
                  setFilters(f);
                  setPage(0);
                }}
              />
            </div>
          </>
        )}
      </div>

      {shipFor && activeShop && <ShipModal shopId={activeShop.id} order={shipFor} onClose={() => setShipFor(null)} onShipped={handleShipped} />}
      {giftFor && <GiftCardModal order={giftFor} onClose={() => setGiftFor(null)} />}
    </AppShell>
  );
}

/** Çok sayfada tüm numaraları göstermek yerine: 1 … 4 5 [6] 7 8 … 110 */
function pageNumbers(current: number, pages: number): (number | null)[] {
  const set = new Set<number>([0, pages - 1]);
  for (let i = current - 2; i <= current + 2; i++) if (i >= 0 && i < pages) set.add(i);
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

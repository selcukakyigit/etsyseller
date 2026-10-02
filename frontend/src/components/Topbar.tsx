"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, OrderInsights, Shop } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";
import { BellIcon, SyncIcon } from "@/components/icons";
import { emitSyncDone } from "@/lib/syncEvents";

export default function Topbar({ activeShop }: { activeShop: Shop | null }) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [insights, setInsights] = useState<OrderInsights | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeShop) return;
    api.orders.insights(activeShop.id).then(setInsights).catch(() => {});
  }, [activeShop]);

  // Senkron backend'de arka planda sürüyor (sayfa değiştirmek/sekmeyi kapatmak durdurmaz). Bu bileşen her sayfa
  // geçişinde yeniden monte olduğu için, sayfa değiştirip geri gelince zaten süren bir senkronu kaldığı yerden
  // (gerçek ilerlemesiyle) göstermeye devam etsin diye mount olunca bir kere durumu kontrol ediyoruz.
  useEffect(() => {
    if (!activeShop) return;
    let cancelled = false;
    api.listings
      .syncStatus(activeShop.id)
      .then((status) => {
        if (cancelled || !status.syncing) return;
        setSyncing(true);
        watchSync(activeShop.id, () => cancelled).catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShop?.id]);

  /** Bitene kadar ilerlemeyi izler; `handleSync`'in kendisi ve mount-time devralma bunu paylaşır. */
  async function watchSync(shopId: number, isCancelled: () => boolean) {
    try {
      while (true) {
        const [status, fin] = await Promise.all([api.listings.syncStatus(shopId), api.finance.syncStatus(shopId).catch(() => null)]);
        if (isCancelled()) return;
        setProgress(status.total ? { done: status.done ?? 0, total: status.total } : null);
        if (!status.syncing && !fin?.running) break; // ilanlar VE finans bitene kadar ikon döner
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (!isCancelled()) {
        setInsights(await api.orders.insights(shopId));
        emitSyncDone(); // açık sayfa (ör. Siparişler) kendini tazelesin — ayrı bir sayfa düğmesine gerek kalmadı
      }
    } finally {
      if (!isCancelled()) {
        setSyncing(false);
        setProgress(null);
      }
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSync() {
    if (!activeShop) return;
    setSyncing(true);
    setSyncError(null);
    setProgress(null);
    try {
      // Finans (Etsy ödeme/ücret kayıtları) siparişlerden SONRA başlar — kayıtlar siparişlerle eşleştirilir. Artımlı ve arka
      // planda çalışır; hata verirse (ör. yetki yok) diğer senkronları bozmaz, ayrıntı Finans sayfasında görünür.
      const shopId = activeShop.id;
      await Promise.all([
        api.orders.sync(shopId).then(() => api.finance.sync(shopId, false)).catch(() => undefined),
        api.listings.sync(shopId),
      ]);
      // Listing senkronizasyonu arka planda çalışıyor (büyük mağazalarda dakikalar sürebilir) — ikon, gerçekten bitene kadar dönmeye devam etsin.
      await watchSync(activeShop.id, () => false);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Senkronizasyon başarısız");
      setSyncing(false);
      setProgress(null);
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

  const notificationCount = insights ? insights.needs_shipping_today + insights.overdue : 0;

  return (
    <header className="sticky top-0 z-40 box-border h-[49px] flex items-center justify-end gap-1 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-2">
      {syncError && <span className="text-xs text-red-600 mr-2">{syncError}</span>}

      {syncing && pct !== null && (
        <div className="mr-1.5 flex items-center gap-2" title={`${progress?.done} / ${progress?.total} listing`}>
          <div className="h-2.5 w-28 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full min-w-[3px] rounded-full bg-[#D97757] transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">%{pct}</span>
        </div>
      )}

      <button
        onClick={handleSync}
        disabled={!activeShop || syncing}
        title="Etsy ile senkronize et"
        className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition disabled:opacity-40"
      >
        {/* animate-spin (saat yönü) bu iki oklu ikonda tersine dönüyormuş gibi bir yanılsama yaratıyordu; okların
            kendi yönüyle tutarlı olsun diye tersine (reverse) döndürüyoruz. */}
        <SyncIcon className={syncing ? "animate-spin" : ""} style={syncing ? { animationDirection: "reverse" } : undefined} />
      </button>

      <div className="relative" ref={notifRef}>
        <button
          onClick={() => setNotifOpen((v) => !v)}
          title="Bildirimler"
          className="relative w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        >
          <BellIcon />
          {notificationCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#D97757]" />
          )}
        </button>

        {notifOpen && (
          <div
            style={{ zIndex: 60 }}
            className="absolute right-0 mt-2 w-72 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-3 space-y-2"
          >
            <p className="text-xs font-medium text-neutral-400">Bildirimler</p>
            {notificationCount === 0 && <p className="text-sm text-neutral-500">Yeni bildirim yok.</p>}
            {insights && insights.overdue > 0 && (
              <Link
                href="/orders"
                onClick={() => setNotifOpen(false)}
                className="block text-sm text-neutral-700 dark:text-neutral-200 hover:underline"
              >
                {insights.overdue} sipariş kargo süresi geçmiş
              </Link>
            )}
            {insights && insights.needs_shipping_today > 0 && (
              <Link
                href="/orders"
                onClick={() => setNotifOpen(false)}
                className="block text-sm text-neutral-700 dark:text-neutral-200 hover:underline"
              >
                {insights.needs_shipping_today} sipariş bugün kargoya verilmeli
              </Link>
            )}
          </div>
        )}
      </div>

      <ThemeToggle />
    </header>
  );
}

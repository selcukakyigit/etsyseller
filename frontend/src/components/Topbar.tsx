"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, OrderInsights, Shop } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";
import { BellIcon, SyncIcon } from "@/components/icons";

export default function Topbar({ activeShop }: { activeShop: Shop | null }) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [insights, setInsights] = useState<OrderInsights | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeShop) return;
    api.orders.insights(activeShop.id).then(setInsights).catch(() => {});
  }, [activeShop]);

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
    try {
      await Promise.all([api.orders.sync(activeShop.id), api.listings.sync(activeShop.id)]);
      // Listing senkronizasyonu arka planda çalışıyor (büyük mağazalarda
      // dakikalar sürebilir) — ikon, gerçekten bitene kadar dönmeye devam etsin.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const status = await api.listings.syncStatus(activeShop.id);
        if (!status.syncing) break;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      setInsights(await api.orders.insights(activeShop.id));
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Senkronizasyon başarısız");
    } finally {
      setSyncing(false);
    }
  }

  const notificationCount = insights ? insights.needs_shipping_today + insights.overdue : 0;

  return (
    <header className="sticky top-0 z-10 flex items-center justify-end gap-1 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-2">
      {syncError && <span className="text-xs text-red-600 mr-2">{syncError}</span>}

      <button
        onClick={handleSync}
        disabled={!activeShop || syncing}
        title="Etsy ile senkronize et"
        className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition disabled:opacity-40"
      >
        <SyncIcon className={syncing ? "animate-spin" : ""} />
      </button>

      <div className="relative" ref={notifRef}>
        <button
          onClick={() => setNotifOpen((v) => !v)}
          title="Bildirimler"
          className="relative w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        >
          <BellIcon />
          {notificationCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#F1641E]" />
          )}
        </button>

        {notifOpen && (
          <div className="absolute right-0 mt-2 w-72 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-3 space-y-2">
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Order, OrderInsights } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import OrderRow from "@/components/OrderRow";

export default function OrdersPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [insights, setInsights] = useState<OrderInsights | null>(null);
  const [onlyNeedsShipping, setOnlyNeedsShipping] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(() => {
    if (!activeShop) return;
    api.orders
      .list(activeShop.id, onlyNeedsShipping)
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [activeShop, onlyNeedsShipping]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!activeShop) return;
    api.orders
      .insights(activeShop.id)
      .then(setInsights)
      .catch(() => {});
  }, [activeShop]);

  async function handleSync() {
    if (!activeShop) return;
    setSyncing(true);
    setError(null);
    try {
      await api.orders.sync(activeShop.id);
      loadOrders();
      api.orders.insights(activeShop.id).then(setInsights).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setSyncing(false);
    }
  }

  function handleShipped(updated: Order) {
    setOrders((prev) => {
      if (!prev) return prev;
      if (onlyNeedsShipping) return prev.filter((o) => o.receipt_id !== updated.receipt_id);
      return prev.map((o) => (o.receipt_id === updated.receipt_id ? updated : o));
    });
  }

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/orders">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {!user && !bootError && <p className="text-sm text-neutral-400 dark:text-neutral-500">Yükleniyor…</p>}
        {(bootError || error) && <p className="text-sm text-red-600 mb-4">{bootError ?? error}</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center">
            <p className="text-neutral-600 dark:text-neutral-300 mb-4">Siparişleri görmek için önce Etsy mağazanı bağlaman gerekiyor.</p>
            <a
              href={api.shops.connectUrl()}
              className="inline-block text-sm font-medium px-4 py-2 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition"
            >
              Etsy&apos;ye Bağlan
            </a>
          </div>
        )}

        {activeShop && (
          <>
            {insights && (
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 mb-4">
                <p className="text-sm text-neutral-700 dark:text-neutral-300">{insights.summary}</p>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={onlyNeedsShipping}
                  onChange={(e) => setOnlyNeedsShipping(e.target.checked)}
                  className="rounded border-neutral-300"
                />
                Sadece kargo bekleyenler
              </label>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition disabled:opacity-50"
              >
                {syncing ? "Senkronize ediliyor…" : "Şimdi Senkronize Et"}
              </button>
            </div>

            {orders === null && !error && <p className="text-sm text-neutral-400 dark:text-neutral-500">Siparişler yükleniyor…</p>}

            {orders && (
              <div className="space-y-3">
                {orders.length === 0 && (
                  <p className="text-sm text-neutral-400 dark:text-neutral-500">
                    {onlyNeedsShipping ? "Kargo bekleyen sipariş yok." : "Sipariş bulunamadı."}
                  </p>
                )}
                {orders.map((order) => (
                  <OrderRow key={order.receipt_id} shopId={activeShop.id} order={order} onShipped={handleShipped} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

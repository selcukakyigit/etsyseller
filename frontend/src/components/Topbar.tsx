"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, AppNotification, OrderInsights, Shop } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";
import LangSwitch from "@/components/LangSwitch";
import { useT } from "@/lib/i18n-client";
import { BellIcon, MenuIcon, SyncIcon } from "@/components/icons";
import Logo from "@/components/Logo";
import { emitSyncDone } from "@/lib/syncEvents";
import { emitOrderFocus, focusForNotification, OrderFocus, orderFocusHref } from "@/lib/orderFocus";

/** Üst bar. `onMenu`: mobilde (lg altı) ☰ düğmesi menü çekmecesini açar. */
export default function Topbar({ activeShop, onMenu }: { activeShop: Shop | null; onMenu?: () => void }) {
  const { t, locale } = useT();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [insights, setInsights] = useState<OrderInsights | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!activeShop) return;
    api.orders.insights(activeShop.id).then(setInsights).catch(() => {});
  }, [activeShop]);

  // Sipariş olayları (Etsy webhook'u) arka planda gelir; sayfa açıkken dakikada bir yoklanır.
  useEffect(() => {
    if (!activeShop) return;
    const shopId = activeShop.id;
    const load = () =>
      api.notifications
        .list(shopId)
        .then((r) => {
          setEvents(r.items);
          setUnread(r.unread);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShop?.id]);

  function toggleNotifications() {
    const next = !notifOpen;
    setNotifOpen(next);
    // Açınca okundu say; liste açıkken "yeni" vurgusu kalsın diye yerel öğeler bir sonraki yüklemede güncellenir.
    if (next && unread > 0 && activeShop) {
      setUnread(0);
      api.notifications.markRead(activeShop.id).catch(() => {});
    }
  }

  /** Bildirimden sipariş sayfasına: ilgili sekme + sipariş vurgusu (sayfa zaten açıksa olayla haber verilir). */
  const goToOrders = (f: OrderFocus) => () => {
    setNotifOpen(false);
    emitOrderFocus(f);
  };

  function eventText(n: AppNotification): string {
    const d = n.data;
    const money = d.amount != null ? new Intl.NumberFormat(locale, { style: "currency", currency: d.currency || "USD" }).format(d.amount / (d.divisor || 100)) : "";
    const who = d.buyer || t("Alıcı", "Buyer");
    switch (n.kind) {
      case "order_paid":
        return t(`Yeni sipariş: ${who}${money ? ` · ${money}` : ""}`, `New order: ${who}${money ? ` · ${money}` : ""}`);
      case "order_canceled":
        return t(`Sipariş iptal edildi: ${who}`, `Order canceled: ${who}`);
      case "order_shipped":
        return t(`Kargoya verildi: ${who}`, `Shipped: ${who}`);
      case "order_delivered":
        return t(`Teslim edildi: ${who}`, `Delivered: ${who}`);
    }
  }

  const KIND_DOT: Record<AppNotification["kind"], string> = {
    order_paid: "bg-emerald-500",
    order_canceled: "bg-red-500",
    order_shipped: "bg-sky-500",
    order_delivered: "bg-[#D97757]",
  };

  function ago(iso: string): string {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (min < 60) return t(`${min} dk önce`, `${min} min ago`);
    const h = Math.round(min / 60);
    if (h < 24) return t(`${h} sa önce`, `${h} h ago`);
    return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
  }

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
      setSyncError(e instanceof Error ? e.message : t("Senkronizasyon başarısız", "Sync failed"));
      setSyncing(false);
      setProgress(null);
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

  const reminderCount = insights ? insights.needs_shipping_today + insights.overdue : 0;
  const notificationCount = reminderCount + unread;

  return (
    <header className="sticky top-0 z-40 box-border flex h-[49px] items-center justify-end gap-1 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900 sm:px-4">
      <div className="mr-auto flex items-center gap-1 lg:hidden">
        <button
          type="button"
          onClick={onMenu}
          aria-label={t("Menüyü aç", "Open menu")}
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <MenuIcon />
        </button>
        <Link href="/dashboard" aria-label={t("Ana sayfa", "Home")}>
          <Logo height={20} />
        </Link>
      </div>

      {syncError && <span className="mr-2 hidden truncate text-xs text-red-600 dark:text-red-400 sm:inline">{syncError}</span>}

      {syncing && pct !== null && (
        <div className="mr-1.5 hidden items-center gap-2 sm:flex" title={`${progress?.done} / ${progress?.total} listing`}>
          <div className="h-2.5 w-28 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full min-w-[3px] rounded-full bg-[#D97757] transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">%{pct}</span>
        </div>
      )}

      <button
        onClick={handleSync}
        disabled={!activeShop || syncing}
        title={t("Etsy ile senkronize et", "Sync with Etsy")}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition disabled:opacity-40"
      >
        {/* animate-spin (saat yönü) bu iki oklu ikonda tersine dönüyormuş gibi bir yanılsama yaratıyordu; okların
            kendi yönüyle tutarlı olsun diye tersine (reverse) döndürüyoruz. */}
        <SyncIcon className={syncing ? "animate-spin" : ""} style={syncing ? { animationDirection: "reverse" } : undefined} />
      </button>

      <div className="relative" ref={notifRef}>
        <button
          onClick={toggleNotifications}
          title={t("Bildirimler", "Notifications")}
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
            className="fixed inset-x-3 top-[53px] max-h-[70vh] overflow-y-auto rounded-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-3 space-y-2"
          >
            <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{t("Bildirimler", "Notifications")}</p>
            {reminderCount === 0 && events.length === 0 && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Yeni bildirim yok.", "No new notifications.")}</p>
            )}
            {insights && insights.overdue > 0 && (
              <Link
                href={orderFocusHref({ shipBy: "overdue" })}
                onClick={goToOrders({ shipBy: "overdue" })}
                className="block text-sm text-neutral-700 dark:text-neutral-200 hover:underline"
              >
                {t(`${insights.overdue} sipariş kargo süresi geçmiş`, `${insights.overdue} orders past their ship-by date`)}
              </Link>
            )}
            {insights && insights.needs_shipping_today > 0 && (
              <Link
                href={orderFocusHref({ shipBy: "today" })}
                onClick={goToOrders({ shipBy: "today" })}
                className="block text-sm text-neutral-700 dark:text-neutral-200 hover:underline"
              >
                {t(`${insights.needs_shipping_today} sipariş bugün kargoya verilmeli`, `${insights.needs_shipping_today} orders must ship today`)}
              </Link>
            )}
            {events.length > 0 && (
              <ul className={`max-h-80 space-y-0.5 overflow-y-auto ${reminderCount > 0 ? "border-t border-neutral-100 pt-2 dark:border-neutral-800" : ""}`}>
                {events.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={orderFocusHref(focusForNotification(n))}
                      onClick={goToOrders(focusForNotification(n))}
                      className={`flex gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${n.read ? "" : "bg-[#D97757]/5 dark:bg-[#D97757]/10"}`}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[n.kind]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-neutral-800 dark:text-neutral-100">{eventText(n)}</span>
                        <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                          {n.data.title ? `${n.data.title} · ` : ""}
                          {ago(n.created_at)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <LangSwitch className="mx-1.5" />
      <ThemeToggle />
    </header>
  );
}

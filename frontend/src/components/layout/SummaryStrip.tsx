"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Shop, SummaryStripData } from "@/lib/api";
import { localToday } from "@/components/dashboard/stats";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { useStoredState } from "@/lib/useStoredState";

/** Tarayıcıda hatırlanan açık/kapalı tercihi (Ayarlar > Bildirimler'deki anahtar ve şeridin ✕ düğmesi aynı anahtarı kullanır). */
export const SUMMARY_STRIP_KEY = "summary-strip";
export const useSummaryStripEnabled = () => useStoredState<"on" | "off">(SUMMARY_STRIP_KEY, "on", ["on", "off"]);

const REFRESH_MS = 2 * 60_000;
const item = "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition hover:bg-neutral-100 dark:hover:bg-neutral-800";

/** Üst çubuğun altında tek satırlık özet: gönderilecek/geciken sipariş, bugünün satışı, ayın en çok satanı. Dar ekranda satır
 * yana kayar (sayfa kaymaz). Kapalıysa hiçbir şey istenmez ve çizilmez. */
export default function SummaryStrip({ activeShop }: { activeShop: Shop | null }) {
  const { t, locale } = useT();
  const [mode, setMode] = useSummaryStripEnabled();
  const shopId = activeShop?.id;
  const enabled = mode === "on" && shopId !== undefined;
  const [data, setData] = useCached<SummaryStripData>(enabled ? `summary:${shopId}:${localToday()}` : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || shopId === undefined) return;
    let cancelled = false;
    const load = () =>
      api.notifications
        .summary(shopId, localToday())
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true); // yardımcı şerit; yüklenemezse sayfa etkilenmez
        });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, shopId, setData]);

  if (!enabled || (failed && !data)) return null;

  const money = (n: number, currency: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency}`; // geçersiz para birimi kodu
    }
  };

  return (
    <div className="flex min-h-[34px] items-center border-b border-neutral-200 bg-white text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
      <div className="flex min-w-0 flex-1 items-center gap-x-1 overflow-x-auto whitespace-nowrap px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4" aria-label={t("Günlük özet", "Daily summary")}>
        {data && (
          <>
            <Link href="/orders?tab=toship" className={`${item} ${data.overdue > 0 ? "font-medium text-red-600 dark:text-red-400" : ""}`}>
              <span aria-hidden>{data.to_ship > 0 ? "📦" : "✓"}</span>
              {data.to_ship > 0
                ? t(`${data.to_ship} sipariş gönderilecek`, `${data.to_ship} ${data.to_ship === 1 ? "order" : "orders"} to ship`)
                : t("Gönderilecek sipariş yok", "Nothing to ship")}
              {data.overdue > 0 && <span>{t(`· ${data.overdue} gecikmiş`, `· ${data.overdue} overdue`)}</span>}
            </Link>
            <span aria-hidden className="shrink-0 text-neutral-300 dark:text-neutral-700">|</span>
            <Link href="/orders?tab=all" className={item}>
              <span aria-hidden>💰</span>
              {t("Bugün", "Today")}: {data.today.orders} {t("sipariş", data.today.orders === 1 ? "order" : "orders")} · {money(data.today.sales, data.currency)}
            </Link>
            {data.top_product && (
              <>
                <span aria-hidden className="shrink-0 text-neutral-300 dark:text-neutral-700">|</span>
                <Link href={`/listings/${data.top_product.listing_id}/edit`} className={item} title={data.top_product.title}>
                  <span aria-hidden>🏆</span>
                  <span>{t("Bu ay en çok satan", "Top seller this month")}:</span>
                  <span className="max-w-[12rem] truncate font-medium text-neutral-900 dark:text-neutral-100 sm:max-w-[20rem]">{data.top_product.title}</span>
                  <span>({data.top_product.units})</span>
                </Link>
              </>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => setMode("off")}
        title={t("Özeti gizle (Ayarlar > Bildirimler'den açılır)", "Hide summary (turn it back on in Settings > Notifications)")}
        aria-label={t("Özeti gizle", "Hide summary")}
        className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        ✕
      </button>
    </div>
  );
}

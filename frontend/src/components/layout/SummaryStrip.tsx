"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Shop, SummaryStripData } from "@/lib/api";
import { localToday } from "@/components/dashboard/stats";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { useStoredState } from "@/lib/useStoredState";

/** Tarayıcıda hatırlanan açık/kapalı tercihi (Ayarlar > Bildirimler'deki anahtar, şeridin ✕ düğmesi ve mobildeki ⋯ menüsü aynı anahtarı kullanır). */
export const SUMMARY_STRIP_KEY = "summary-strip";
export const useSummaryStripEnabled = () => useStoredState<"on" | "off">(SUMMARY_STRIP_KEY, "on", ["on", "off"]);

const REFRESH_MS = 2 * 60_000;
const item = "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition hover:bg-neutral-100 dark:hover:bg-neutral-800";
const divider = <span aria-hidden className="shrink-0 text-neutral-300 dark:text-neutral-700">|</span>;

export type SummaryStripState = {
  /** Tercih açık ve veri alınabiliyor: şerit gösterilmeli (veri gelene kadar da yer ayrılır, sayfa zıplamasın). */
  visible: boolean;
  data: SummaryStripData | null;
  /** Kullanıcının tercihi (veri alınamasa da açık olabilir) ve değiştirici: mobildeki ⋯ menüsü ve masaüstündeki ✕ kullanır. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
};

/** Şeridin verisi ve tercihi. Tek yerde (AppShell) çağrılır; masaüstündeki şerit ve mobildeki üst çubuk aynı veriyi kullanır,
 * böylece ikinci bir istek atılmaz. Kapalıysa hiçbir şey istenmez. */
export function useSummaryStrip(activeShop: Shop | null): SummaryStripState {
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

  return { visible: enabled && !(failed && !data), data, enabled: mode === "on", setEnabled: (on) => setMode(on ? "on" : "off") };
}

/** Şeridin öğeleri (gönderilecek, bugün, ayın en çok satanı): masaüstünde şeritte, mobilde üst çubukta aynı görünür. */
export function SummaryItems({ data }: { data: SummaryStripData | null }) {
  const { t, locale } = useT();
  if (!data) return null;

  const money = (n: number, currency: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency}`; // geçersiz para birimi kodu
    }
  };

  return (
    <>
      <Link href="/orders?tab=toship" className={`${item} ${data.overdue > 0 ? "font-medium text-red-600 dark:text-red-400" : ""}`}>
        <span aria-hidden>{data.to_ship > 0 ? "📦" : "✓"}</span>
        {data.to_ship > 0
          ? t(`${data.to_ship} sipariş gönderilecek`, `${data.to_ship} ${data.to_ship === 1 ? "order" : "orders"} to ship`)
          : t("Gönderilecek sipariş yok", "Nothing to ship")}
        {data.overdue > 0 && <span>{t(`· ${data.overdue} gecikmiş`, `· ${data.overdue} overdue`)}</span>}
      </Link>
      {divider}
      <Link href="/orders?tab=all" className={item}>
        <span aria-hidden>💰</span>
        {t("Bugün", "Today")}: {data.today.orders} {t("sipariş", data.today.orders === 1 ? "order" : "orders")} · {money(data.today.sales, data.currency)}
      </Link>
      {data.top_product && (
        <>
          {divider}
          <Link href={`/listings/${data.top_product.listing_id}/edit`} className={item} title={data.top_product.title}>
            <span aria-hidden>🏆</span>
            <span>{t("Bu ay en çok satan", "Top seller this month")}:</span>
            <span className="max-w-[12rem] truncate font-medium text-neutral-900 dark:text-neutral-100 sm:max-w-[20rem]">{data.top_product.title}</span>
            <span>({data.top_product.units})</span>
          </Link>
        </>
      )}
    </>
  );
}

/** Yana kayan tek satır; kaydırma çubuğu gizli, sayfa kaymaz. */
export const SUMMARY_SCROLL = "flex min-w-0 items-center gap-x-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** Masaüstü (lg ve üstü) şeridi: üst çubuğun altında. Mobilde özet üst çubuğun içinde gösterilir (bkz. Topbar). */
export default function SummaryStrip({ strip }: { strip: SummaryStripState }) {
  const { t } = useT();
  if (!strip.visible) return null;
  return (
    <div className="hidden min-h-[34px] items-center border-b border-neutral-200 bg-white text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 lg:flex">
      <div className={`${SUMMARY_SCROLL} flex-1 px-4 py-1`} aria-label={t("Günlük özet", "Daily summary")}>
        <SummaryItems data={strip.data} />
      </div>
      <button
        type="button"
        onClick={() => strip.setEnabled(false)}
        title={t("Özeti gizle (Ayarlar > Bildirimler'den açılır)", "Hide summary (turn it back on in Settings > Notifications)")}
        aria-label={t("Özeti gizle", "Hide summary")}
        className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        ✕
      </button>
    </div>
  );
}

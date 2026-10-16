"use client";

import Link from "next/link";
import { Fragment, ReactNode, useEffect, useState } from "react";
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

type Entry = { key: string; href: string; title?: string; urgent?: boolean; body: ReactNode };

/** Şeridin öğeleri (gönderilecek, bugün, ayın en çok satanı): masaüstü şeridi ve mobildeki döngü aynı listeyi kullanır. */
/** `compact` (mobil döngü): ayrıntı etiketleri çıkar, ürün adı kalan genişliğe sığacak kadar görünür. */
function useEntries(data: SummaryStripData | null, compact = false): Entry[] {
  const { t, locale } = useT();
  if (!data) return [];
  const money = (n: number, currency: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency}`; // geçersiz para birimi kodu
    }
  };
  const entries: Entry[] = [
    {
      key: "ship",
      href: "/orders?tab=toship",
      urgent: data.overdue > 0,
      body: (
        <>
          <span aria-hidden>{data.to_ship > 0 ? "📦" : "✓"}</span>
          {data.to_ship > 0
            ? t(`${data.to_ship} sipariş gönderilecek`, `${data.to_ship} ${data.to_ship === 1 ? "order" : "orders"} to ship`)
            : t("Gönderilecek sipariş yok", "Nothing to ship")}
          {data.overdue > 0 && <span>{t(`· ${data.overdue} gecikmiş`, `· ${data.overdue} overdue`)}</span>}
        </>
      ),
    },
    {
      key: "today",
      href: "/orders?tab=all",
      body: (
        <>
          <span aria-hidden>💰</span>
          {t("Bugün", "Today")}: {data.today.orders} {t("sipariş", data.today.orders === 1 ? "order" : "orders")} · {money(data.today.sales, data.currency)}
        </>
      ),
    },
  ];
  if (data.top_product) {
    entries.push({
      key: "top",
      href: `/listings/${data.top_product.listing_id}/edit`,
      title: data.top_product.title,
      body: (
        <>
          <span aria-hidden>🏆</span>
          {!compact && <span>{t("Bu ay en çok satan", "Top seller this month")}:</span>}
          <span className={`min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100 ${compact ? "" : "max-w-[12rem] sm:max-w-[20rem]"}`}>{data.top_product.title}</span>
          <span className="shrink-0">({data.top_product.units})</span>
        </>
      ),
    });
  }
  return entries;
}

const entryClass = (e: Entry) => `${item} ${e.urgent ? "font-medium text-red-600 dark:text-red-400" : ""}`;

/** Masaüstü: hepsi yan yana. */
export function SummaryItems({ data }: { data: SummaryStripData | null }) {
  return (
    <>
      {useEntries(data).map((e, i) => (
        <Fragment key={e.key}>
          {i > 0 && divider}
          <Link href={e.href} title={e.title} className={entryClass(e)}>
            {e.body}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

const ROTATE_MS = 4000;
const FADE_MS = 180;

/** Mobil: aynı öğeler tek tek, kendiliğinden değişir (solarak); öğeye dokununca ilgili sayfaya gider, sağdaki noktalara dokununca
 * sıradakine geçer. Hareket azaltma ayarı açıksa solma olmaz. */
export function SummaryRotator({ data }: { data: SummaryStripData | null }) {
  const { t } = useT();
  const entries = useEntries(data, true);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);
  const [tick, setTick] = useState(0); // elle geçişte süre baştan başlasın
  const count = entries.length;

  useEffect(() => {
    if (count < 2) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (calm) {
        setIndex((i) => (i + 1) % count);
        return;
      }
      setShown(false);
      swap = setTimeout(() => {
        setIndex((i) => (i + 1) % count);
        setShown(true);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(swap);
    };
  }, [count, tick]);

  if (count === 0) return null;
  const current = entries[index % count];
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 text-xs">
      <Link
        href={current.href}
        title={current.title}
        className={`${entryClass(current)} !shrink min-w-0 overflow-hidden transition-opacity motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}
        style={{ transitionDuration: `${FADE_MS}ms` }}
      >
        {current.body}
      </Link>
      {count > 1 && (
        <button
          type="button"
          aria-label={t("Sonraki özet", "Next summary")}
          onClick={() => {
            setShown(true);
            setIndex((i) => (i + 1) % count);
            setTick((n) => n + 1);
          }}
          className="ml-auto flex shrink-0 items-center gap-1 px-2 py-2"
        >
          {entries.map((e, i) => (
            <span key={e.key} aria-hidden className={`h-1.5 w-1.5 rounded-full ${i === index % count ? "bg-[#D97757]" : "bg-neutral-300 dark:bg-neutral-700"}`} />
          ))}
        </button>
      )}
    </div>
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

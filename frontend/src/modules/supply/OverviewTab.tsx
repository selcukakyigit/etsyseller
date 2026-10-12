"use client";

import { ReactNode, useState } from "react";
import DateRangePicker, { presetOptions } from "@/components/ui/DateRangePicker";
import { BlockSpinner } from "@/components/ui/Spinner";
import { DateRange, presetRange } from "@/lib/dateRanges";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import ActivityFeed from "../components/ActivityFeed";
import { EntityGuestNotice } from "../components/EntitySettings";
import StatCard from "../components/StatCard";
import { Entity, EntityAccess, isMember } from "../core/api";
import { card, h2, muted } from "../core/ui";
import { money } from "../core/units";
import { MODULE_PATH, SupplySummary, supplyApi } from "./api";
import CostReport, { lastYear } from "./CostReport";
import { SUPPLY_ACTIVITY } from "./texts";

type Shortcut = {
  tab: "jobs" | "products" | "prices" | "documents";
  tr: string;
  en: string;
  hintTr: string;
  hintEn: string;
};

const SHORTCUTS: Shortcut[] = [
  {
    tab: "jobs",
    tr: "İşler",
    en: "Jobs",
    hintTr: "Rapor yükle, işi onayla ve maliyeti ürünlere yaz",
    hintEn: "Upload a report, confirm the job and write the cost to products",
  },
  {
    tab: "products",
    tr: "Ürünler",
    en: "Products",
    hintTr: "Plaka DXF'i yükle, parçaları ürünlere ata",
    hintEn: "Upload the sheet DXF and assign parts to products",
  },
  {
    tab: "prices",
    tr: "Fiyat listesi",
    en: "Price list",
    hintTr: "Hizmet, malzeme ve sabit ücret fiyatları",
    hintEn: "Service, material and fixed-charge prices",
  },
  {
    tab: "documents",
    tr: "Belgeler",
    en: "Documents",
    hintTr: "Yüklenen rapor, fatura ve fişler",
    hintEn: "Uploaded reports, invoices and receipts",
  },
];

/** "Genel" sekmesi: özet kartları, dönem maliyet raporu, kısayollar ve son hareketler. Kayıt ayarları "Ayarlar" sekmesindedir. */
export default function OverviewTab({
  entity,
  summary,
  access,
  onOpenTab,
  onOpenJobs,
}: {
  entity: Entity;
  summary: SupplySummary | undefined;
  access: EntityAccess | undefined;
  onOpenTab: (tab: Shortcut["tab"]) => void;
  onOpenJobs: (status: string) => void;
}) {
  const { t, locale } = useT();
  const { data: activity } = useApiData(`supply-activity:${entity.id}`, () => supplyApi.activity(entity.id));
  const lastChange = summary?.last_price_change ? new Date(summary.last_price_change).toLocaleDateString(locale) : null;
  const member = isMember(access);

  // Dönem seçimi sayfadaki bütün sayılar ve grafikler için geçerlidir ("Tümü" = aralık yok).
  const [period, setPeriod] = useState("ytd");
  const [custom, setCustom] = useState<DateRange | null>(null);
  const range = period === "all" ? null : period === "custom" ? custom : presetRange(period);
  const key = range ? `${range.start}:${range.end}` : "all";
  const { data, error } = useApiData(`supply-overview:${entity.id}:${key}`, () => supplyApi.report(entity.id, range));
  const prevRange = range ? { start: lastYear(range.start), end: lastYear(range.end) } : null;
  const { data: previous } = useApiData(`supply-overview:${entity.id}:${prevRange ? `${prevRange.start}:${prevRange.end}` : "none"}`, () =>
    prevRange ? supplyApi.report(entity.id, prevRange) : Promise.resolve(undefined),
  );
  const today = new Date().toISOString().slice(0, 10);
  const chartStart = range?.start ?? (data?.months[0] ? `${data.months[0].month}-01` : today);
  const diff = data ? data.actual_total - data.estimate_total : 0;

  return (
    <div className="space-y-4">
      <DateRangePicker
        label={t("Dönem", "Period")}
        value={period}
        custom={custom}
        options={[{ id: "all", label: t("Tümü", "All"), range: null }, ...presetOptions(["30d", "90d", "month", "last_month", "ytd"], t)]}
        onChange={(id, r) => {
          setPeriod(id);
          if (id === "custom") setCustom(r);
        }}
      />
      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data ? (
        <BlockSpinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              title={t("Onayını bekleyen", "Waiting for you")}
              value={String(data.statuses.submitted)}
              hint={t("tedarikçinin gönderdiği işler", "jobs sent by the supplier")}
              onClick={() => onOpenJobs("submitted")}
            />
            <StatCard title={t("Açık işler", "Open jobs")} value={String(data.statuses.draft + data.statuses.submitted + data.statuses.disputed)} onClick={() => onOpenJobs("open")} />
            <StatCard title={t("Toplam maliyet", "Total cost")} value={money(data.cost, entity.currency, locale)} hint={t("onaylanan işler", "confirmed jobs")} />
            <StatCard
              title={t("Onaylanan iş", "Confirmed jobs")}
              value={
                <>
                  {data.confirmed} <span className="text-sm font-normal text-neutral-400">/ {data.jobs}</span>
                </>
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard title={t("Tahmin (gerçeği olan işler)", "Estimate (jobs with actual)")} value={money(data.estimate_total, entity.currency, locale)} />
            <StatCard
              title={t("Gerçek − tahmin", "Actual − estimate")}
              value={`${diff > 0 ? "+" : ""}${money(diff, entity.currency, locale)}`}
              valueClass={diff > 0 ? "text-red-600 dark:text-red-400" : diff < 0 ? "text-emerald-700 dark:text-emerald-400" : ""}
            />
            <StatCard
              title={t("Fiyat kalemi", "Price items")}
              value={String(summary?.price_items ?? "—")}
              hint={lastChange ? t(`son değişiklik ${lastChange}`, `last change ${lastChange}`) : t("güncel", "current")}
            />
          </div>

          <CostReport data={data} previous={previous ?? undefined} start={chartStart} end={range?.end ?? today} currency={entity.currency} />
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className={card}>
          <h2 className={`${h2} mb-3`}>{t("Son hareketler", "Recent activity")}</h2>
          <ActivityFeed items={activity?.items ?? null} extra={SUPPLY_ACTIVITY} guestTr="tedarikçi" guestEn="supplier" />
        </section>

        {member ? (
          <Shortcuts onOpenTab={onOpenTab} />
        ) : (
          <EntityGuestNotice
            api={supplyApi}
            entityId={entity.id}
            backHref={MODULE_PATH}
            bodyTr="Bu kayıt seninle paylaşıldı. Fiyat listeni güncel tutabilir, iş ve belge ekleyebilirsin (yetkine göre). Müşterinin mağaza, sipariş ve finans bilgilerini göremezsin."
            bodyEn="This record was shared with you. You can keep your price list up to date and add jobs and documents (depending on your permissions). You cannot see the customer's shop, orders or finances."
          />
        )}
      </div>
    </div>
  );
}

function Shortcuts({ onOpenTab }: { onOpenTab: (tab: Shortcut["tab"]) => void }): ReactNode {
  const { t } = useT();
  return (
    <section className={card}>
      <h2 className={`${h2} mb-3`}>{t("Kısayollar", "Shortcuts")}</h2>
      <ul className="-my-1 divide-y divide-neutral-100 dark:divide-neutral-800">
        {SHORTCUTS.map((s) => (
          <li key={s.tab}>
            <button type="button" onClick={() => onOpenTab(s.tab)} className="flex w-full items-center justify-between gap-3 py-3 text-left transition hover:opacity-80">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(s.tr, s.en)}</span>
                <span className={`${muted} block`}>{t(s.hintTr, s.hintEn)}</span>
              </span>
              <span className="shrink-0 text-neutral-400" aria-hidden>
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

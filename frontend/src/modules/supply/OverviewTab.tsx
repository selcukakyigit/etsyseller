"use client";

import { ReactNode } from "react";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import ActivityFeed from "../components/ActivityFeed";
import { EntityGuestNotice } from "../components/EntitySettings";
import StatCard from "../components/StatCard";
import { Entity, EntityAccess, isMember } from "../core/api";
import { card, h2, muted } from "../core/ui";
import { money } from "../core/units";
import { MODULE_PATH, SupplySummary, supplyApi } from "./api";
import { SUPPLY_ACTIVITY } from "./texts";

type Shortcut = { tab: "jobs" | "products" | "prices" | "documents" | "reports"; tr: string; en: string; hintTr: string; hintEn: string };

const SHORTCUTS: Shortcut[] = [
  { tab: "jobs", tr: "İşler", en: "Jobs", hintTr: "Rapor yükle, işi onayla ve maliyeti ürünlere yaz", hintEn: "Upload a report, confirm the job and write the cost to products" },
  { tab: "products", tr: "Ürünler", en: "Products", hintTr: "Plaka DXF'i yükle, parçaları ürünlere ata", hintEn: "Upload the sheet DXF and assign parts to products" },
  { tab: "prices", tr: "Fiyat listesi", en: "Price list", hintTr: "Hizmet, malzeme ve sabit ücret fiyatları", hintEn: "Service, material and fixed-charge prices" },
  { tab: "documents", tr: "Belgeler", en: "Documents", hintTr: "Yüklenen rapor, fatura ve fişler", hintEn: "Uploaded reports, invoices and receipts" },
  { tab: "reports", tr: "Raporlar", en: "Reports", hintTr: "Dönem maliyet raporu", hintEn: "Cost report for a period" },
];

/** "Genel" sekmesi: özet kartları, kısayollar ve son hareketler. Kayıt ayarları "Ayarlar" sekmesindedir. */
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          title={t("Onayını bekleyen", "Waiting for you")}
          value={String(summary?.submitted ?? "—")}
          hint={t("tedarikçinin gönderdiği işler", "jobs sent by the supplier")}
          onClick={() => onOpenJobs("submitted")}
        />
        <StatCard title={t("Açık işler", "Open jobs")} value={String(summary ? summary.draft + summary.submitted + summary.disputed : "—")} onClick={() => onOpenJobs("open")} />
        <StatCard title={t("Bu ay maliyet", "Cost this month")} value={summary ? money(summary.month_cost, entity.currency, locale) : "—"} hint={t("onaylanan işler", "confirmed jobs")} />
        <StatCard
          title={t("Fiyat kalemi", "Price items")}
          value={String(summary?.price_items ?? "—")}
          hint={lastChange ? t(`son değişiklik ${lastChange}`, `last change ${lastChange}`) : undefined}
        />
      </div>

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

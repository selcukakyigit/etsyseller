"use client";

import { EMPTY_ORDER_FILTERS, OrderFilters } from "./orderUtils";
import { useT } from "@/lib/i18n-client";

function Radio({ checked, onChange, children, count }: { checked: boolean; onChange: () => void; children: React.ReactNode; count?: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">
      <input type="radio" checked={checked} onChange={onChange} className="accent-[#D97757]" />
      {children}
      {count !== undefined && <span className="rounded bg-neutral-100 px-1.5 text-[11px] text-neutral-500 dark:bg-neutral-800">{count}</span>}
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#D97757]" />
      {children}
    </label>
  );
}

const heading = "mb-1.5 mt-5 block text-sm font-semibold text-neutral-900 dark:text-neutral-100 first:mt-0";

/** Etsy Siparişler sayfasının sağ filtre paneli (Gönderim tarihi, Hedef, Kanal, Sipariş detayları, Kargo). */
export default function OrderFilterPanel({
  destinations,
  filters,
  onChange,
}: {
  /** Sekmedeki siparişlerin hedef ülkeleri (sunucudan, sayılarıyla). */
  destinations: { iso: string; count: number }[];
  filters: OrderFilters;
  onChange: (f: OrderFilters) => void;
}) {
  const set = (p: Partial<OrderFilters>) => onChange({ ...filters, ...p });
  const { t, lang } = useT();
  const names = new Intl.DisplayNames([lang], { type: "region", fallback: "code" });
  return (
    <aside className="w-full shrink-0 lg:w-60 lg:sticky lg:self-start lg:overflow-y-auto lg:top-[14rem] lg:max-h-[calc(100vh-15rem)]">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <span className={heading}>{t("Gönderim tarihi", "Ship-by date")}</span>
        {(
          [
            ["all", t("Hepsi", "All")],
            ["overdue", t("Gecikmiş", "Overdue")],
            ["today", t("Bugün", "Today")],
            ["tomorrow", t("Yarın", "Tomorrow")],
            ["week", t("Bir hafta içinde", "Within a week")],
            ["none", t("Tahmini tarih yok", "No estimated date")],
          ] as [OrderFilters["shipBy"], string][]
        ).map(([v, l]) => (
          <Radio key={v} checked={filters.shipBy === v} onChange={() => set({ shipBy: v })}>
            {l}
          </Radio>
        ))}

        <span className={heading}>{t("Hedef", "Destination")}</span>
        <Radio checked={filters.destination === ""} onChange={() => set({ destination: "" })}>
          {t("Hepsi", "All")}
        </Radio>
        {destinations.slice(0, 8).map(({ iso, count: n }) => (
          <Radio key={iso} checked={filters.destination === iso} onChange={() => set({ destination: iso })} count={n}>
            {names.of(iso) ?? iso}
          </Radio>
        ))}

        <span className={heading}>{t("Kanal", "Channel")}</span>
        {(
          [
            ["all", t("Hepsi", "All")],
            ["etsy", "Etsy"],
            ["pattern", "Pattern"],
          ] as [OrderFilters["channel"], string][]
        ).map(([v, l]) => (
          <Radio key={v} checked={filters.channel === v} onChange={() => set({ channel: v })}>
            {l}
          </Radio>
        ))}

        <span className={heading}>{t("Sipariş detayları", "Order details")}</span>
        <Check checked={filters.note} onChange={(note) => set({ note })}>
          {t("Alıcı notu var", "Has buyer note")}
        </Check>
        <Check checked={filters.gift} onChange={(gift) => set({ gift })}>
          {t("Hediye olarak işaretlenmiş", "Marked as gift")}
        </Check>
        <Check checked={filters.personalized} onChange={(personalized) => set({ personalized })}>
          {t("Kişiselleştirilmiş", "Personalized")}
        </Check>

        <span className={heading}>{t("Kargo", "Shipping")}</span>
        <Check checked={filters.upgrade} onChange={(upgrade) => set({ upgrade })}>
          {t("Kargo yükseltmesi istendi", "Shipping upgrade requested")}
        </Check>

        <button
          type="button"
          onClick={() => onChange(EMPTY_ORDER_FILTERS)}
          className="mt-5 rounded-full bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100"
        >
          {t("Filtreleri sıfırla", "Reset filters")}
        </button>
      </div>
    </aside>
  );
}

"use client";

import { EMPTY_ORDER_FILTERS, OrderFilters } from "./orderUtils";

const names = new Intl.DisplayNames(["tr"], { type: "region", fallback: "code" });

function Radio({ checked, onChange, children, count }: { checked: boolean; onChange: () => void; children: React.ReactNode; count?: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">
      <input type="radio" checked={checked} onChange={onChange} className="accent-[#F1641E]" />
      {children}
      {count !== undefined && <span className="rounded bg-neutral-100 px-1.5 text-[11px] text-neutral-500 dark:bg-neutral-800">{count}</span>}
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#F1641E]" />
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
  return (
    <aside className="w-full shrink-0 lg:w-60">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <span className={heading}>Gönderim tarihi</span>
        {(
          [
            ["all", "Hepsi"],
            ["overdue", "Gecikmiş"],
            ["today", "Bugün"],
            ["tomorrow", "Yarın"],
            ["week", "Bir hafta içinde"],
            ["none", "Tahmini tarih yok"],
          ] as [OrderFilters["shipBy"], string][]
        ).map(([v, l]) => (
          <Radio key={v} checked={filters.shipBy === v} onChange={() => set({ shipBy: v })}>
            {l}
          </Radio>
        ))}

        <span className={heading}>Hedef</span>
        <Radio checked={filters.destination === ""} onChange={() => set({ destination: "" })}>
          Hepsi
        </Radio>
        {destinations.slice(0, 8).map(({ iso, count: n }) => (
          <Radio key={iso} checked={filters.destination === iso} onChange={() => set({ destination: iso })} count={n}>
            {names.of(iso) ?? iso}
          </Radio>
        ))}

        <span className={heading}>Kanal</span>
        {(
          [
            ["all", "Hepsi"],
            ["etsy", "Etsy"],
            ["pattern", "Pattern"],
          ] as [OrderFilters["channel"], string][]
        ).map(([v, l]) => (
          <Radio key={v} checked={filters.channel === v} onChange={() => set({ channel: v })}>
            {l}
          </Radio>
        ))}

        <span className={heading}>Sipariş detayları</span>
        <Check checked={filters.note} onChange={(note) => set({ note })}>
          Alıcı notu var
        </Check>
        <Check checked={filters.gift} onChange={(gift) => set({ gift })}>
          Hediye olarak işaretlenmiş
        </Check>
        <Check checked={filters.personalized} onChange={(personalized) => set({ personalized })}>
          Kişiselleştirilmiş
        </Check>

        <span className={heading}>Kargo</span>
        <Check checked={filters.upgrade} onChange={(upgrade) => set({ upgrade })}>
          Kargo yükseltmesi istendi
        </Check>

        <button
          type="button"
          onClick={() => onChange(EMPTY_ORDER_FILTERS)}
          className="mt-5 rounded-full bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100"
        >
          Filtreleri sıfırla
        </button>
      </div>
    </aside>
  );
}

"use client";

import { useMemo } from "react";
import { Listing, ProductionPartner, ReturnPolicy, ShippingProfile, ShopSection } from "@/lib/api";

export type Filters = {
  status: string; // "all" | Etsy state
  local: "all" | "unpublished" | "draft";
  section: string;
  shipping: string;
  returnPolicy: string;
  partner: string;
  video: "all" | "with" | "without";
  tag: string;
};

export const EMPTY_FILTERS: Filters = {
  status: "all",
  local: "all",
  section: "",
  shipping: "",
  returnPolicy: "",
  partner: "",
  video: "all",
  tag: "",
};

export type Reference = {
  sections: ShopSection[];
  shipping: ShippingProfile[];
  returns: ReturnPolicy[];
  partners: ProductionPartner[];
};

const STATUSES: [string, string][] = [
  ["active", "Aktif"],
  ["draft", "Taslak"],
  ["expired", "Süresi dolmuş"],
  ["sold_out", "Tükenmiş"],
  ["inactive", "Pasif"],
];

export function applyFilters(listings: Listing[], f: Filters): Listing[] {
  return listings.filter((l) => {
    if (f.status !== "all" && (l.state ?? "active") !== f.status) return false;
    if (f.local === "unpublished" && !l.has_local) return false;
    if (f.local === "draft" && !l.has_draft) return false;
    if (f.section && String(l.shop_section_id ?? "") !== f.section) return false;
    if (f.shipping && String(l.shipping_profile_id ?? "") !== f.shipping) return false;
    if (f.returnPolicy && String(l.return_policy_id ?? "") !== f.returnPolicy) return false;
    if (f.partner && !(l.production_partner_ids ?? []).includes(Number(f.partner))) return false;
    if (f.video === "with" && !l.has_video) return false;
    if (f.video === "without" && l.has_video) return false;
    if (f.tag && !l.tags.includes(f.tag)) return false;
    return true;
  });
}

export function returnPolicyLabel(p: ReturnPolicy): string {
  if (!p.accepts_returns && !p.accepts_exchanges) return "İade/değişim kabul edilmiyor";
  const what = p.accepts_returns && p.accepts_exchanges ? "İade ve değişim" : p.accepts_returns ? "İade" : "Değişim";
  return p.return_deadline ? `${what} · ${p.return_deadline} gün` : what;
}

const label = "mb-2 mt-5 block text-sm font-semibold text-neutral-900 dark:text-neutral-100";
const select =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

function Radio({
  checked,
  onChange,
  children,
  count,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
  count?: number;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 py-0.5 text-sm ${disabled ? "text-neutral-400" : "cursor-pointer text-neutral-700 dark:text-neutral-200"}`}>
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} className="accent-[#F1641E]" />
      {children}
      {count !== undefined && <span className="rounded bg-neutral-100 px-1.5 text-[11px] text-neutral-500 dark:bg-neutral-800">{count}</span>}
    </label>
  );
}

/** Etsy Shop Manager'ın sağ filtre paneli. Sayaçlar yerel veriden hesaplanır (Etsy'ye istek yok). */
export default function ListingFilters({
  listings,
  filters,
  onChange,
  reference,
}: {
  listings: Listing[];
  filters: Filters;
  onChange: (f: Filters) => void;
  reference: Reference;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const counts = useMemo(() => {
    const byState: Record<string, number> = {};
    let withVideo = 0;
    let unpublished = 0;
    let drafts = 0;
    const tagCounts = new Map<string, number>();
    for (const l of listings) {
      const st = l.state ?? "active";
      byState[st] = (byState[st] ?? 0) + 1;
      if (l.has_video) withVideo++;
      if (l.has_local) unpublished++;
      if (l.has_draft) drafts++;
      l.tags.forEach((t) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1));
    }
    const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { byState, withVideo, unpublished, drafts, tags };
  }, [listings]);

  return (
    <aside className="w-full shrink-0 lg:w-64">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">Listing durumu</span>
        <div className="mt-2">
          <Radio checked={filters.status === "all"} onChange={() => set({ status: "all" })} count={listings.length}>
            Tümü
          </Radio>
          {STATUSES.map(([key, name]) => (
            <Radio
              key={key}
              checked={filters.status === key}
              onChange={() => set({ status: key })}
              count={counts.byState[key] ?? 0}
              disabled={!counts.byState[key]}
            >
              {name}
            </Radio>
          ))}
        </div>

        <span className={label}>Yerel değişiklikler</span>
        <Radio checked={filters.local === "all"} onChange={() => set({ local: "all" })}>
          Hepsi
        </Radio>
        <Radio checked={filters.local === "unpublished"} onChange={() => set({ local: "unpublished" })} count={counts.unpublished}>
          Yayınlanmamış
        </Radio>
        <Radio checked={filters.local === "draft"} onChange={() => set({ local: "draft" })} count={counts.drafts}>
          Taslağı olan
        </Radio>

        <label className={label}>Bölümler</label>
        <select className={select} value={filters.section} onChange={(e) => set({ section: e.target.value })}>
          <option value="">Tümü</option>
          {reference.sections.map((s) => (
            <option key={s.shop_section_id} value={s.shop_section_id}>
              {s.title}
            </option>
          ))}
        </select>

        <label className={label}>Kargo profilleri</label>
        <select className={select} value={filters.shipping} onChange={(e) => set({ shipping: e.target.value })}>
          <option value="">Tümü</option>
          {reference.shipping.map((s) => (
            <option key={s.shipping_profile_id} value={s.shipping_profile_id}>
              {s.title}
            </option>
          ))}
        </select>

        <label className={label}>İade ve değişim politikaları</label>
        <select className={select} value={filters.returnPolicy} onChange={(e) => set({ returnPolicy: e.target.value })}>
          <option value="">Tümü</option>
          {reference.returns.map((r) => (
            <option key={r.return_policy_id} value={r.return_policy_id}>
              {returnPolicyLabel(r)}
            </option>
          ))}
        </select>

        <label className={label}>Üretim ortakları</label>
        <select className={select} value={filters.partner} onChange={(e) => set({ partner: e.target.value })}>
          <option value="">Tümü</option>
          {reference.partners.map((p) => (
            <option key={p.production_partner_id} value={p.production_partner_id}>
              {p.partner_name}
            </option>
          ))}
        </select>

        <span className={label}>Listing videoları</span>
        <Radio checked={filters.video === "all"} onChange={() => set({ video: "all" })} count={listings.length}>
          Tümü
        </Radio>
        <Radio checked={filters.video === "with"} onChange={() => set({ video: "with" })} count={counts.withVideo}>
          Videolu
        </Radio>
        <Radio checked={filters.video === "without"} onChange={() => set({ video: "without" })} count={listings.length - counts.withVideo}>
          Videosuz
        </Radio>

        <label className={label}>Etiketler</label>
        <select className={select} value={filters.tag} onChange={(e) => set({ tag: e.target.value })}>
          <option value="">Tümü</option>
          {counts.tags.map(([tag, n]) => (
            <option key={tag} value={tag}>
              {tag} ({n})
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="mt-5 text-xs font-medium text-neutral-500 hover:underline"
        >
          Filtreleri temizle
        </button>
      </div>
    </aside>
  );
}

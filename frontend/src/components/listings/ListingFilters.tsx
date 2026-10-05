"use client";

import { useMemo, useState } from "react";
import { Listing, ProductionPartner, ReturnPolicy, ShippingProfile, ShopSection } from "@/lib/api";
import { Modal } from "@/components/listing-editor/Modal";
import ShopSectionsSection from "@/components/shipping/ShopSectionsSection";
import { ReconnectNotice } from "@/components/shipping/shared";
import { T, useT } from "@/lib/i18n-client";

export type Filters = {
  status: string; // "all" | Etsy state
  local: "all" | "unpublished" | "draft";
  section: string;
  shipping: string;
  returnPolicy: string;
  partner: string;
  video: "all" | "with" | "without";
  tag: string;
  trend: "all" | "declining" | "faded";
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
  trend: "all",
};

export type Reference = {
  sections: ShopSection[];
  shipping: ShippingProfile[];
  returns: ReturnPolicy[];
  partners: ProductionPartner[];
};

const STATUSES: [string, string, string][] = [
  ["active", "Aktif", "Active"],
  ["draft", "Taslak", "Draft"],
  ["expired", "Süresi dolmuş", "Expired"],
  ["sold_out", "Tükenmiş", "Sold out"],
  ["inactive", "Pasif", "Inactive"],
];

/**
 * `declining`: satışı düşen listing'lerin kimlikleri (bkz. api.insights.attention); `faded`: sönmüş aktif listing'lerin
 * kimlikleri (bkz. api.insights.faded). Yoksa ilgili filtre boş sonuç verir.
 */
export function applyFilters(listings: Listing[], f: Filters, declining?: Set<number>, faded?: Set<number>): Listing[] {
  return listings.filter((l) => {
    if (f.trend === "declining" && !declining?.has(l.listing_id)) return false;
    if (f.trend === "faded" && !faded?.has(l.listing_id)) return false;
    if (!l.is_new && f.status !== "all" && (l.state ?? "active") !== f.status) return false;
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

const trOnly: T = (tr) => tr;

export function returnPolicyLabel(p: ReturnPolicy, t: T = trOnly): string {
  if (!p.accepts_returns && !p.accepts_exchanges) return t("İade/değişim kabul edilmiyor", "No returns or exchanges");
  const what =
    p.accepts_returns && p.accepts_exchanges ? t("İade ve değişim", "Returns and exchanges") : p.accepts_returns ? t("İade", "Returns") : t("Değişim", "Exchanges");
  return p.return_deadline ? `${what} · ${p.return_deadline} ${t("gün", "days")}` : what;
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
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} className="accent-[#D97757]" />
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
  shopId,
  onSectionsChanged,
  decliningCount,
  fadedCount,
}: {
  listings: Listing[];
  filters: Filters;
  onChange: (f: Filters) => void;
  reference: Reference;
  shopId: number;
  /** Bölümler modalinde ekle/yeniden adlandır/sil sonrası çağrılır — filtre listesi Etsy'den tazelenir. */
  onSectionsChanged: () => void;
  /** Satışı düşen listing sayısı (teşhis hesaplanınca); yoksa "Düşüşte" seçeneği sayısız görünür. */
  decliningCount?: number;
  /** Sönmüş aktif listing sayısı; yüklenmediyse sayısız görünür. */
  fadedCount?: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const { t } = useT();
  const [manageSections, setManageSections] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  const counts = useMemo(() => {
    const byState: Record<string, number> = {};
    let withVideo = 0;
    let unpublished = 0;
    let drafts = 0;
    const tagCounts = new Map<string, number>();
    for (const l of listings) {
      const st = l.state ?? "active";
      if (!l.is_new) byState[st] = (byState[st] ?? 0) + 1; // yeni yerel listing'ler Etsy durum sayısını şişirmesin
      if (l.has_video) withVideo++;
      if (l.has_local) unpublished++;
      if (l.has_draft) drafts++;
      l.tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1));
    }
    const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { byState, withVideo, unpublished, drafts, tags };
  }, [listings]);

  return (
    <aside className="w-full shrink-0 lg:w-64 lg:sticky lg:self-start lg:overflow-y-auto lg:top-[14rem] lg:max-h-[calc(100vh-15rem)]">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Listing durumu", "Listing status")}</span>
        <div className="mt-2">
          <Radio checked={filters.status === "all"} onChange={() => set({ status: "all" })} count={listings.length}>
            {t("Tümü", "All")}
          </Radio>
          {STATUSES.map(([key, tr, en]) => (
            <Radio
              key={key}
              checked={filters.status === key}
              onChange={() => set({ status: key })}
              count={counts.byState[key] ?? 0}
              disabled={!counts.byState[key]}
            >
              {t(tr, en)}
            </Radio>
          ))}
        </div>

        <span className={label}>{t("Satış eğilimi", "Sales trend")}</span>
        <Radio checked={filters.trend === "all"} onChange={() => set({ trend: "all" })}>
          {t("Hepsi", "All")}
        </Radio>
        <Radio checked={filters.trend === "declining"} onChange={() => set({ trend: "declining" })} count={decliningCount}>
          {t("Düşüşte (son 12 ay)", "Declining (last 12 months)")}
        </Radio>
        <Radio checked={filters.trend === "faded"} onChange={() => set({ trend: "faded" })} count={fadedCount}>
          <span title={t("Eskiden satan (en az 3 satış) ama 90 gündür hiç satmayan aktif listing'ler", "Active listings that used to sell (3+ sales) but have had no sales for 90 days")}>
            {t("Sönmüş (90+ gün satışsız)", "Faded (no sales 90+ days)")}
          </span>
        </Radio>

        <span className={label}>{t("Yerel değişiklikler", "Local changes")}</span>
        <Radio checked={filters.local === "all"} onChange={() => set({ local: "all" })}>
          {t("Hepsi", "All")}
        </Radio>
        <Radio checked={filters.local === "unpublished"} onChange={() => set({ local: "unpublished" })} count={counts.unpublished}>
          {t("Yayınlanmamış", "Unpublished")}
        </Radio>
        <Radio checked={filters.local === "draft"} onChange={() => set({ local: "draft" })} count={counts.drafts}>
          {t("Taslağı olan", "Has draft")}
        </Radio>

        <div className="mt-5 flex items-baseline justify-between">
          <label className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Bölümler", "Sections")}</label>
          <button
            type="button"
            onClick={() => setManageSections(true)}
            className="text-xs font-medium text-[#D97757] hover:underline"
          >
            {t("Yönet", "Manage")}
          </button>
        </div>
        <select className={`${select} mt-2`} value={filters.section} onChange={(e) => set({ section: e.target.value })}>
          <option value="">{t("Tümü", "All")}</option>
          {reference.sections.map((s) => (
            <option key={s.shop_section_id} value={s.shop_section_id}>
              {s.title}
            </option>
          ))}
        </select>

        <label className={label}>{t("Kargo profilleri", "Shipping profiles")}</label>
        <select className={select} value={filters.shipping} onChange={(e) => set({ shipping: e.target.value })}>
          <option value="">{t("Tümü", "All")}</option>
          {reference.shipping.map((s) => (
            <option key={s.shipping_profile_id} value={s.shipping_profile_id}>
              {s.title}
            </option>
          ))}
        </select>

        <label className={label}>{t("İade ve değişim politikaları", "Return and exchange policies")}</label>
        <select className={select} value={filters.returnPolicy} onChange={(e) => set({ returnPolicy: e.target.value })}>
          <option value="">{t("Tümü", "All")}</option>
          {reference.returns.map((r) => (
            <option key={r.return_policy_id} value={r.return_policy_id}>
              {returnPolicyLabel(r, t)}
            </option>
          ))}
        </select>

        <label className={label}>{t("Üretim ortakları", "Production partners")}</label>
        <select className={select} value={filters.partner} onChange={(e) => set({ partner: e.target.value })}>
          <option value="">{t("Tümü", "All")}</option>
          {reference.partners.map((p) => (
            <option key={p.production_partner_id} value={p.production_partner_id}>
              {p.partner_name}
            </option>
          ))}
        </select>

        <span className={label}>{t("Listing videoları", "Listing videos")}</span>
        <Radio checked={filters.video === "all"} onChange={() => set({ video: "all" })} count={listings.length}>
          {t("Tümü", "All")}
        </Radio>
        <Radio checked={filters.video === "with"} onChange={() => set({ video: "with" })} count={counts.withVideo}>
          {t("Videolu", "With video")}
        </Radio>
        <Radio checked={filters.video === "without"} onChange={() => set({ video: "without" })} count={listings.length - counts.withVideo}>
          {t("Videosuz", "Without video")}
        </Radio>

        <label className={label}>{t("Etiketler", "Tags")}</label>
        <select className={select} value={filters.tag} onChange={(e) => set({ tag: e.target.value })}>
          <option value="">{t("Tümü", "All")}</option>
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
          {t("Filtreleri temizle", "Clear filters")}
        </button>
      </div>

      {manageSections && (
        <Modal z={95} widthClass="max-w-lg" title={t("Bölümleri yönet", "Manage sections")} onClose={() => setManageSections(false)}>
          {needsReconnect && (
            <div className="mb-4">
              <ReconnectNotice compact />
            </div>
          )}
          <ShopSectionsSection
            shopId={shopId}
            sections={reference.sections}
            onChanged={onSectionsChanged}
            onPermissionError={() => setNeedsReconnect(true)}
            compact
          />
        </Modal>
      )}
    </aside>
  );
}

"use client";

import { inputClass } from "@/components/admin/ui";
import { IntegerInput } from "@/components/ui/NumberInputs";
import { useResponsiveFilters } from "@/components/ui/ResponsiveFilters";
import { useT } from "@/lib/i18n-client";
import { KeywordFilters, KeywordSort, advancedFilterCount } from "@/lib/researchApi";
import { useSourceLabels } from "./shared";

const ADVANCED_OFF = { source: "", pinned: "", intent: "", minVolume: "", maxVolume: "", expiringDays: "", unusedDays: "", etsy: false } as const;

/** Kelime listesinin süzgeçleri: hızlı çubuk (arama, durum, sıralama) her zaman görünür; gelişmiş süzgeçler masaüstünde yerinde, telefonda alttan açılan panelde. */
export default function KeywordFilterBar({
  filters,
  onChange,
  sort,
  onSort,
  forMap = false,
}: {
  filters: KeywordFilters;
  onChange: (f: KeywordFilters) => void;
  sort?: KeywordSort;
  onSort?: (s: KeywordSort) => void;
  /** Ülke haritasında kullanılırken: sıralama ve "metrik yok" seçeneği anlamsızdır, gizlenir (harita yalnızca ölçümü olan kelimeleri toplar). */
  forMap?: boolean;
}) {
  const { t } = useT();
  const sources = useSourceLabels();
  const set = (patch: Partial<KeywordFilters>) => onChange({ ...filters, ...patch });

  const advanced = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t("İlk kaynak", "First source")}
        <select value={filters.source} onChange={(e) => set({ source: e.target.value })} className={inputClass}>
          <option value="">{t("Tümü", "All")}</option>
          {Object.entries(sources).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t("Sabitleme", "Pinned")}
        <select value={filters.pinned} onChange={(e) => set({ pinned: e.target.value })} className={inputClass}>
          <option value="">{t("Tümü", "All")}</option>
          <option value="yes">{t("Sabitli", "Pinned")}</option>
          <option value="no">{t("Sabitli değil", "Not pinned")}</option>
        </select>
      </label>
      <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t("Niyet", "Intent")}
        <select value={filters.intent} onChange={(e) => set({ intent: e.target.value })} className={inputClass}>
          <option value="">{t("Tümü", "All")}</option>
          <option value="informational">{t("Bilgi arıyor", "Informational")}</option>
          <option value="commercial">{t("Karşılaştırıyor", "Commercial")}</option>
          <option value="transactional">{t("Satın almaya yakın", "Transactional")}</option>
          <option value="navigational">{t("Belirli yer arıyor", "Navigational")}</option>
        </select>
      </label>
      <label className="flex items-end gap-2 pb-2 text-xs text-neutral-600 dark:text-neutral-300">
        <input type="checkbox" checked={filters.etsy} onChange={(e) => set({ etsy: e.target.checked })} />
        {t("Etsy verisi olanlar", "With Etsy data")}
      </label>
      <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t("En az aylık arama", "Min monthly searches")}
        <IntegerInput value={filters.minVolume} onValue={(v) => set({ minVolume: v })} className={inputClass} />
      </label>
      <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t("En çok aylık arama", "Max monthly searches")}
        <IntegerInput value={filters.maxVolume} onValue={(v) => set({ maxVolume: v })} className={inputClass} />
      </label>
      <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t("Ölçümü şu kadar günde dolacak", "Measurement expires within")}
        <IntegerInput value={filters.expiringDays} onValue={(v) => set({ expiringDays: v })} unit={t("gün", "days")} className={inputClass} />
      </label>
      <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t("Şu kadar gündür kullanılmayan", "Unused for")}
        <IntegerInput value={filters.unusedDays} onValue={(v) => set({ unusedDays: v })} unit={t("gün", "days")} className={inputClass} />
      </label>
    </div>
  );

  const { button, panel } = useResponsiveFilters({ activeCount: advancedFilterCount(filters), onReset: () => set(ADVANCED_OFF), children: advanced });

  return (
    <div className="mb-3 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder={t("Kelime ara…", "Search keywords…")} className={`${inputClass} sm:max-w-xs`} />
        <select value={filters.state} onChange={(e) => set({ state: e.target.value })} className={`${inputClass} sm:w-44`} aria-label={t("Veri durumu", "Data state")}>
          <option value="">{t("Tüm veri durumları", "All data states")}</option>
          <option value="fresh">{t("Güncel", "Fresh")}</option>
          <option value="stale">{t("Yenilenmeli", "Stale")}</option>
          {!forMap && <option value="missing">{t("Metrik yok", "No metrics")}</option>}
        </select>
        <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className={`${inputClass} sm:w-44`} aria-label={t("Yönetim durumu", "Management status")}>
          <option value="">{t("Tüm kelimeler", "All keywords")}</option>
          <option value="active">{t("Normal", "Active")}</option>
          <option value="archived">{t("Arşivli", "Archived")}</option>
          <option value="blocked">{t("Engelli", "Blocked")}</option>
        </select>
        {!forMap && sort && onSort && (
        <select value={sort} onChange={(e) => onSort(e.target.value as KeywordSort)} className={`${inputClass} sm:w-52`} aria-label={t("Sıralama", "Sort")}>
          <option value="new">{t("En yeni eklenen", "Newest first")}</option>
          <option value="volume">{t("Aylık arama (çoktan aza)", "Monthly searches (high → low)")}</option>
          <option value="cpc">{t("CPC (yüksekten düşüğe)", "CPC (high → low)")}</option>
          <option value="difficulty">{t("Zorluk (yüksekten düşüğe)", "Difficulty (high → low)")}</option>
          <option value="measured">{t("Son ölçülen", "Recently measured")}</option>
          <option value="expires">{t("Yenilenmesi en yakın", "Refresh due soonest")}</option>
          <option value="used">{t("Son kullanılan", "Recently used")}</option>
        </select>
        )}
        {button}
      </div>
      {panel}
    </div>
  );
}

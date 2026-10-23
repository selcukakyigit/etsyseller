"use client";

import { Button } from "@/components/admin/ui";
import { IntegerInput } from "@/components/ui/NumberInputs";
import type { Intent } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { EMPTY_FILTERS, Filters, filtersActive } from "./table";

const field =
  "rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";

/** Süzgeçler: kelime içerir / içermez, hacim aralığı, niyet, yalnızca sorular, sende olanları gizle; ayrıca kelime grupları (en sık geçen kelimeler). */
export default function FilterBar({
  filters,
  onChange,
  groups,
  shown,
  total,
  volume,
  rowCount,
  showVariants,
  onShowVariants,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  groups: { word: string; count: number }[];
  shown: number;
  total: number;
  volume: number;
  /** Tabloda görünen satır sayısı (varyantlar toplanmışsa `shown`dan azdır) */
  rowCount: number;
  showVariants: boolean;
  onShowVariants: (v: boolean) => void;
}) {
  const { t, locale } = useT();
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const toggleWord = (word: string) => set({ words: filters.words.includes(word) ? filters.words.filter((w) => w !== word) : [...filters.words, word] });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={filters.include} onChange={(e) => set({ include: e.target.value })} placeholder={t("Şunları içersin…", "Include words…")} aria-label={t("İçerilecek kelimeler", "Words to include")} className={`${field} w-40`} />
        <input value={filters.exclude} onChange={(e) => set({ exclude: e.target.value })} placeholder={t("Şunları içermesin…", "Exclude words…")} aria-label={t("İçerilmeyecek kelimeler", "Words to exclude")} className={`${field} w-40`} />
        <IntegerInput value={filters.minVolume} onValue={(v) => set({ minVolume: v })} placeholder={t("En az hacim", "Min volume")} aria-label={t("En az aylık arama", "Minimum monthly searches")} className={`${field} w-32`} />
        <IntegerInput value={filters.maxVolume} onValue={(v) => set({ maxVolume: v })} placeholder={t("En çok hacim", "Max volume")} aria-label={t("En çok aylık arama", "Maximum monthly searches")} className={`${field} w-32`} />
        <select value={filters.intent} onChange={(e) => set({ intent: e.target.value as Intent | "" })} aria-label={t("Alıcı niyeti", "Buyer intent")} className={field}>
          <option value="">{t("Tüm niyetler", "All intents")}</option>
          <option value="informational">{t("Bilgi arıyor", "Researching")}</option>
          <option value="commercial">{t("Karşılaştırıyor", "Comparing")}</option>
          <option value="transactional">{t("Almaya yakın", "Ready to buy")}</option>
          <option value="navigational">{t("Belirli yer", "Specific site")}</option>
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={filters.hideMine} onChange={(e) => set({ hideMine: e.target.checked })} className="h-4 w-4 accent-[#D97757]" />
          {t("Sendekileri gizle", "Hide ones I use")}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300" title={t("Aynı aramanın söz dizimi varyantlarını (kelime sırası, çoğul, 'for/the…') ayrı satırlarda göster", "Show wording variants of the same search (word order, plural, 'for/the…') as separate rows")}>
          <input type="checkbox" checked={showVariants} onChange={(e) => onShowVariants(e.target.checked)} className="h-4 w-4 accent-[#D97757]" />
          {t("Varyasyonları ayır", "Split variants")}
        </label>
        {filtersActive(filters) && <Button onClick={() => onChange(EMPTY_FILTERS)}>{t("Süzgeçleri temizle", "Clear filters")}</Button>}
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label={t("Kelime grupları", "Keyword groups")}>
          <span className="text-xs text-neutral-400 dark:text-neutral-500">{t("Gruplar:", "Groups:")}</span>
          {groups.map((g) => {
            const on = filters.words.includes(g.word);
            return (
              <button
                key={g.word}
                type="button"
                aria-pressed={on}
                onClick={() => toggleWord(g.word)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  on ? "border-[#D97757] bg-[#D97757]/10 font-medium text-neutral-900 dark:text-neutral-100" : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {g.word} <span className="text-neutral-400">{g.count.toLocaleString(locale)}</span>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {t(
          `${shown.toLocaleString(locale)} / ${total.toLocaleString(locale)} anahtar kelime${rowCount !== shown ? ` (${rowCount.toLocaleString(locale)} grup)` : ""} · toplam hacim ${volume.toLocaleString(locale)}`,
          `${shown.toLocaleString(locale)} / ${total.toLocaleString(locale)} keywords${rowCount !== shown ? ` (${rowCount.toLocaleString(locale)} groups)` : ""} · total volume ${volume.toLocaleString(locale)}`,
        )}
      </p>
    </div>
  );
}

"use client";

import { tNow as t } from "@/lib/i18n";

const WHEN_MADE_OPTIONS = [
  ["made_to_order", "Sipariş üzerine üretim", "Made to order"],
  ["2020_2026", "2020–2026", "2020–2026"],
  ["2010_2019", "2010–2019", "2010–2019"],
  ["2007_2009", "2007–2009", "2007–2009"],
  ["before_2007", "2007 öncesi", "Before 2007"],
  ["2000_2006", "2000–2006", "2000–2006"],
  ["1990s", "1990'lar", "1990s"],
  ["1980s", "1980'ler", "1980s"],
  ["1970s", "1970'ler", "1970s"],
  ["before_1700", "1700 öncesi", "Before 1700"],
] as const;

// Etsy'nin değerleri: collective = mağazanın bir üyesi, someone_else = başka bir şirket/kişi.
const WHO_MADE_OPTIONS = [
  ["i_did", "Ben yaptım", "I did"],
  ["collective", "Mağazamdaki biri yaptı", "A member of my shop"],
  ["someone_else", "Başka bir şirket/kişi yaptı", "Another company or person"],
] as const;

export default function HowItsMade({
  whoMade,
  whenMade,
  isSupply,
  onChange,
}: {
  whoMade: string | null;
  whenMade: string | null;
  isSupply: boolean;
  onChange: (patch: { who_made?: string; when_made?: string; is_supply?: boolean }) => void;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Nasıl Yapıldı", "How it's made")}</h2>

      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Kim yaptı?", "Who made it?")}</p>
          <div className="flex flex-wrap gap-2">
            {WHO_MADE_OPTIONS.map(([value, tr, en]) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ who_made: value })}
                className={`text-sm px-3 py-1.5 rounded-lg border transition ${
                  whoMade === value
                    ? "border-[#D97757] bg-[#D97757]/10 text-[#B4553A]"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {t(tr, en)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Ne zaman yapıldı?", "When was it made?")}</label>
          <select
            value={whenMade ?? ""}
            onChange={(e) => onChange({ when_made: e.target.value })}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 sm:w-64"
          >
            <option value="" disabled>
              {t("Seç…", "Choose…")}
            </option>
            {WHEN_MADE_OPTIONS.map(([value, tr, en]) => (
              <option key={value} value={value}>
                {t(tr, en)}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={isSupply}
            onChange={(e) => onChange({ is_supply: e.target.checked })}
            className="rounded border-neutral-300"
          />
          {t("Bu bir malzeme/tedarik ürünü (bitmiş ürün değil)", "This is a craft supply or tool (not a finished product)")}
        </label>
      </div>
    </section>
  );
}

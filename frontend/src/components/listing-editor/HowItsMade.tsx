"use client";

const WHEN_MADE_OPTIONS = [
  ["made_to_order", "Sipariş üzerine üretim"],
  ["2020_2026", "2020–2026"],
  ["2010_2019", "2010–2019"],
  ["2007_2009", "2007–2009"],
  ["before_2007", "2007 öncesi"],
  ["2000_2006", "2000–2006"],
  ["1990s", "1990'lar"],
  ["1980s", "1980'ler"],
  ["1970s", "1970'ler"],
  ["before_1700", "1700 öncesi"],
] as const;

const WHO_MADE_OPTIONS = [
  ["i_did", "Ben yaptım"],
  ["someone_else", "Mağazamdaki biri yaptı"],
  ["collective", "Başka bir şirket/kişi yaptı"],
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
      <h2 className="mb-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Nasıl Yapıldı</h2>

      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">Kim yaptı?</p>
          <div className="flex flex-wrap gap-2">
            {WHO_MADE_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ who_made: value })}
                className={`text-sm px-3 py-1.5 rounded-lg border transition ${
                  whoMade === value
                    ? "border-[#F1641E] bg-[#F1641E]/10 text-[#c94f16]"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Ne zaman yapıldı?</label>
          <select
            value={whenMade ?? ""}
            onChange={(e) => onChange({ when_made: e.target.value })}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#F1641E] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 sm:w-64"
          >
            <option value="" disabled>
              Seç…
            </option>
            {WHEN_MADE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
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
          Bu bir malzeme/tedarik ürünü (bitmiş ürün değil)
        </label>
      </div>
    </section>
  );
}

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
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900 mb-4">Nasıl Yapıldı</h2>

      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-neutral-500 mb-1.5">Kim yaptı?</p>
          <div className="flex flex-wrap gap-2">
            {WHO_MADE_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ who_made: value })}
                className={`text-sm px-3 py-1.5 rounded-lg border transition ${
                  whoMade === value
                    ? "border-[#F1641E] bg-[#F1641E]/10 text-[#c94f16]"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1.5">Ne zaman yapıldı?</label>
          <select
            value={whenMade ?? ""}
            onChange={(e) => onChange({ when_made: e.target.value })}
            className="w-full sm:w-64 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
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

        <label className="flex items-center gap-2 text-sm text-neutral-600">
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

"use client";

import { useState } from "react";
import type { ChatCard } from "@/lib/api";
import { priceApi } from "@/lib/priceApi";
import { MoneyInput } from "@/components/ui/NumberInputs";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";

type DraftCard = Extract<ChatCard, { type: "listing_draft" }>;

const MIN_PRICE = 0.2;
const inputCls = "w-28 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

/** Fiyatı eksik taslak kartının altındaki fiyat kutuları: varyasyon varsa her seçenek için bir kutu ("hepsi aynı" kısayoluyla), yoksa tek kutu.
 *  Yazılanlar asistanın edit_inventory aracıyla aynı işlevle (POST …/listings/{id}/prices) doğrudan taslağa yazılır; model çağrılmaz. */
export default function PriceBoxes({ shopId, listingId, form, onApplied }: { shopId: number; listingId: number; form: { variation: string | null; options: string[] }; onApplied: (card: DraftCard) => void }) {
  const { t } = useT();
  const rows = form.variation ? form.options : [""];
  const [values, setValues] = useState<Record<string, string>>({});
  const [all, setAll] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = rows.every((r) => Number(values[r]) >= MIN_PRICE);
  const setEvery = (v: string) => {
    setAll(v);
    setValues(Object.fromEntries(rows.map((r) => [r, v])));
  };
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const card = await priceApi.set(shopId, listingId, { variation: form.variation, prices: rows.map((r) => ({ option: form.variation ? r : null, price: Number(values[r]) })) });
      onApplied(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Fiyat yazılamadı.", "Could not save the price."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
      <div className="mb-1.5 font-semibold text-amber-700 dark:text-amber-400">{form.variation ? t(`Fiyat gir (${form.variation} başına)`, `Set the price (per ${form.variation})`) : t("Fiyat gir", "Set the price")}</div>
      {form.variation && rows.length > 1 && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-neutral-600 dark:text-neutral-300">{t("Hepsi aynı fiyat", "Same price for all")}</span>
          <MoneyInput value={all} onValue={setEvery} unit="$" className={inputCls} placeholder="0.00" />
        </div>
      )}
      <div className="max-h-48 space-y-1.5 overflow-auto">
        {rows.map((r) => (
          <div key={r || "single"} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-200">{r || t("Fiyat", "Price")}</span>
            <MoneyInput value={values[r] ?? ""} onValue={(v) => setValues((prev) => ({ ...prev, [r]: v }))} unit="$" className={inputCls} placeholder="0.00" />
          </div>
        ))}
      </div>
      {error && <div className="mt-1.5 text-red-600 dark:text-red-400">{error}</div>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={apply}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#D97757] px-3 py-1.5 font-semibold text-white hover:bg-[#C6613F] disabled:opacity-50"
        >
          {busy && <Spinner size={12} />}
          {t("Fiyatı uygula", "Apply price")}
        </button>
      </div>
    </div>
  );
}

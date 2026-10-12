"use client";

import { Switch } from "@/components/listing-editor/Modal";
import { T, useT } from "@/lib/i18n-client";
import { Entity, EntityInput } from "../core/api";
import { input, label } from "../core/ui";
import CurrencySelect from "./CurrencySelect";
import DecimalInput from "@/components/ui/NumberInputs";

/** Kayıt formunun ortak alanları (oluşturma ve ayarlar aynı bileşeni kullanır). KDV metin olarak tutulur ki yazarken
 * "20," gibi ara değerler bozulmasın; kaydederken `parseEntityFields` sayıya çevirir. */
export type EntityFieldValues = { name: string; label: string; currency: string; vat_rate: string; vat_in_cost: boolean };

export const emptyEntityFields = (): EntityFieldValues => ({ name: "", label: "", currency: "TRY", vat_rate: "20", vat_in_cost: false });

export const entityFieldsFrom = (e: Pick<Entity, "name" | "label" | "currency" | "vat_rate" | "vat_in_cost">): EntityFieldValues => ({
  name: e.name,
  label: e.label,
  currency: e.currency,
  vat_rate: String(e.vat_rate),
  vat_in_cost: e.vat_in_cost,
});

/** Doğrulanmış girdi; geçersizse kullanıcıya gösterilecek hata metni. */
export function parseEntityFields(f: EntityFieldValues, t: T): { ok: true; value: EntityInput } | { ok: false; error: string } {
  const vat = Number(f.vat_rate.replace(",", "."));
  if (!f.name.trim() || !Number.isFinite(vat) || vat < 0 || vat > 100) {
    return { ok: false, error: t("Ad ve 0-100 arası KDV gir.", "Enter a name and VAT between 0 and 100.") };
  }
  return { ok: true, value: { name: f.name.trim(), label: f.label.trim(), currency: f.currency, vat_rate: vat, vat_in_cost: f.vat_in_cost } };
}

export default function EntityFields({
  value,
  onChange,
  namePlaceholder,
  labelTitle,
  labelPlaceholder,
  autoFocus,
}: {
  value: EntityFieldValues;
  onChange: (v: EntityFieldValues) => void;
  namePlaceholder?: string;
  labelTitle?: string;
  labelPlaceholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useT();
  const set = (p: Partial<EntityFieldValues>) => onChange({ ...value, ...p });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={label}>{t("Ad", "Name")}</label>
        <input autoFocus={autoFocus} value={value.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder={namePlaceholder} className={`${input} w-full`} />
      </div>
      <div>
        <label className={label}>{labelTitle ?? t("Etiket", "Label")}</label>
        <input value={value.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} placeholder={labelPlaceholder} className={`${input} w-full`} />
      </div>
      <div>
        <label className={label}>{t("Para birimi", "Currency")}</label>
        <CurrencySelect value={value.currency} onChange={(c) => set({ currency: c })} className="w-full" />
        <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">{t("Yeni işler bu para biriminde açılır.", "New jobs use this currency.")}</p>
      </div>
      <div>
        <label className={label}>{t("KDV oranı (%)", "VAT rate (%)")}</label>
        <DecimalInput value={value.vat_rate} onValue={(v) => set({ vat_rate: v })} className={`${input} w-24`} />
        <div className="mt-2 flex items-center gap-2">
          <Switch checked={value.vat_in_cost} onChange={(v) => set({ vat_in_cost: v })} label={t("KDV maliyete dahil", "VAT is part of cost")} />
          <span className="text-xs text-neutral-600 dark:text-neutral-300">{t("KDV maliyete eklensin (indiremiyorsan)", "Add VAT to cost (if you cannot reclaim it)")}</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import DecimalInput, { IntegerInput } from "@/components/ui/NumberInputs";
import { tNow as t } from "@/lib/i18n";

const fieldCls =
  "w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]";

/** Ağırlık/ölçü: yalnızca rakam, boş = girilmemiş; Etsy 0 ya da negatif kabul etmez. */
function PositiveField({ value, onValue }: { value: number | null; onValue: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  const parse = (s: string) => (s === "" ? null : Number(s.replace(",", ".")));
  const shown = text !== null && parse(text) === value ? text : value === null ? "" : String(value);
  const bad = value !== null && !(value > 0);
  return (
    <>
      <DecimalInput
        value={shown}
        onValue={(v) => {
          setText(v);
          const n = parse(v);
          onValue(n === null || Number.isNaN(n) ? null : n);
        }}
        onBlur={() => setText(null)}
        className={fieldCls}
      />
      {bad && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t("0'dan büyük olmalı (ya da boş bırak).", "Must be greater than 0 (or leave it empty).")}</p>}
    </>
  );
}

/** AB garanti süresi: tam sayı, 3-99 yıl. */
function YearsField({ value, onValue }: { value: number | null; onValue: (v: number | null) => void }) {
  const bad = value !== null && (value < 3 || value > 99);
  return (
    <>
      <IntegerInput value={value === null ? "" : String(value)} onValue={(v) => onValue(v === "" ? null : Number(v))} className={`${fieldCls} sm:w-40`} />
      {bad && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t("3 ile 99 yıl arasında olmalı.", "Must be between 3 and 99 years.")}</p>}
    </>
  );
}

const WEIGHT_UNITS = ["oz", "lb", "g", "kg"];
const DIMENSION_UNITS = ["in", "ft", "mm", "cm", "m", "yd", "inches"];

type Patch = {
  item_weight?: number | null;
  item_length?: number | null;
  item_width?: number | null;
  item_height?: number | null;
  item_weight_unit?: string | null;
  item_dimensions_unit?: string | null;
  is_taxable?: boolean;
  ecgt_garan_brand?: string | null;
  ecgt_garan_years?: number | null;
  ecgt_garan_model?: string | null;
  ecgt_garan_guarantee_details?: string | null;
  ecgt_other_commercial_guarantee_details?: string | null;
  ecgt_after_sales_service_info?: string | null;
  ecgt_software_update_details?: string | null;
};

export default function PhysicalDetails({
  itemWeight,
  itemLength,
  itemWidth,
  itemHeight,
  itemWeightUnit,
  itemDimensionsUnit,
  isTaxable,
  ecgtGaranBrand,
  ecgtGaranYears,
  ecgtGaranModel,
  ecgtGaranGuaranteeDetails,
  ecgtOtherCommercialGuaranteeDetails,
  ecgtAfterSalesServiceInfo,
  onChange,
}: {
  itemWeight: number | null;
  itemLength: number | null;
  itemWidth: number | null;
  itemHeight: number | null;
  itemWeightUnit: string | null;
  itemDimensionsUnit: string | null;
  isTaxable: boolean;
  ecgtGaranBrand: string | null;
  ecgtGaranYears: number | null;
  ecgtGaranModel: string | null;
  ecgtGaranGuaranteeDetails: string | null;
  ecgtOtherCommercialGuaranteeDetails: string | null;
  ecgtAfterSalesServiceInfo: string | null;
  onChange: (patch: Patch) => void;
}) {
  const [gpsrOpen, setGpsrOpen] = useState(Boolean(ecgtGaranBrand));

  // AB ticari garantisi: biri doluysa dördü de zorunlu (Etsy); eksikse yayın öncesi uyarı ve burada not.
  const gpsrFilled = [ecgtGaranBrand, ecgtGaranYears, ecgtGaranModel, ecgtGaranGuaranteeDetails].filter((v) => v !== null && v !== "" && v !== undefined).length;
  const gpsrPartial = gpsrFilled > 0 && gpsrFilled < 4;

  return (
    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Fiziksel Detaylar &amp; Vergi
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("Ağırlık", "Weight")}</label>
          <PositiveField value={itemWeight} onValue={(v) => onChange({ item_weight: v })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("Birim", "Unit")}</label>
          <select
            value={itemWeightUnit ?? ""}
            onChange={(e) => onChange({ item_weight_unit: e.target.value || null })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
          >
            <option value="">—</option>
            {WEIGHT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
            {t("Boyut birimi", "Dimension unit")}
          </label>
          <select
            value={itemDimensionsUnit ?? ""}
            onChange={(e) => onChange({ item_dimensions_unit: e.target.value || null })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
          >
            <option value="">—</option>
            {DIMENSION_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("Uzunluk", "Length")}</label>
          <PositiveField value={itemLength} onValue={(v) => onChange({ item_length: v })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("Genişlik", "Width")}</label>
          <PositiveField value={itemWidth} onValue={(v) => onChange({ item_width: v })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("Yükseklik", "Height")}</label>
          <PositiveField value={itemHeight} onValue={(v) => onChange({ item_height: v })} />
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <span>{t("Vergilendirilebilir", "Taxable")}</span>
        <input
          type="checkbox"
          checked={isTaxable}
          onChange={(e) => onChange({ is_taxable: e.target.checked })}
          className="w-4 h-4"
        />
      </label>

      <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setGpsrOpen((v) => !v)}
          className="text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition"
        >
          {gpsrOpen ? "▾" : "▸"} {t("GPSR / AB Ticari Garanti Bilgileri (AB'de satış yapan tacirler için)", "GPSR / EU commercial guarantee info (for traders selling in the EU)")}
        </button>

        {gpsrOpen && (
          <div className="mt-3 space-y-3">
            <p className={`text-xs ${gpsrPartial ? "text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"}`}>
              {gpsrPartial
                ? t("Marka, model, yıl ve garanti ayrıntısı birlikte doldurulmalı; eksik kalırsa yayın durur.", "Brand, model, years and guarantee details must all be filled in; publishing stops while one is missing.")
                : t("Bu dört alandan biri doldurulursa hepsi zorunlu olur (Etsy tarafında).", "If one of these four fields is filled in, all of them become required (on Etsy).")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  {t("Marka", "Brand")}
                </label>
                <input
                  value={ecgtGaranBrand ?? ""}
                  maxLength={25}
                  onChange={(e) => onChange({ ecgt_garan_brand: e.target.value || null })}
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  Model
                </label>
                <input
                  value={ecgtGaranModel ?? ""}
                  maxLength={20}
                  onChange={(e) => onChange({ ecgt_garan_model: e.target.value || null })}
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {t("Garanti süresi (yıl, 3-99)", "Guarantee period (years, 3-99)")}
              </label>
              <YearsField value={ecgtGaranYears} onValue={(v) => onChange({ ecgt_garan_years: v })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {t("Garanti detayları", "Guarantee details")}
              </label>
              <textarea
                value={ecgtGaranGuaranteeDetails ?? ""}
                maxLength={255}
                rows={2}
                onChange={(e) => onChange({ ecgt_garan_guarantee_details: e.target.value || null })}
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {t("Satış sonrası hizmet bilgisi", "After-sales service info")}
              </label>
              <textarea
                value={ecgtAfterSalesServiceInfo ?? ""}
                maxLength={255}
                rows={2}
                onChange={(e) => onChange({ ecgt_after_sales_service_info: e.target.value || null })}
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {t("Ek garanti/başka bilgi", "Other guarantee info")}
              </label>
              <textarea
                value={ecgtOtherCommercialGuaranteeDetails ?? ""}
                maxLength={255}
                rows={2}
                onChange={(e) => onChange({ ecgt_other_commercial_guarantee_details: e.target.value || null })}
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

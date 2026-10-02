"use client";

import { useState } from "react";
import { tNow as t } from "@/lib/i18n";

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

  function numberOrNull(value: string): number | null {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return (
    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Fiziksel Detaylar &amp; Vergi
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("Ağırlık", "Weight")}</label>
          <input
            value={itemWeight ?? ""}
            onChange={(e) => onChange({ item_weight: numberOrNull(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
          />
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
          <input
            value={itemLength ?? ""}
            onChange={(e) => onChange({ item_length: numberOrNull(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("Genişlik", "Width")}</label>
          <input
            value={itemWidth ?? ""}
            onChange={(e) => onChange({ item_width: numberOrNull(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("Yükseklik", "Height")}</label>
          <input
            value={itemHeight ?? ""}
            onChange={(e) => onChange({ item_height: numberOrNull(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
          />
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
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              {t("Bu dört alandan biri doldurulursa hepsi zorunlu olur (Etsy tarafında).", "If one of these four fields is filled in, all of them become required (on Etsy).")}
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
              <input
                value={ecgtGaranYears ?? ""}
                onChange={(e) => onChange({ ecgt_garan_years: numberOrNull(e.target.value) })}
                className="w-full sm:w-40 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
              />
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

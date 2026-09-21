"use client";

import { useState } from "react";

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
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Ağırlık</label>
          <input
            value={itemWeight ?? ""}
            onChange={(e) => onChange({ item_weight: numberOrNull(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Birim</label>
          <select
            value={itemWeightUnit ?? ""}
            onChange={(e) => onChange({ item_weight_unit: e.target.value || null })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
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
            Boyut birimi
          </label>
          <select
            value={itemDimensionsUnit ?? ""}
            onChange={(e) => onChange({ item_dimensions_unit: e.target.value || null })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
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
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Uzunluk</label>
          <input
            value={itemLength ?? ""}
            onChange={(e) => onChange({ item_length: numberOrNull(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Genişlik</label>
          <input
            value={itemWidth ?? ""}
            onChange={(e) => onChange({ item_width: numberOrNull(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Yükseklik</label>
          <input
            value={itemHeight ?? ""}
            onChange={(e) => onChange({ item_height: numberOrNull(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
          />
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <span>Vergilendirilebilir</span>
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
          {gpsrOpen ? "▾" : "▸"} GPSR / AB Ticari Garanti Bilgileri (AB&apos;de satış yapan tacirler için)
        </button>

        {gpsrOpen && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Bu dört alandan biri doldurulursa hepsi zorunlu olur (Etsy tarafında).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  Marka
                </label>
                <input
                  value={ecgtGaranBrand ?? ""}
                  maxLength={25}
                  onChange={(e) => onChange({ ecgt_garan_brand: e.target.value || null })}
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
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
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                Garanti süresi (yıl, 3-99)
              </label>
              <input
                value={ecgtGaranYears ?? ""}
                onChange={(e) => onChange({ ecgt_garan_years: numberOrNull(e.target.value) })}
                className="w-full sm:w-40 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                Garanti detayları
              </label>
              <textarea
                value={ecgtGaranGuaranteeDetails ?? ""}
                maxLength={255}
                rows={2}
                onChange={(e) => onChange({ ecgt_garan_guarantee_details: e.target.value || null })}
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                Satış sonrası hizmet bilgisi
              </label>
              <textarea
                value={ecgtAfterSalesServiceInfo ?? ""}
                maxLength={255}
                rows={2}
                onChange={(e) => onChange({ ecgt_after_sales_service_info: e.target.value || null })}
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                Ek garanti/başka bilgi
              </label>
              <textarea
                value={ecgtOtherCommercialGuaranteeDetails ?? ""}
                maxLength={255}
                rows={2}
                onChange={(e) => onChange({ ecgt_other_commercial_guarantee_details: e.target.value || null })}
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

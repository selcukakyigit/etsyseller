"use client";

import { useT } from "@/lib/i18n-client";
import { MATERIAL_TYPES } from "../core/materials";
import { input } from "../core/ui";

/** Ürünün malzeme türü: ürün levha malzemeden yapılır (metal, ahşap, akrilik), ambalaj ve sarf türleri listelenmez. Ürün tanımı
 * tedarikçiden bağımsızdır: tedarikçi, türü + kalınlığı kendi fiyat listesindeki kalemle eşler. */
export default function MaterialTypeSelect({ value, onChange, disabled, className = "" }: { value: string; onChange: (key: string) => void; disabled?: boolean; className?: string }) {
  const { t } = useT();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${input} ${className}`} aria-label={t("Malzeme türü", "Material type")}>
      <option value="">—</option>
      {MATERIAL_TYPES.filter((m) => m[3]).map(([key, tr, en]) => (
        <option key={key} value={key}>
          {t(tr, en)}
        </option>
      ))}
    </select>
  );
}

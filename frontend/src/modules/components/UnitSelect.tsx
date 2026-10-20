"use client";

import { useT } from "@/lib/i18n-client";
import { UNIT_GROUPS, unitLabel } from "../core/units";
import { input } from "../core/ui";

/** Birim seçici: süre / sayı / ağırlık / uzunluk / alan / hacim gruplarıyla. `only` verilirse yalnızca o gruplar, `allowed` verilirse yalnızca o birimler
 * (malzeme türünün grubuna göre, bkz. backend `materials.units_for`). */
export default function UnitSelect({
  value,
  onChange,
  only,
  allowed,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  only?: string[];
  allowed?: string[];
  className?: string;
  ariaLabel?: string;
}) {
  const { t } = useT();
  const groups = (only ? UNIT_GROUPS.filter((g) => only.includes(g.key)) : UNIT_GROUPS)
    .map((g) => ({ ...g, units: allowed ? g.units.filter((u) => allowed.includes(u)) : g.units }))
    .filter((g) => g.units.length > 0);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${input} ${className}`} aria-label={ariaLabel ?? t("Birim", "Unit")}>
      {groups.map((g) => (
        <optgroup key={g.key} label={t(g.tr, g.en)}>
          {g.units.map((u) => (
            <option key={u} value={u}>
              {unitLabel(u, t)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

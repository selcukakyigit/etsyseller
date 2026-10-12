"use client";

import { useT } from "@/lib/i18n-client";
import { UNIT_GROUPS, unitLabel } from "../core/units";
import { input } from "../core/ui";

/** Birim seçici: süre / sayı / ağırlık / uzunluk / alan / hacim gruplarıyla. `only` verilirse yalnızca o gruplar. */
export default function UnitSelect({
  value,
  onChange,
  only,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  only?: string[];
  className?: string;
  ariaLabel?: string;
}) {
  const { t } = useT();
  const groups = only ? UNIT_GROUPS.filter((g) => only.includes(g.key)) : UNIT_GROUPS;
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

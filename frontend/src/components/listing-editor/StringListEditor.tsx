"use client";

import { useState } from "react";
import { cleanWord, useEtsyRules } from "@/lib/etsyRules";
import { tNow as t } from "@/lib/i18n";

/** Materyal ya da stil listesi: Etsy'nin kabul etmediği karakterler (tire, noktalama…) girişte çıkar; sınırlar backend kurallarından gelir. */
export default function StringListEditor({
  label,
  kind,
  values,
  onChange,
}: {
  label: string;
  kind: "material" | "style";
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const rules = useEtsyRules();
  const maxItems = rules?.[kind].max_count;
  const maxLen = rules && kind === "style" ? rules.style.max_len : undefined;
  const atLimit = maxItems !== undefined && values.length >= maxItems;

  function add() {
    const raw = draft.trim();
    const clean = rules ? cleanWord(raw, rules, kind) : raw;
    if (!clean || atLimit) return;
    if (maxLen && clean.length > maxLen) {
      setNote(t(`«${clean}» ${maxLen} karakteri aşıyor; kısalt.`, `«${clean}» is longer than ${maxLen} characters; shorten it.`));
      return;
    }
    if (values.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      setDraft("");
      return;
    }
    setNote(clean !== raw ? t(`Etsy yalnızca harf, rakam ve boşluk kabul eder; «${clean}» olarak eklendi.`, `Etsy accepts only letters, numbers and spaces; added as «${clean}».`) : null);
    onChange([...values, clean]);
    setDraft("");
  }

  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500 mb-1.5">
        {label}
        {maxItems !== undefined && ` (${values.length}/${maxItems})`}
      </label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-neutral-100 text-neutral-600"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              className="text-neutral-400 hover:text-neutral-700"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {!atLimit && (
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-[#D97757]"
            placeholder={t("Ekle ve Enter'a bas…", "Type and press Enter…")}
          />
          <button
            type="button"
            onClick={add}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-100 transition"
          >
            {t("Ekle", "Add")}
          </button>
        </div>
      )}
      {note && <p className="mt-1 text-xs text-amber-700">{note}</p>}
    </div>
  );
}

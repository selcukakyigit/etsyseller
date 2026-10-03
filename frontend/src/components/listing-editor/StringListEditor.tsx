"use client";

import { useState } from "react";
import { tNow as t } from "@/lib/i18n";

export default function StringListEditor({
  label,
  values,
  maxItems,
  onChange,
}: {
  label: string;
  values: string[];
  maxItems?: number;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const atLimit = maxItems !== undefined && values.length >= maxItems;

  function add() {
    const trimmed = draft.trim();
    if (!trimmed || atLimit) return;
    onChange([...values, trimmed]);
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
    </div>
  );
}

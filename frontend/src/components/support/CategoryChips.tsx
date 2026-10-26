"use client";

import { CATEGORIES, categoryLabel } from "@/components/support/meta";
import { useT } from "@/lib/i18n-client";
import type { TicketCategory } from "@/lib/supportApi";

/** Talep türü seçici: açılır liste yerine tek dokunuşluk çipler (yeni talep penceresinde yükseklik sabit kalır). */
export default function CategoryChips({ value, onChange }: { value: TicketCategory; onChange: (c: TicketCategory) => void }) {
  const { t } = useT();
  return (
    <div role="radiogroup" aria-label={t("Tür", "Type")} className="flex flex-wrap gap-1.5">
      {(Object.keys(CATEGORIES) as TicketCategory[]).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            value === c
              ? "border-[#D97757] bg-[#D97757]/10 text-[#B4553A] dark:text-[#E89A7F]"
              : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          {categoryLabel(t, c)}
        </button>
      ))}
    </div>
  );
}

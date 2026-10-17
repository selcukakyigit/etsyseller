"use client";

import { tNow as t } from "@/lib/i18n";

/** Ürün türü: fiziksel ya da dijital (Etsy'deki "What type of item is it?"). Yalnızca yeni (henüz Etsy'ye gitmemiş) listing'de değiştirilebilir. */
export default function ProductType({ value, editable, onChange }: { value: string | null | undefined; editable: boolean; onChange: (type: "physical" | "download") => void }) {
  const digital = value === "download";
  const options: [string, string, string][] = [
    ["physical", "Fiziksel", "Physical"],
    ["download", "Dijital", "Digital"],
  ];
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Ürün türü", "Item type")}</p>
      <div className="flex gap-2">
        {options.map(([key, tr, en]) => {
          const active = (key === "download") === digital;
          return (
            <button
              key={key}
              type="button"
              disabled={!editable && !active}
              onClick={() => editable && onChange(key as "physical" | "download")}
              aria-pressed={active}
              className={`rounded-lg border px-4 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? "border-[#D97757] bg-[#D97757]/10 text-[#B4553A] dark:text-[#E89A7F]"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {t(tr, en)}
            </button>
          );
        })}
      </div>
      {!editable && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{t("Yayınlanmış listing'in türü değiştirilemez.", "The type of a published listing cannot be changed.")}</p>}
    </div>
  );
}

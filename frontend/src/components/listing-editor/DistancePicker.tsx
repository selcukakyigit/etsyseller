"use client";

/** Çekim mesafesi/kadraj seçici — kamera açısı küpüyle aynı mantık: sabit, test edilmiş fotoğrafçılık
 * cümleleri arasından seçim, serbest metinle karışmaz (bkz. CameraCube.tsx, ai/image_gen.py _build_prompt). */

import { tNow as t } from "@/lib/i18n";

const DISTANCE_STEPS = [
  { key: "close", label: ["Yakın çekim", "Close-up"], hint: ["Ürün detayına odaklı", "Focused on product detail"] },
  { key: "medium", label: ["Orta plan", "Medium shot"], hint: ["Ürün + biraz sahne", "Product + some scene"] },
  { key: "wide", label: ["Geniş plan", "Wide shot"], hint: ["Tüm sahne", "The whole scene"] },
] as const;

export type Distance = (typeof DISTANCE_STEPS)[number]["key"];

// Kadraj kamera mesafesiyle tanımlanır ve ölçülebilirdir (ürün kadrajın yüzde kaçını kaplar): "yakın/uzak" göreli kalırsa model, orijinal
// zaten yakın ya da uzaksa ne yapacağını bilemez.
const DISTANCE_PHRASE: Record<Distance, string> = {
  close: "Yakın çekim: kamera ürüne yaklaşsın; ürün kadrajın yaklaşık %80–90'ını kaplasın, dokusu ve detayları net görünsün, arka plan hafifçe bulanık olsun (sığ alan derinliği).",
  medium: "Orta plan: kamera ürüne orta mesafede olsun; ürün kadrajın yaklaşık %40–50'sini kaplasın, çevresindeki sahne de belirgin biçimde görünsün.",
  wide: "Geniş plan: kamera geri çekilsin; ürün kadrajın yaklaşık %15–25'ini kaplasın, çevresindeki ortam/mekân ağırlıkta görünsün.",
};

export function distancePrompt(d: Distance): string {
  return DISTANCE_PHRASE[d];
}

export default function DistancePicker({
  value,
  onChange,
  vertical = false,
}: {
  value: Distance | null;
  onChange: (d: Distance | null) => void;
  /** true: butonlar alt alta, dar bir sütun (küple yan yana yerleşim için) — false: yatay, tam genişlik. */
  vertical?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">🖼️ {t("Kadraj", "Framing")}</p>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            {t("Temizle", "Clear")}
          </button>
        )}
      </div>
      <div className={`mt-2 flex gap-2 ${vertical ? "flex-col" : "flex-wrap"}`}>
        {DISTANCE_STEPS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(value === s.key ? null : s.key)}
            title={t(s.hint[0], s.hint[1])}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${vertical ? "w-full" : ""} ${
              value === s.key
                ? "bg-[#D97757] text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            }`}
          >
            {t(s.label[0], s.label[1])}
          </button>
        ))}
      </div>
    </div>
  );
}

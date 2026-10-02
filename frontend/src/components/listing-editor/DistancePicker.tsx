"use client";

/** Çekim mesafesi/kadraj seçici — kamera açısı küpüyle aynı mantık: sabit, test edilmiş fotoğrafçılık
 * cümleleri arasından seçim, serbest metinle karışmaz (bkz. CameraCube.tsx, ai/image_gen.py _build_prompt). */

const DISTANCE_STEPS = [
  { key: "close", label: "Yakın çekim", hint: "Ürün detayına odaklı" },
  { key: "medium", label: "Orta plan", hint: "Ürün + biraz sahne" },
  { key: "wide", label: "Geniş plan", hint: "Tüm sahne" },
] as const;

export type Distance = (typeof DISTANCE_STEPS)[number]["key"];

const DISTANCE_PHRASE: Record<Distance, string> = {
  close: "Yakın çekim (close-up) kadrajla, ürünü ve dokusunu/detayını doldurarak çek; arka plan hafifçe bulanıklaşsın (sığ alan derinliği), odak tamamen üründe olsun.",
  medium: "Orta plan kadrajla çek: ürün net ve öne çıkmış olsun, etrafındaki sahne de bir miktar görünsün, dengeli bir odak-bağlam dengesi kur.",
  wide: "Geniş plan/kadrajla çek: ürünü bulunduğu ortamla/mekânla birlikte, biraz uzaktan göster; sahnenin tamamı kadrajda olsun.",
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
        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">🖼️ Kadraj</p>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            Temizle
          </button>
        )}
      </div>
      <div className={`mt-2 flex gap-2 ${vertical ? "flex-col" : "flex-wrap"}`}>
        {DISTANCE_STEPS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(value === s.key ? null : s.key)}
            title={s.hint}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${vertical ? "w-full" : ""} ${
              value === s.key
                ? "bg-[#D97757] text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

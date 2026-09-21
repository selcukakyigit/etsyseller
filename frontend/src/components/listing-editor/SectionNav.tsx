"use client";

export const EDIT_SECTIONS: [string, string][] = [
  ["sec-media", "Fotoğraf & Video"],
  ["sec-details", "Ürün Detayları"],
  ["sec-options", "Varyasyon & Fiyat"],
  ["sec-attributes", "Etiket & Özellikler"],
  ["sec-shipping", "Kargo & İade"],
  ["sec-made", "Nasıl Yapıldı"],
  ["sec-settings", "Ayarlar"],
];

/** Uzun düzenleme formunda bölümler arası hızlı geçiş (Etsy editöründeki üst sekmelerin karşılığı). */
export default function SectionNav({
  onNavigate,
  allOpen,
  onToggleAll,
}: {
  /** Kapalı bir bölüme gidilirse önce açılması için üst bileşene haber verir. */
  onNavigate: (id: string) => void;
  allOpen: boolean;
  onToggleAll: () => void;
}) {
  return (
    <nav
      aria-label="Bölümler"
      className="sticky top-0 z-30 -mx-2 flex flex-wrap items-center gap-1.5 rounded-xl bg-neutral-50/90 px-2 py-2 backdrop-blur dark:bg-neutral-950/90"
    >
      {EDIT_SECTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onNavigate(id)}
          className="shrink-0 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        onClick={onToggleAll}
        className="ml-auto shrink-0 px-2 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        {allOpen ? "Tümünü daralt" : "Tümünü aç"}
      </button>
    </nav>
  );
}

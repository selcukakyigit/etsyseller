"use client";

import { tNow as t } from "@/lib/i18n";

export const EDIT_SECTIONS: [string, string, string][] = [
  ["sec-media", "Fotoğraf & Video", "Photos & Video"],
  ["sec-details", "Ürün Detayları", "Item details"],
  ["sec-options", "Varyasyon & Fiyat", "Variations & Price"],
  ["sec-attributes", "Etiket & Özellikler", "Tags & Attributes"],
  ["sec-shipping", "Kargo & İade", "Shipping & Returns"],
  ["sec-made", "Nasıl Yapıldı", "How it's made"],
  ["sec-settings", "Ayarlar", "Settings"],
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
      aria-label={t("Bölümler", "Sections")}
      // top-[49px]: AppShell'in Topbar'ı (bkz. Topbar.tsx) kendisi de sticky top-0 ve 49px yükseklikte —
      // bu da top-0 olsaydı ikisi aynı noktaya yapışıp üst üste binerdi (Topbar görünmez olurdu).
      // Telefonda tek satır ve yatay kayar: kırılınca 3 satır olup ekranın üstünü kaplıyordu.
      className="sticky top-[49px] z-20 -mx-3 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap bg-neutral-50/90 px-3 py-2 backdrop-blur [scrollbar-width:none] dark:bg-neutral-950/90 sm:-mx-2 sm:flex-wrap sm:rounded-xl sm:px-2"
    >
      {EDIT_SECTIONS.map(([id, tr, en]) => (
        <button
          key={id}
          type="button"
          onClick={() => onNavigate(id)}
          className="shrink-0 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
        >
          {t(tr, en)}
        </button>
      ))}
      <button
        type="button"
        onClick={onToggleAll}
        className="ml-auto shrink-0 px-2 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        {allOpen ? t("Tümünü daralt", "Collapse all") : t("Tümünü aç", "Expand all")}
      </button>
    </nav>
  );
}

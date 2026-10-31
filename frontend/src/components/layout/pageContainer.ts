/** Sayfa kapsayıcısının tek tanımı: genişlik ve dikey boşluk sayfa başına elle yazılmaz, buradan seçilir; yatay boşluk
 * herkeste aynıdır (`px-4 sm:px-6`). Yapışkan çubuklu sayfalar (`-mx-4 sm:-mx-6` ile kenara taşan) bu yatay boşluğa
 * güvenir; değiştirirsen onları da güncelle.
 *
 * Genişlik:  narrow 3xl (ayar alt sayfaları, şablonlar) · reading 4xl (yorumlar, ayarlar) · form 5xl (kargo, banner, krediler) ·
 *            page 7xl (analiz, finans, siparişler, modüller) · wide 88rem (listing tablosu) · dashboard 96rem.
 * Boşluk:    normal (çoğu sayfa) · flush (üstü boş: yapışkan filtre çubuğu kendi üst boşluğunu taşır) ·
 *            flushTall (flush + alttaki seçim çubuğuna yer) · compact (ana sayfa: sohbet yüksekliği buna göre hesaplanır). */
const WIDTH = {
  narrow: "max-w-3xl",
  reading: "max-w-4xl",
  form: "max-w-5xl",
  page: "max-w-7xl",
  wide: "max-w-[88rem]",
  dashboard: "max-w-[96rem]",
} as const;

const SPACING = {
  normal: "py-6 sm:py-8",
  flush: "pt-0 pb-8",
  flushTall: "pt-0 pb-28",
  compact: "py-2 sm:py-6",
} as const;

export type PageWidth = keyof typeof WIDTH;
export type PageSpacing = keyof typeof SPACING;

/** `extra`: sayfaya özgü ek sınıflar (ör. `space-y-6`). */
export function pageContainer(width: PageWidth, spacing: PageSpacing = "normal", extra = ""): string {
  return `mx-auto w-full ${WIDTH[width]} px-4 sm:px-6 ${SPACING[spacing]}${extra ? ` ${extra}` : ""}`;
}

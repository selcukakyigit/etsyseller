// Mobil alt sekme çubuğunun (BottomNav, lg altı) yüksekliği 3.5rem + telefonun alt güvenli alanı.

/** Sayfa içeriği alt çubuğun arkasında kalmasın diye içeriğin altına eklenen boşluk (AppShell <main>). */
export const BOTTOM_NAV_SPACE = "pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0";

/** Ekranın altına yapışan öğeler (kaydet çubuğu, bildirimler) mobilde alt çubuğun 1rem üstünde durur. */
export const ABOVE_BOTTOM_NAV = "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4";

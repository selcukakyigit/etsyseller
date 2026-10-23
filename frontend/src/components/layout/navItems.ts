import { ComponentType } from "react";
import { BoxIcon, ChartIcon, ChatIcon, PulseIcon, SearchIcon, TagIcon } from "@/components/icons";

/** Uygulama içi gezinmenin tek kaynağı: masaüstü kenar çubuğu, mobil çekmece ve alt sekme çubuğu buradan okur.
 * `needsShop`: bağlı Etsy mağazası olmadan anlamsız sayfa; mağaza yokken menüde gösterilmez (bkz. `forShops`). */
export type NavItem = { href: string; tr: string; en: string; icon?: ComponentType<{ className?: string }>; needsShop?: boolean };

export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", tr: "Asistan", en: "Assistant", icon: ChatIcon },
  { href: "/analysis", tr: "Analiz", en: "Analysis", icon: PulseIcon, needsShop: true },
  { href: "/listings", tr: "Listing'ler", en: "Listings", icon: TagIcon, needsShop: true },
  { href: "/discover", tr: "Keşfet", en: "Discover", icon: SearchIcon, needsShop: true },
  { href: "/orders", tr: "Siparişler", en: "Orders", icon: BoxIcon, needsShop: true },
  { href: "/finance", tr: "Finans", en: "Finance", icon: ChartIcon, needsShop: true },
];

// "Mağaza" açılır menüsü: mağazanın kendisine ait, ara sıra açılan sayfalar.
export const SHOP_NAV: NavItem[] = [
  { href: "/reviews", tr: "Yorumlar", en: "Reviews", needsShop: true },
  { href: "/shipping", tr: "Kargo ayarları", en: "Shipping settings", needsShop: true },
  { href: "/templates", tr: "Açıklama şablonları", en: "Description templates", needsShop: true },
  { href: "/banners", tr: "Banner oluşturucu", en: "Banner maker", needsShop: true },
];

/** Mağaza yokken mağaza gerektiren öğeleri ayıklar. */
export const forShops = (items: NavItem[], hasShop: boolean): NavItem[] => (hasShop ? items : items.filter((i) => !i.needsShop));

// Dış Tedarik: kenar çubuğunda sabit bölüm; altında kullanıcının tedarikçileri listelenir (bkz. SidebarNav).
export const SUPPLY_NAV: NavItem = { href: "/supply", tr: "Dış Tedarik", en: "External suppliers" };

export const SUPPORT_NAV: NavItem = { href: "/support", tr: "Yardım & Destek", en: "Help & Support" };

export const SETTINGS_NAV: NavItem = { href: "/settings", tr: "Ayarlar", en: "Settings" };

// Yalnızca yöneticilere görünür (User.is_admin); sunucu da yönetici olmayana 404 döner.
export const ADMIN_NAV: NavItem = { href: "/admin", tr: "Yönetim", en: "Admin" };

/** Alt sekme çubuğunda (mobil) doğrudan görünen sayfalar (en fazla 4 + "Menü"); Analiz ve geri kalanı çekmecede. */
export const BOTTOM_TABS: NavItem[] = MAIN_NAV.filter((i) => i.href !== "/analysis" && i.href !== "/discover");

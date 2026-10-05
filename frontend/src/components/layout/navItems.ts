import { ComponentType } from "react";
import { BoxIcon, ChartIcon, HomeIcon, PulseIcon, TagIcon } from "@/components/icons";

/** Uygulama içi gezinmenin tek kaynağı: masaüstü kenar çubuğu, mobil çekmece ve alt sekme çubuğu buradan okur. */
export type NavItem = { href: string; tr: string; en: string; icon?: ComponentType<{ className?: string }> };

export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", tr: "Ana sayfa", en: "Home", icon: HomeIcon },
  { href: "/analysis", tr: "Analiz", en: "Analysis", icon: PulseIcon },
  { href: "/listings", tr: "Listing'ler", en: "Listings", icon: TagIcon },
  { href: "/orders", tr: "Siparişler", en: "Orders", icon: BoxIcon },
  { href: "/finance", tr: "Finans", en: "Finance", icon: ChartIcon },
];

// "Mağaza" açılır menüsü: mağazanın kendisine ait, ara sıra açılan sayfalar.
export const SHOP_NAV: NavItem[] = [
  { href: "/reviews", tr: "Yorumlar", en: "Reviews" },
  { href: "/shipping", tr: "Kargo ayarları", en: "Shipping settings" },
  { href: "/templates", tr: "Açıklama şablonları", en: "Description templates" },
  { href: "/banners", tr: "Banner oluşturucu", en: "Banner maker" },
];

export const SETTINGS_NAV: NavItem = { href: "/settings", tr: "Ayarlar", en: "Settings" };

// Yalnızca yöneticilere görünür (User.is_admin); sunucu da yönetici olmayana 404 döner.
export const ADMIN_NAV: NavItem = { href: "/admin", tr: "Yönetim", en: "Admin" };

/** Alt sekme çubuğunda (mobil) doğrudan görünen sayfalar (en fazla 4 + "Menü"); Analiz ve geri kalanı çekmecede. */
export const BOTTOM_TABS: NavItem[] = MAIN_NAV.filter((i) => i.href !== "/analysis");

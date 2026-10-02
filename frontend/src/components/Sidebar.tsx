"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Shop, User } from "@/lib/api";
import Avatar from "@/components/Avatar";
import Logo from "@/components/Logo";
import { useT } from "@/lib/i18n-client";
import { useStoredState } from "@/lib/useStoredState";

type NavItem = { href: string; tr: string; en: string };

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", tr: "Dashboard", en: "Dashboard" },
  { href: "/listings", tr: "Listing'ler", en: "Listings" },
  { href: "/orders", tr: "Siparişler", en: "Orders" },
  { href: "/finance", tr: "Finans", en: "Finance" },
];

// "Mağaza" açılır menüsü: mağazanın kendisine ait, ara sıra açılan sayfalar.
const SHOP_ITEMS: NavItem[] = [
  { href: "/reviews", tr: "Yorumlar", en: "Reviews" },
  { href: "/shipping", tr: "Kargo ayarları", en: "Shipping settings" },
  { href: "/templates", tr: "Açıklama şablonları", en: "Description templates" },
];

const SETTINGS_ITEM: NavItem = { href: "/settings", tr: "Ayarlar", en: "Settings" };

function linkClass(active: boolean, indent = false) {
  return `block text-sm font-medium ${indent ? "pl-6 pr-3" : "px-3"} py-2 rounded-lg transition ${
    active
      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
      : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
  }`;
}

export default function Sidebar({
  user,
  shops,
  activeShop,
  onSwitchShop,
  current,
}: {
  user: User | null;
  shops?: Shop[] | null;
  activeShop: Shop | null;
  onSwitchShop?: (id: number) => void;
  current: string;
}) {
  const router = useRouter();
  const { t } = useT();
  const connectedShops = (shops ?? []).filter((s) => s.connected);
  // Menüdeki bir sayfadayken menü hep açık (bulunulan sayfa görünsün); diğer sayfalarda son açık/kapalı hâli hatırlanır.
  const [shopMenu, setShopMenu] = useStoredState<"open" | "closed">("sidebar.shopMenu", "closed", ["open", "closed"]);
  const inShopMenu = SHOP_ITEMS.some((i) => i.href === current);
  const shopOpen = inShopMenu || shopMenu === "open";

  async function handleLogout() {
    await api.auth.logout();
    router.push("/login");
  }

  return (
    <aside className="w-56 flex-shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
        <Link href="/" aria-label={t("Ana sayfa", "Home page")} className="inline-block">
          <Logo height={22} />
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={linkClass(current === item.href)}>
            {t(item.tr, item.en)}
          </Link>
        ))}

        <button
          type="button"
          aria-expanded={shopOpen}
          onClick={() => setShopMenu(shopOpen && !inShopMenu ? "closed" : "open")}
          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
            inShopMenu ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-300"
          }`}
        >
          {t("Mağaza", "Shop")}
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`h-4 w-4 text-neutral-400 transition-transform dark:text-neutral-500 ${shopOpen ? "rotate-180" : ""}`}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>
        {shopOpen && (
          <div className="space-y-1">
            {SHOP_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className={linkClass(current === item.href, true)}>
                {t(item.tr, item.en)}
              </Link>
            ))}
          </div>
        )}

        <Link href={SETTINGS_ITEM.href} className={linkClass(current === SETTINGS_ITEM.href)}>
          {t(SETTINGS_ITEM.tr, SETTINGS_ITEM.en)}
        </Link>
      </nav>

      <div className="px-3 py-4 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
        {connectedShops.length > 1 ? (
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              {activeShop?.icon_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeShop.icon_url} alt="" className="h-4 w-4 rounded-full object-cover" />
              )}
              {t("Aktif Mağaza", "Active shop")}
            </label>
            <select
              value={activeShop?.id ?? ""}
              onChange={(e) => onSwitchShop?.(Number(e.target.value))}
              className="w-full text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg px-2 py-1.5 outline-none"
            >
              {connectedShops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.shop_name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          activeShop && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400 px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-950">
              {activeShop.icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeShop.icon_url} alt="" className="h-4 w-4 rounded-full object-cover flex-shrink-0" />
              ) : null}
              {t(`${activeShop.shop_name} bağlı`, `${activeShop.shop_name} connected`)}
            </span>
          )
        )}

        <div className="flex items-center gap-2 px-1 min-w-0">
          <Avatar user={user} size={28} className="border border-neutral-100 dark:border-neutral-800" />
          <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
            {user ? user.name || user.email : " "}
          </span>
        </div>

        <button
          onClick={handleLogout}
          disabled={!user}
          className="w-full text-sm font-medium px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition disabled:opacity-50"
        >
          {t("Çıkış yap", "Log out")}
        </button>
      </div>
    </aside>
  );
}

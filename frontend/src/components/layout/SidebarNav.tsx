"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Shop, User } from "@/lib/api";
import Avatar from "@/components/Avatar";
import { useT } from "@/lib/i18n-client";
import { useStoredState } from "@/lib/useStoredState";
import { MAIN_NAV, SETTINGS_NAV, SHOP_NAV } from "./navItems";

export type ShellProps = {
  user: User | null;
  shops?: Shop[] | null;
  activeShop: Shop | null;
  onSwitchShop?: (id: number) => void;
  current: string;
};

function linkClass(active: boolean, indent = false) {
  return `block rounded-lg py-2 text-sm font-medium transition ${indent ? "pl-6 pr-3" : "px-3"} ${
    active
      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
  }`;
}

/** Menü içeriği (bağlantılar + mağaza seçici + kullanıcı). Masaüstü kenar çubuğu ve mobil çekmece aynısını kullanır.
 * `onNavigate`: bir bağlantıya tıklanınca çağrılır (çekmeceyi kapatmak için). */
export default function SidebarNav({ user, shops, activeShop, onSwitchShop, current, onNavigate }: ShellProps & { onNavigate?: () => void }) {
  const router = useRouter();
  const { t } = useT();
  const connectedShops = (shops ?? []).filter((s) => s.connected);
  // Başlığa tıklamak her zaman açar/kapatır ve seçim hatırlanır. Hiç seçim yapılmadıysa ("auto") menüdeki bir
  // sayfadayken açık gelir ki bulunulan sayfa görünsün.
  const [shopMenu, setShopMenu] = useStoredState<"auto" | "open" | "closed">("sidebar.shopMenu", "auto", ["auto", "open", "closed"]);
  const inShopMenu = SHOP_NAV.some((i) => i.href === current);
  const shopOpen = shopMenu === "open" || (shopMenu === "auto" && inShopMenu);

  async function handleLogout() {
    await api.auth.logout();
    router.push("/login");
  }

  return (
    <>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {MAIN_NAV.map((item) => (
          <Link key={item.href} href={item.href} onClick={onNavigate} className={linkClass(current === item.href)}>
            {t(item.tr, item.en)}
          </Link>
        ))}

        <button
          type="button"
          aria-expanded={shopOpen}
          onClick={() => setShopMenu(shopOpen ? "closed" : "open")}
          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
            inShopMenu ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-300"
          }`}
        >
          {t("Mağaza", "Shop")}
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`h-5 w-5 text-[#D97757] transition-transform ${shopOpen ? "rotate-180" : ""}`}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>
        {shopOpen && (
          <div className="space-y-1">
            {SHOP_NAV.map((item) => (
              <Link key={item.href} href={item.href} onClick={onNavigate} className={linkClass(current === item.href, true)}>
                {t(item.tr, item.en)}
              </Link>
            ))}
          </div>
        )}

        <Link href={SETTINGS_NAV.href} onClick={onNavigate} className={linkClass(current === SETTINGS_NAV.href)}>
          {t(SETTINGS_NAV.tr, SETTINGS_NAV.en)}
        </Link>
      </nav>

      <div className="space-y-3 border-t border-neutral-100 px-3 py-4 dark:border-neutral-800">
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
              className="w-full rounded-lg border border-green-200 bg-green-50 px-2 py-1.5 text-xs font-medium text-green-700 outline-none dark:border-green-900 dark:bg-green-950 dark:text-green-400"
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
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-600 dark:bg-green-950 dark:text-green-400">
              {activeShop.icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeShop.icon_url} alt="" className="h-4 w-4 flex-shrink-0 rounded-full object-cover" />
              ) : null}
              <span className="truncate">{t(`${activeShop.shop_name} bağlı`, `${activeShop.shop_name} connected`)}</span>
            </span>
          )
        )}

        <div className="flex min-w-0 items-center gap-2 px-1">
          <Avatar user={user} size={28} className="border border-neutral-100 dark:border-neutral-800" />
          <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">{user ? user.name || user.email : " "}</span>
        </div>

        <button
          onClick={handleLogout}
          disabled={!user}
          className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t("Çıkış yap", "Log out")}
        </button>
      </div>
    </>
  );
}

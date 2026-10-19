"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Shop, User } from "@/lib/api";
import Avatar from "@/components/Avatar";
import { useT } from "@/lib/i18n-client";
import { useHydrated } from "@/lib/useHydrated";
import { useStoredState } from "@/lib/useStoredState";
import { ADMIN_NAV, MAIN_NAV, SETTINGS_NAV, SHOP_NAV, SUPPLY_NAV, SUPPORT_NAV, forShops } from "./navItems";
import { useSupportUnread } from "@/lib/useSupportUnread";
import { supplyStore } from "@/modules/supply/store";
import { supplyApi } from "@/modules/supply/api";
import EntityAvatar from "@/modules/components/EntityAvatar";

export type ShellProps = {
  user: User | null;
  /** Bağlı mağaza var mı (bkz. lib/useShopState): yoksa mağazaya ait menü öğeleri gizlenir. */
  hasShop: boolean;
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
export default function SidebarNav({ user, hasShop, shops, activeShop, onSwitchShop, current, onNavigate }: ShellProps & { onNavigate?: () => void }) {
  const router = useRouter();
  const { t } = useT();
  // Menünün hangi öğeleri göstereceği tarayıcıda hatırlanan duruma bağlı; sunucu HTML'i bunu bilmez. Hidrasyona kadar
  // menü yer tutar ama görünmez, böylece tam menü çizilip küçülmez.
  const hydrated = useHydrated();
  const supportUnread = useSupportUnread(!!user);
  const connectedShops = (shops ?? []).filter((s) => s.connected);
  // Mağaza bağlı değilken mağazaya ait sayfalar (Analiz, Finans, Mağaza menüsü…) gösterilmez; bağlanınca belirir.
  const mainNav = forShops(MAIN_NAV, hasShop);
  const shopNav = forShops(SHOP_NAV, hasShop);
  // Başlığa tıklamak her zaman açar/kapatır ve seçim hatırlanır. Hiç seçim yapılmadıysa ("auto") menüdeki bir
  // sayfadayken açık gelir ki bulunulan sayfa görünsün.
  const [shopMenu, setShopMenu] = useStoredState<"auto" | "open" | "closed">("sidebar.shopMenu", "auto", ["auto", "open", "closed"]);
  const inShopMenu = SHOP_NAV.some((i) => i.href === current);
  const shopOpen = shopMenu === "open" || (shopMenu === "auto" && inShopMenu);

  async function handleLogout() {
    await api.auth.logout();
    supplyStore.clear();
    router.push("/login");
  }

  return (
    <>
      <nav className={`flex-1 space-y-1 overflow-y-auto px-3 py-4 ${hydrated ? "" : "invisible"}`}>
        {mainNav.map((item) => (
          <Link key={item.href} href={item.href} onClick={onNavigate} className={linkClass(current === item.href)}>
            {t(item.tr, item.en)}
          </Link>
        ))}

        <SupplySection current={current} onNavigate={onNavigate} enabled={!!user} />

        {shopNav.length > 0 && (
          <>
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
              {shopNav.map((item) => (
                <Link key={item.href} href={item.href} onClick={onNavigate} className={linkClass(current === item.href, true)}>
                  {t(item.tr, item.en)}
                </Link>
              ))}
            </div>
          )}
          </>
        )}

        <Link href={SETTINGS_NAV.href} onClick={onNavigate} className={linkClass(current === SETTINGS_NAV.href)}>
          {t(SETTINGS_NAV.tr, SETTINGS_NAV.en)}
        </Link>

        <Link href={SUPPORT_NAV.href} onClick={onNavigate} className={`${linkClass(current === SUPPORT_NAV.href)} flex items-center justify-between`}>
          {t(SUPPORT_NAV.tr, SUPPORT_NAV.en)}
          {supportUnread > 0 && (
            <span className="min-w-[1.25rem] rounded-full bg-[#D97757] px-1.5 text-center text-[11px] font-semibold leading-5 text-white" aria-label={t(`${supportUnread} okunmamış yanıt`, `${supportUnread} unread replies`)}>
              {supportUnread}
            </span>
          )}
        </Link>

        {user?.is_admin && (
          <Link href={ADMIN_NAV.href} onClick={onNavigate} className={linkClass(current === ADMIN_NAV.href)}>
            {t(ADMIN_NAV.tr, ADMIN_NAV.en)}
          </Link>
        )}
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

const SUPPLY_SHOWN = 8;

/** Dış Tedarik: kenar çubuğunda sabit bölüm. Altında kullanıcının tedarikçileri (ve onunla paylaşılan kayıtlar) ve
 * "+ Yeni"; adlarını kullanıcı belirler. Liste modül sayfasıyla aynı depodan gelir (eklenince/silinince güncellenir). */
function SupplySection({ current, onNavigate, enabled }: { current: string; onNavigate?: () => void; enabled: boolean }) {
  const { t } = useT();
  const { list } = supplyStore.useState(enabled);
  const items = [
    ...(list?.own ?? []).filter((e) => !e.archived).map((e) => ({ id: e.id, name: e.name, image: e.image, shared: false })),
    ...(list?.shared ?? []).map((e) => ({ id: e.id, name: e.name, image: e.image, shared: true })),
  ];
  const shown = items.slice(0, SUPPLY_SHOWN);
  return (
    <div className="space-y-1">
      <Link href={SUPPLY_NAV.href} onClick={onNavigate} className={linkClass(current === SUPPLY_NAV.href)}>
        {t(SUPPLY_NAV.tr, SUPPLY_NAV.en)}
      </Link>
      {shown.map((e) => {
        const href = `${SUPPLY_NAV.href}/${e.id}`;
        return (
          <Link key={e.id} href={href} onClick={onNavigate} title={e.name} className={`${linkClass(current === href, true)} flex items-center gap-2 truncate`}>
            <EntityAvatar name={e.name} src={e.image ? supplyApi.imageUrl(e.id, e.image) : null} size={18} />
            <span className="truncate">{e.name}</span>
            {e.shared && <span className="ml-1 text-[10px] font-normal text-[#C6613F] dark:text-[#E8A48C]">· {t("paylaşılan", "shared")}</span>}
          </Link>
        );
      })}
      {items.length > SUPPLY_SHOWN && (
        <Link href={SUPPLY_NAV.href} onClick={onNavigate} className={`${linkClass(false, true)} text-xs`}>
          {t(`+${items.length - SUPPLY_SHOWN} daha`, `+${items.length - SUPPLY_SHOWN} more`)}
        </Link>
      )}
    </div>
  );
}

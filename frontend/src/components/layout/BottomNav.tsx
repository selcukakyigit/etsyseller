"use client";

import Link from "next/link";
import { MenuIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";
import { useHydrated } from "@/lib/useHydrated";
import { BOTTOM_TABS, forShops } from "./navItems";

/** Mobil alt sekme çubuğu (lg altı): en sık açılan sayfalar + geri kalanı için "Menü". Telefonun alt güvenli alanına
 * (ana ekran çubuğu) göre boşluk bırakır; içeriğin ve yapışkan öğelerin yerleşimi için bkz. ./constants. */

export default function BottomNav({ current, onMenu, hasShop }: { current: string; onMenu: () => void; hasShop: boolean }) {
  const { t } = useT();
  const hydrated = useHydrated(); // bkz. SidebarNav: sunucu HTML'i hatırlanan mağaza durumunu bilmez
  const item = (active: boolean) =>
    `flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
      active ? "text-[#D97757]" : "text-neutral-500 dark:text-neutral-400"
    }`;

  return (
    <nav
      aria-label={t("Ana gezinme", "Main navigation")}
      className={`fixed inset-x-0 bottom-0 z-50 flex border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95 lg:hidden ${hydrated ? "" : "invisible"}`}
    >
      {forShops(BOTTOM_TABS, hasShop).map(({ href, tr, en, icon: Icon }) => (
        <Link key={href} href={href} className={item(current === href)} aria-current={current === href ? "page" : undefined}>
          {Icon && <Icon />}
          {t(tr, en)}
        </Link>
      ))}
      <button type="button" onClick={onMenu} className={item(false)}>
        <MenuIcon />
        {t("Menü", "Menu")}
      </button>
    </nav>
  );
}

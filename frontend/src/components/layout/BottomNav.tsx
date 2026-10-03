"use client";

import Link from "next/link";
import { MenuIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";
import { BOTTOM_TABS } from "./navItems";

/** Mobil alt sekme çubuğu (lg altı): en sık açılan sayfalar + geri kalanı için "Menü". Telefonun alt güvenli alanına
 * (ana ekran çubuğu) göre boşluk bırakır; AppShell içeriğin altına bu yükseklik kadar boşluk ekler (BOTTOM_NAV_SPACE). */
export const BOTTOM_NAV_SPACE = "pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0";

export default function BottomNav({ current, onMenu }: { current: string; onMenu: () => void }) {
  const { t } = useT();
  const item = (active: boolean) =>
    `flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
      active ? "text-[#D97757]" : "text-neutral-500 dark:text-neutral-400"
    }`;

  return (
    <nav
      aria-label={t("Ana gezinme", "Main navigation")}
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95 lg:hidden"
    >
      {BOTTOM_TABS.map(({ href, tr, en, icon: Icon }) => (
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

"use client";

import { ReactNode, useCallback, useState } from "react";
import { Shop, User } from "@/lib/api";
import Sidebar from "@/components/layout/Sidebar";
import MobileDrawer from "@/components/layout/MobileDrawer";
import BottomNav, { BOTTOM_NAV_SPACE } from "@/components/layout/BottomNav";
import Topbar from "@/components/Topbar";
import { useT } from "@/lib/i18n-client";

export default function AppShell({
  user,
  shops,
  activeShop,
  onSwitchShop,
  current,
  children,
}: {
  user: User | null;
  shops?: Shop[] | null;
  activeShop: Shop | null;
  onSwitchShop?: (id: number) => void;
  current: string;
  children: ReactNode;
}) {
  const { t } = useT();
  // Mobil menü (lg altı): üst bardaki ☰ ve alt çubuktaki "Menü" açar.
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const shell = { user, shops: shops ?? null, activeShop, onSwitchShop, current };
  // Sidebar/Topbar `user` gelene kadar (kısa bir ağ isteği) hiç render edilmiyordu — sayfa önce tam genişlikte
  // açılıp bir anda kenar çubuğu ve üst bar belirince içerik yana/aşağı kayıyordu ("UI zıplaması"). İkisi de artık
  // her zaman render ediliyor; eksik veri gerektiren kısımları (kullanıcı adı, aktif mağaza) kendi içlerinde bekliyor.
  return (
    <div className="flex min-h-screen min-w-0">
      <Sidebar {...shell} />
      <MobileDrawer {...shell} open={menuOpen} onClose={closeMenu} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar activeShop={activeShop} onMenu={openMenu} />
        {activeShop?.is_demo && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {t(
              "Demo mağaza: kendi Etsy mağazamızdan 20 listing ve 20 siparişin kopyası. Alıcı adları, adresleri ve mesajları sahte değerlerle değiştirildi. Bu hesaptan Etsy'ye hiçbir şey gönderilmez.",
              "Demo shop: a copy of 20 listings and 20 orders from our own Etsy shop. Buyer names, addresses and messages are replaced with placeholders. Nothing is sent to Etsy from this account.",
            )}
          </div>
        )}
        <main className={`min-h-[calc(100vh-49px)] flex-1 bg-neutral-50 dark:bg-neutral-950 ${BOTTOM_NAV_SPACE}`}>{children}</main>
      </div>
      <BottomNav current={current} onMenu={openMenu} />
    </div>
  );
}

"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import { Shop, User } from "@/lib/api";
import Sidebar from "@/components/layout/Sidebar";
import MobileDrawer from "@/components/layout/MobileDrawer";
import BottomNav from "@/components/layout/BottomNav";
import ShopRequired from "@/components/layout/ShopRequired";
import { PageSpinner } from "@/components/ui/Spinner";
import { useShopState } from "@/lib/useShopState";
import { BOTTOM_NAV_SPACE } from "@/components/layout/constants";
import Topbar from "@/components/Topbar";
import SummaryStrip, { useSummaryStrip } from "@/components/layout/SummaryStrip";
import { SiteAnnouncementBar } from "@/components/layout/AnnouncementBar";
import CreditRequiredModal from "@/components/billing/CreditRequiredModal";
import { useT } from "@/lib/i18n-client";
import { usePresence } from "@/lib/usePresence";
import { installClientErrorBuffer } from "@/lib/clientErrors";
import { useHydrated } from "@/lib/useHydrated";
import ProductTour from "@/components/tour/ProductTour";
import { mainTour, markTourSeen, startTour, tourSeen } from "@/components/tour/steps";
import { api } from "@/lib/api";

export default function AppShell({
  user,
  shops,
  activeShop,
  onSwitchShop,
  current,
  requiresShop = false,
  children,
}: {
  user: User | null;
  shops?: Shop[] | null;
  activeShop: Shop | null;
  onSwitchShop?: (id: number) => void;
  current: string;
  /** Sayfa bağlı Etsy mağazası olmadan anlamsızsa true: mağaza yokken sayfa yerine "mağazanı bağla" gösterilir. */
  requiresShop?: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  // Mobil menü (lg altı): üst bardaki ☰ ve alt çubuktaki "Menü" açar.
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const shopState = useShopState(shops);
  // Ürün turu: örnek mağazadaki kullanıcıya ilk girişte kendiliğinden açılır; herkes "Turu başlat" ile (destek sayfası, örnek mağaza bandı) istediği zaman açar.
  const hydrated = useHydrated();
  const [tourRequested, setTourRequested] = useState(false);
  const [tourClosed, setTourClosed] = useState(false);
  useEffect(() => {
    const open = () => {
      setTourClosed(false);
      setTourRequested(true);
    };
    window.addEventListener("ulagg:start-tour", open);
    return () => window.removeEventListener("ulagg:start-tour", open);
  }, []);
  const autoTour = hydrated && !!user && !!activeShop?.is_demo && current === "/dashboard" && !tourSeen(user.id);
  const tourOpen = !tourClosed && (tourRequested || autoTour);
  const shell = { user, hasShop: shopState === "yes", shops: shops ?? null, activeShop, onSwitchShop, current };
  usePresence(current, !!user);
  useEffect(installClientErrorBuffer, []); // destek talebine eklenecek son arayüz hataları için
  const strip = useSummaryStrip(user ? activeShop : null);
  // Sidebar/Topbar `user` gelene kadar (kısa bir ağ isteği) hiç render edilmiyordu — sayfa önce tam genişlikte
  // açılıp bir anda kenar çubuğu ve üst bar belirince içerik yana/aşağı kayıyordu ("UI zıplaması"). İkisi de artık
  // her zaman render ediliyor; eksik veri gerektiren kısımları (kullanıcı adı, aktif mağaza) kendi içlerinde bekliyor.
  return (
    <div className="flex min-h-screen min-w-0">
      <Sidebar {...shell} />
      <MobileDrawer {...shell} open={menuOpen} onClose={closeMenu} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar activeShop={activeShop} strip={strip} />
        <SummaryStrip strip={strip} />
        {!!user && <SiteAnnouncementBar />}
        {activeShop?.is_demo && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <span className="min-w-0 flex-1">
              {t(
                "Örnek mağaza: buradaki her şey uydurma veridir, gerçek bir mağaza değildir. Güvenle deneyebilirsin; Etsy'ye hiçbir şey gönderilmez.",
                "Sample shop: everything here is made-up data, not a real shop. Try anything: nothing is sent to Etsy.",
              )}
            </span>
            <button type="button" onClick={startTour} className="font-medium underline underline-offset-2">
              {t("Turu başlat", "Start the tour")}
            </button>
            <a href={api.shops.connectUrl()} className="font-medium underline underline-offset-2">
              {t("Gerçek mağazanı bağla", "Connect your real shop")}
            </a>
          </div>
        )}
        <main className={`min-h-[calc(100vh-49px)] flex-1 bg-neutral-50 dark:bg-neutral-950 ${BOTTOM_NAV_SPACE}`}>{requiresShop && !!user ? (shopState === "yes" ? children : shopState === "no" ? <ShopRequired /> : <PageSpinner />) : children}</main>
      </div>
      <BottomNav current={current} onMenu={openMenu} hasShop={shopState === "yes"} />
      <CreditRequiredModal />
      {tourOpen && user && (
        <ProductTour
          steps={mainTour(!!activeShop?.is_demo)}
          connectHref={activeShop?.is_demo ? api.shops.connectUrl() : undefined}
          onClose={() => {
            markTourSeen(user.id);
            setTourClosed(true);
            setTourRequested(false);
          }}
        />
      )}
    </div>
  );
}

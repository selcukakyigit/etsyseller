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
import { Modal } from "@/components/listing-editor/Modal";

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
  const [confirmConnect, setConfirmConnect] = useState(false);
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <span className="min-w-0 flex-1">
              {t(
                "Örnek mağaza: buradaki her şey uydurma veridir, gerçek bir mağaza değildir. Güvenle deneyebilirsin; Etsy'ye hiçbir şey gönderilmez. Gerçek mağazanı bağlayınca örnek veri silinir, kredilerin korunur.",
                "Sample shop: everything here is made-up data, not a real shop. Try anything: nothing is sent to Etsy. When you connect your real shop the sample data is removed and your credits are kept.",
              )}
            </span>
            <button type="button" onClick={startTour} className="font-medium underline underline-offset-2">
              {t("Turu başlat", "Start the tour")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmConnect(true)}
              className="rounded-lg bg-[#D97757] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#C6613F]"
            >
              {t("Gerçek mağazanı bağla", "Connect your real shop")}
            </button>
          </div>
        )}
        <main className={`min-h-[calc(100vh-49px)] flex-1 bg-neutral-50 dark:bg-neutral-950 ${BOTTOM_NAV_SPACE}`}>{requiresShop && !!user ? (shopState === "yes" ? children : shopState === "no" ? <ShopRequired /> : <PageSpinner />) : children}</main>
      </div>
      <BottomNav current={current} onMenu={openMenu} hasShop={shopState === "yes"} />
      <CreditRequiredModal />
      {confirmConnect && (
        <Modal
          title={t("Gerçek mağazanı bağla", "Connect your real shop")}
          widthClass="max-w-md"
          sheet
          onClose={() => setConfirmConnect(false)}
          closeButton
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmConnect(false)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {t("Vazgeç", "Cancel")}
              </button>
              <a href={api.shops.connectUrl()} className="rounded-lg bg-[#D97757] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#C6613F]">
                {t("Etsy'ye bağlan", "Connect Etsy")}
              </a>
            </div>
          }
        >
          <div className="space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
            <p>{t("Etsy'yi bağladığında örnek mağaza ve içindeki her şey (taslaklar, asistan notları, örnek siparişler) silinir ve yerine kendi mağazanın verisi gelir.", "When you connect Etsy, the sample shop and everything in it (drafts, assistant notes, sample orders) is deleted and your own shop's data takes its place.")}</p>
            <p>{t("Kredi bakiyen ve geçmişin korunur.", "Your credit balance and history are kept.")}</p>
          </div>
        </Modal>
      )}
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

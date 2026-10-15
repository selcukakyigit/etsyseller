"use client";

import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import { pageContainer } from "@/components/layout/pageContainer";
import ChatPanel from "@/components/assistant/ChatPanel";
import { useDashboardData } from "@/components/dashboard/stats";
import { PageSpinner } from "@/components/ui/Spinner";

/** Ana sayfa = Ulagg: sayfanın tamamı sohbet. Sayılar ve ayrıntılar Analiz sayfasında. */
export default function DashboardPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const shopId = activeShop?.id;
  const { error, reload } = useDashboardData(shopId); // sohbet bir şey değiştirince Analiz'in ortak verisi tazelenir

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/dashboard" requiresShop>
      <div className={pageContainer("dashboard", "compact")}>
        {!user && !bootError && <PageSpinner />}
        {(bootError || error) && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{bootError ?? error}</p>}

        {shopId !== undefined && (
          <ChatPanel shopId={shopId} onSent={reload} heightClass="h-[calc(100dvh-7.75rem-env(safe-area-inset-bottom))] min-h-[24rem] sm:h-[calc(100dvh-10rem)] lg:h-[calc(100vh-8rem)]" />
        )}
      </div>
    </AppShell>
  );
}

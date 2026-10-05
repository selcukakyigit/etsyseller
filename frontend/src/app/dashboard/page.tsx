"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import ChatPanel from "@/components/assistant/ChatPanel";
import { useDashboardData } from "@/components/dashboard/stats";
import { useT } from "@/lib/i18n-client";
import { PageSpinner } from "@/components/ui/Spinner";

/** Ana sayfa = Ulagg. Üstte yalnızca her açılışta bakılan iki sayı (bugün, gönderilecek); ayrıntılı tablo Analiz sayfasında. */
export default function DashboardPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t, locale } = useT();
  const shopId = activeShop?.id;
  const { data, error, reload } = useDashboardData(shopId);

  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: data?.currency ?? "USD", maximumFractionDigits: 0 }).format(n);
  const chip = "flex min-w-0 items-baseline gap-1.5 rounded-lg px-2 py-1 transition hover:bg-neutral-100 dark:hover:bg-neutral-800";

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/dashboard">
      <div className="mx-auto max-w-[96rem] px-4 py-4 sm:px-6 sm:py-6">
        <div className="min-h-[20px]">{!user && !bootError && <PageSpinner />}</div>
        {(bootError || error) && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{bootError ?? error}</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-4 text-neutral-600 dark:text-neutral-300">
              {t("Ulagg'ı kullanmak için önce Etsy mağazanı bağlaman gerekiyor.", "Connect your Etsy shop to start using Ulagg.")}
            </p>
            <a href={api.shops.connectUrl()} className="inline-block rounded-lg bg-[#D97757] px-4 py-2 text-sm font-medium text-white hover:bg-[#C6613F]">
              {t("Etsy'ye Bağlan", "Connect Etsy")}
            </a>
          </div>
        )}

        {shopId !== undefined && (
          <div className="space-y-3">
            {/* Tek satır özet: bugün + gönderilecek; geri kalan her şey Analiz'de. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div className={chip}>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">{t("Bugün", "Today")}</span>
                <b className="text-neutral-900 dark:text-neutral-100">{data ? money(data.today.sales) : "—"}</b>
                {data && <span className="text-xs text-neutral-500 dark:text-neutral-400">· {t(`${data.today.orders} sipariş`, `${data.today.orders} orders`)}</span>}
              </div>
              <Link href="/orders" className={chip}>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">{t("Gönderilecek", "To ship")}</span>
                <b className="text-neutral-900 dark:text-neutral-100">{data ? data.to_ship : "—"}</b>
                {data && data.overdue > 0 && <span className="text-xs font-medium text-red-600 dark:text-red-400">· {t(`${data.overdue} gecikmiş`, `${data.overdue} overdue`)}</span>}
              </Link>
              <Link href="/analysis" className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-[#B4553A] hover:bg-[#D97757]/10 dark:text-[#E89A7F]">
                {t("Analiz →", "Analysis →")}
              </Link>
            </div>

            <ChatPanel shopId={shopId} onSent={reload} heightClass="h-[calc(100vh-15rem)] min-h-[26rem] lg:h-[calc(100vh-11rem)]" />
          </div>
        )}
      </div>
    </AppShell>
  );
}

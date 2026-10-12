"use client";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

/** Mağaza gerektiren bir sayfa, kullanıcının bağlı Etsy mağazası yokken boş ya da sonsuz yükleniyor görünmesin:
 * tek yerde, tüm sayfalar için aynı açıklama ve "Etsy'ye bağlan" düğmesi (bkz. AppShell `requiresShop`). */
export default function ShopRequired() {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("Önce Etsy mağazanı bağla", "Connect your Etsy shop first")}</h1>
        <p className="mb-5 mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          {t("Bu sayfa mağazanın verileriyle çalışır. Mağazanı bağladığında burada görünecek.", "This page works with your shop's data. It will show up here once your shop is connected.")}
        </p>
        <a href={api.shops.connectUrl()} className="inline-block rounded-lg bg-[#D97757] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#C6613F]">
          {t("Etsy'ye Bağlan", "Connect Etsy")}
        </a>
      </div>
    </div>
  );
}

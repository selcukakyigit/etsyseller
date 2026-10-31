"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { clearSessionCache } from "@/lib/sessionCache";
import { toast } from "@/lib/toast";
import { Spinner } from "@/components/ui/Spinner";

/** Mağaza gerektiren bir sayfa, kullanıcının bağlı Etsy mağazası yokken boş ya da sonsuz yükleniyor görünmesin:
 * tek yerde, tüm sayfalar için aynı açıklama; "Etsy'ye bağlan" ya da bağlamadan ürünü denemek için "Örnek mağaza ile dene"
 * (bkz. AppShell `requiresShop`). */
export default function ShopRequired() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);

  async function trySample() {
    setBusy(true);
    try {
      await api.shops.createSample();
      clearSessionCache(); // mağaza listesi yeniden okunsun
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Örnek mağaza açılamadı", "Could not open the sample shop"));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("Önce Etsy mağazanı bağla", "Connect your Etsy shop first")}</h1>
        <p className="mb-5 mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          {t("Bu sayfa mağazanın verileriyle çalışır. Mağazanı bağladığında burada görünecek.", "This page works with your shop's data. It will show up here once your shop is connected.")}
        </p>
        <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
          <a href={api.shops.connectUrl()} className="inline-block rounded-lg bg-[#D97757] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#C6613F]">
            {t("Etsy'ye Bağlan", "Connect Etsy")}
          </a>
          <button
            type="button"
            disabled={busy}
            onClick={trySample}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {busy && <Spinner size={14} />}
            {t("Örnek mağaza ile dene", "Try with a sample shop")}
          </button>
        </div>
        <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
          {t("Örnek mağaza uydurma verilerle gelir; bağlamadan her özelliği deneyebilirsin. Etsy'yi bağlayınca kendiliğinden kalkar.", "The sample shop comes with made-up data so you can try every feature without connecting. It disappears when you connect Etsy.")}
        </p>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";
import { useT } from "@/lib/i18n-client";
import { COMPANY } from "@/lib/legal";

export default function HelpSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();

  return (
    <SettingsSubpage
      user={user}
      shops={shops}
      activeShop={activeShop}
      onSwitchShop={setActiveShopId}
      title={t("Yardım & Destek", "Help & Support")}
    >
      {bootError && <p className="text-sm text-red-600">{bootError}</p>}

      <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Veriler ne zaman güncellenir?", "When is data updated?")}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            {t(
              "Siparişler 2 saatte bir, listing'ler, yorumlar ve mağaza profili 4 saatte bir Etsy'den yenilenir. Üst çubuktaki senkronize düğmesiyle istediğin an yenileyebilirsin.",
              "Orders refresh from Etsy every 2 hours; listings, reviews and the shop profile every 4 hours. You can refresh any time with the sync button in the top bar.",
            )}
          </p>
        </div>

        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Etsy'ye ne zaman yazılır?", "When is anything written to Etsy?")}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            {t(
              "Düzenlemeler önce yerel taslak olarak kalır. Etsy'deki listing yalnızca sen \"Etsy'de yayınla\" dediğinde değişir.",
              "Edits stay as local drafts first. A listing on Etsy changes only when you choose \"Publish to Etsy\".",
            )}
          </p>
        </div>

        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Bağlantıyı kesme", "Disconnecting")}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            {t(
              "Ayarlar > Mağaza Bağlantısı'ndan Etsy bağlantısını kesebilirsin. Erişim anahtarları ve Etsy'den gelen tüm önbellek verisi silinir.",
              "You can disconnect Etsy under Settings > Shop connection. The access tokens and all cached Etsy data are deleted.",
            )}{" "}
            <Link href="/settings/shop" className="underline">
              {t("Mağaza Bağlantısı", "Shop connection")}
            </Link>
          </p>
        </div>

        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("İletişim", "Contact")}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            {t("Bir sorunla karşılaşırsan bize yaz:", "If something goes wrong, write to us:")}{" "}
            <a href={`mailto:${COMPANY.email}`} className="underline">
              {COMPANY.email}
            </a>{" "}
            {t("ya da", "or use the")}{" "}
            <Link href="/contact" className="underline">
              {t("iletişim formunu kullan", "contact form")}
            </Link>
            .
          </p>
        </div>
      </section>
    </SettingsSubpage>
  );
}

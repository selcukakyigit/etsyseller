"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import { pageContainer } from "@/components/layout/pageContainer";
import HelpTip from "@/components/ui/HelpTip";
import { PageSpinner } from "@/components/ui/Spinner";
import { discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SavedPanel from "./SavedPanel";
import SearchPanel from "./SearchPanel";

type Tab = "search" | "saved";

/** Keşfet: kullanıcının kelime araştırması. Sonuçlar ortak havuzdan gelir (aynı kelime ikinci kez araştırılmaz); ham arama sayısı yerine talep bandı gösterilir. */
export default function DiscoverPage() {
  const { t } = useT();
  const { user, shops, activeShop, setActiveShopId } = useAuthAndShop();
  const [tab, setTab] = useState<Tab>("search");
  const [refreshKey, setRefreshKey] = useState(0);
  const shopId = activeShop?.id;
  const collections = useApiData(`discover:collections:${shopId ?? "none"}:${refreshKey}`, async () => (shopId === undefined ? null : discoverApi.saved(shopId)));

  if (!user || shops === null) return <PageSpinner />;

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/discover" requiresShop>
      <div className={pageContainer("form", "normal", "space-y-5")}>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("Keşfet", "Discover")}</h1>
          <HelpTip>
            {t(
              "Kelime araştırması: bir kelimenin ilgili aramalarını, Google'daki talep seviyesini (düşük/orta/yüksek) ve alıcı niyetini gösterir. Talep Google verisidir, Etsy arama hacmi değildir; Etsy'ye özgü sayıları Analiz > Etsy verisi'nden alırsın. ⚑ Kalabalık: son günlerde birçok mağazaya önerilmiş, herkes aynı kelimeyle yarışır. Daha önce araştırılmış kelimeler anında gelir ve sayılmaz; yeni kelimelerin günlük bir hakkı vardır.",
              "Keyword research: shows a keyword's related searches, its demand level on Google (low/medium/high) and buyer intent. Demand is Google data, not Etsy search volume; get Etsy-specific numbers from Analysis > Etsy data. ⚑ Crowded: recently suggested to many shops, so everyone competes for the same word. Keywords researched before appear instantly and are not counted; new keywords have a daily allowance.",
            )}
          </HelpTip>
        </div>

        <div role="tablist" className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
          {(
            [
              ["search", t("Araştır", "Research")],
              ["saved", t("Kaydedilenler", "Saved")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === key ? "border-[#D97757] text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!activeShop ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Önce Etsy mağazanı bağla.", "Connect your Etsy shop first.")}</p>
        ) : (
          <>
            {/* İki panel de bağlı kalır: sekme değişince aranan kelime ve seçim kaybolmasın. */}
            <div className={tab === "search" ? "" : "hidden"}>
              <SearchPanel key={activeShop.id} shopId={activeShop.id} collections={collections.data?.collections ?? []} onSaved={() => setRefreshKey((k) => k + 1)} />
            </div>
            <div className={tab === "saved" ? "" : "hidden"}>
              <SavedPanel key={activeShop.id} shopId={activeShop.id} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

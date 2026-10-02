"use client";

import { ListingHistory } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useStoredState } from "@/lib/useStoredState";
import { ChangeHistoryTab, PerformanceTab, useListingHistory } from "@/components/ListingHistoryPanel";
import DiagnosisTab from "./DiagnosisTab";
import RankTab from "./RankTab";

// Sekmeler; yeni bir analiz eklemek için buraya bir giriş ve aşağıya bir dal eklenir.
const TABS = ["diagnosis", "performance", "ranks", "history"] as const;
type Tab = (typeof TABS)[number];

/** Listing satırındaki "Analiz" paneli: Teşhis, Performans, Sıralama ve Değişiklik geçmişi sekmeleri. Seçili sekme hatırlanır.
 * Henüz Etsy'de olmayan (yeni) listing'de yalnızca değişiklik geçmişi anlamlıdır. */
export default function ListingAnalysisPanel({ shopId, listingId, initialHistory }: { shopId: number; listingId: number; initialHistory?: ListingHistory }) {
  const { t } = useT();
  const [stored, setTab] = useStoredState<Tab>("listing.analysisTab", "diagnosis", TABS);
  const tabs: Tab[] = listingId > 0 ? [...TABS] : ["history"];
  const tab: Tab = tabs.includes(stored) ? stored : tabs[0];
  const { history, error } = useListingHistory(shopId, listingId, initialHistory);
  const label: Record<Tab, string> = {
    diagnosis: t("Teşhis", "Diagnosis"),
    performance: t("Performans", "Performance"),
    ranks: t("Sıralama", "Rankings"),
    history: t("Değişiklik geçmişi", "Change history"),
  };

  return (
    <div className="border-t border-neutral-100 bg-neutral-50/50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition ${
              tab === k
                ? "border-[#D97757] text-neutral-900 dark:text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {label[k]}
          </button>
        ))}
      </div>
      {error && tab !== "diagnosis" && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {tab === "diagnosis" && <DiagnosisTab shopId={shopId} listingId={listingId} />}
      {tab === "performance" && <PerformanceTab shopId={shopId} listingId={listingId} history={history} />}
      {tab === "ranks" && <RankTab shopId={shopId} listingId={listingId} />}
      {tab === "history" && <ChangeHistoryTab history={history} />}
    </div>
  );
}

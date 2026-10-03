"use client";

import { useT } from "@/lib/i18n-client";
import { useStoredState } from "@/lib/useStoredState";
import ChangesTab from "./ChangesTab";
import DiagnosisTab from "./DiagnosisTab";
import RankTab from "./RankTab";
import EtsyDataTab from "./EtsyDataTab";

// Sekmeler; yeni bir analiz eklemek için buraya bir giriş ve aşağıya bir dal eklenir.
const TABS = ["diagnosis", "changes", "ranks", "etsy"] as const;
type Tab = (typeof TABS)[number];

/** Listing satırındaki "Analiz" paneli: Teşhis (ne durumda, neden), Değişiklikler ve sonuçları (ne yaptık, işe yaradı mı),
 * Sıralama ve Etsy verisi. Seçili sekme hatırlanır. Henüz Etsy'de olmayan (yeni) listing'de analiz yoktur. */
export default function ListingAnalysisPanel({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t } = useT();
  const [stored, setTab] = useStoredState<Tab>("listing.analysisTab", "diagnosis", TABS);
  const tab: Tab = TABS.includes(stored) ? stored : "diagnosis";
  const label: Record<Tab, string> = {
    diagnosis: t("Teşhis", "Diagnosis"),
    changes: t("Değişiklikler ve sonuçları", "Changes and results"),
    ranks: t("Sıralama", "Rankings"),
    etsy: t("Etsy verisi", "Etsy data"),
  };

  if (listingId <= 0) {
    return (
      <div className="border-t border-neutral-100 bg-neutral-50/50 p-4 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-400">
        {t("Analiz, listing Etsy'de yayınlandıktan sonra başlar.", "Analysis starts once the listing is published on Etsy.")}
      </div>
    );
  }

  return (
    <div className="border-t border-neutral-100 bg-neutral-50/50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map((k) => (
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
      {tab === "diagnosis" && <DiagnosisTab shopId={shopId} listingId={listingId} />}
      {tab === "changes" && <ChangesTab shopId={shopId} listingId={listingId} />}
      {tab === "ranks" && <RankTab shopId={shopId} listingId={listingId} />}
      {tab === "etsy" && <EtsyDataTab shopId={shopId} listingId={listingId} />}
    </div>
  );
}

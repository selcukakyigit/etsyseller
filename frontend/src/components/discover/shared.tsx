"use client";

import type { Demand, DiscoverItem, Intent } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";

/** Keşfet'in ortak küçük parçaları: talep/niyet rozetleri ve sonuç satırı. Ham arama sayısı hiçbir yerde gösterilmez. */

const DEMAND_STYLE: Record<Demand, string> = {
  high: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  medium: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

export function DemandBadge({ demand }: { demand: Demand | null }) {
  const { t } = useT();
  if (demand === null) {
    return (
      <span
        className="inline-flex rounded-full bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500"
        title={t("Ölçüm hazırlanıyor; birazdan görünür.", "Measurement in progress; it will appear shortly.")}
      >
        …
      </span>
    );
  }
  const label = demand === "high" ? t("Yüksek", "High") : demand === "medium" ? t("Orta", "Medium") : t("Düşük", "Low");
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${DEMAND_STYLE[demand]}`}>{label}</span>;
}

export function useIntentLabel() {
  const { t } = useT();
  return (intent: Intent | null): string | null => {
    switch (intent) {
      case "informational":
        return t("Bilgi arıyor", "Researching");
      case "commercial":
        return t("Karşılaştırıyor", "Comparing");
      case "transactional":
        return t("Almaya yakın", "Ready to buy");
      case "navigational":
        return t("Belirli yer", "Specific site");
      default:
        return null;
    }
  };
}

/** Bir kelime satırı: kelime, rozetler ve (verilirse) kaydet / çıkar düğmesi. Telefonda rozetler alta iner. */
export function KeywordRow({
  item,
  checked,
  onToggle,
  action,
}: {
  item: DiscoverItem;
  checked: boolean;
  onToggle: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const { t } = useT();
  const intentLabel = useIntentLabel();
  const intent = intentLabel(item.intent);
  return (
    <li className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
        <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 shrink-0 accent-[#D97757]" aria-label={item.term} />
        <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.term}</span>
      </label>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
        <DemandBadge demand={item.demand} />
        {intent && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{intent}</span>}
        {item.crowded && (
          <span
            className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            title={t("Son günlerde birçok mağazaya önerildi; herkes aynı kelimeyle yarışır.", "Recently suggested to many shops; everyone competes for the same word.")}
          >
            ⚑ {t("Kalabalık", "Crowded")}
          </span>
        )}
        {item.mine && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" title={t("Listing'lerinde zaten etiket olarak var", "Already a tag on your listings")}>
            ✓ {t("Sende var", "You use it")}
          </span>
        )}
        {item.saved && !action && <span className="text-[11px] text-[#D97757]">★</span>}
        {action && (
          <button type="button" onClick={action.onClick} className="rounded-md px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200">
            {action.label}
          </button>
        )}
      </div>
    </li>
  );
}

/** Kuyruğa alınamayan aramanın nedeni (backend `QueueRefused.reason`). */
export function useRefusedText() {
  const { t } = useT();
  return (reason: string | null): string => {
    switch (reason) {
      case "shop_searches":
        return t("Bugünkü yeni kelime araştırma hakkın doldu. Daha önce araştırılmış kelimeler sınırsız; yarın yeniden dene.", "You have used today's new keyword searches. Keywords already researched are unlimited; try again tomorrow.");
      case "shop_daily":
        return t("Bugünkü araştırma hakkın doldu; yarın yeniden dene.", "You have used today's research allowance; try again tomorrow.");
      case "budget":
        return t("Araştırma şu an yoğun; birazdan yeniden dene.", "Research is busy right now; try again shortly.");
      case "not_configured":
      case "disabled":
        return t("Kelime araştırması şu an kullanılamıyor.", "Keyword research is not available right now.");
      case "market":
        return t("Bu pazar desteklenmiyor.", "This market is not supported.");
      default:
        return t("Araştırma şu an yapılamıyor.", "Research is not available right now.");
    }
  };
}

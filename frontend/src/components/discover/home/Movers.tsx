"use client";

import type { OverviewMover } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import Sparkline from "../Sparkline";
import { Card, compact } from "./Card";

function Column({ title, tone, rows, empty, onPick }: { title: string; tone: "up" | "down"; rows: OverviewMover[]; empty: string; onPick: (term: string) => void }) {
  const { t, locale } = useT();
  const color = tone === "up" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400";
  return (
    <div className="min-w-0">
      <h3 className={`mb-1.5 flex items-center gap-1 text-xs font-semibold ${color}`}>
        <svg viewBox="0 0 12 12" className={`h-3 w-3 ${tone === "down" ? "rotate-180" : ""}`} fill="currentColor" aria-hidden>
          <path d="M6 2l4 6H2z" />
        </svg>
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.term}>
              <button type="button" onClick={() => onPick(r.term)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">{r.term}</span>
                  <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    {r.volume !== null && t(`${compact(r.volume, locale)} aylık`, `${compact(r.volume, locale)}/mo`)}
                    {r.seasonal && ` · ${t("sezonluk", "seasonal")}`}
                  </span>
                </span>
                <Sparkline values={r.monthly} width={56} height={20} label={r.term} />
                <span className={`w-12 text-right text-xs font-semibold tabular-nums ${color}`}>
                  {r.trend_pct > 0 ? "+" : ""}
                  {r.trend_pct}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Etiketlerinin son 3 ayı, 12 aylık serinin ilk 3 ayına göre: hangileri yükseliyor, hangileri geriliyor. */
export default function Movers({ movers, onPick }: { movers: { rising: OverviewMover[]; falling: OverviewMover[] }; onPick: (term: string) => void }) {
  const { t } = useT();
  return (
    <Card
      title={t("Yükselenler ve düşenler", "Rising and falling")}
      help={t(
        "Etiketlerinin son 3 aydaki Google aramasının ortalaması, 12 aylık serinin ilk 3 ayına göre ne kadar değişti. Aylık araması çok az olan kelimeler ve %15'ten küçük değişimler gösterilmez. 'Sezonluk' etiket yükseliyorsa bu sezondan olabilir, kalıcı bir artış sayma.",
        "How much the average Google searches of your tags over the last 3 months changed compared with the first 3 months of the 12-month series. Rarely searched keywords and changes under 15% are not shown. If a 'seasonal' tag is rising, it may just be the season, not a lasting gain.",
      )}
    >
      <div className="space-y-4">
        <Column title={t("Yükselenler", "Rising")} tone="up" rows={movers.rising} empty={t("Belirgin bir yükseliş yok.", "No clear risers.")} onPick={onPick} />
        <Column title={t("Düşenler", "Falling")} tone="down" rows={movers.falling} empty={t("Belirgin bir düşüş yok.", "No clear decliners.")} onPick={onPick} />
      </div>
    </Card>
  );
}

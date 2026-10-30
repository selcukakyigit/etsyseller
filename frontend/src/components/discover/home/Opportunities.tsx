"use client";

import type { DiscoverItem } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { useIntentLabel } from "../shared";
import { Card, compact } from "./Card";

/** Fırsat kelimeler: etiketlerinin önerileri arasından mağazada olmayan, çok aranan ve kalabalık olmayanlar. Etsy rekabetini ölçmez: kelimeye tıklayıp "Etsy'de kaç ilan var?" ile bakılır. */
export default function Opportunities({ items, onPick }: { items: DiscoverItem[]; onPick: (term: string) => void }) {
  const { t, locale } = useT();
  const intentLabel = useIntentLabel();
  const max = Math.max(1, ...items.map((i) => i.volume ?? 0));
  return (
    <Card
      title={t("Fırsat kelimeler", "Opportunity keywords")}
      help={t(
        "Etiketlerinin ilgili aramaları arasından: mağazanda henüz etiket olarak olmayan, aylık araması yüksek (Google) ve son günlerde çok mağazaya önerilmediği için kalabalık sayılmayan kelimeler. Etsy'deki ilan sayısını ölçmez; bir kelimeye tıklayıp 'Etsy'de kaç ilan var?' ile rekabete bak.",
        "From the related searches of your tags: keywords you do not use as a tag yet, with high monthly Google searches, and not crowded because they have not been suggested to many shops lately. It does not measure Etsy listing counts; click a keyword and use 'How many Etsy listings?' to check competition.",
      )}
    >
      {items.length === 0 ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">{t("Şimdilik öneri yok. Etiketlerinden birini araştırdıkça burada fırsatlar çıkar.", "Nothing yet. Research one of your tags and opportunities will show up here.")}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => {
            const intent = intentLabel(i.intent);
            return (
              <li key={i.term}>
                <button type="button" onClick={() => onPick(i.term)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">{i.term}</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <span className="block h-full rounded-full bg-[#D97757]" style={{ width: `${Math.max(4, Math.round(((i.volume ?? 0) / max) * 100))}%` }} />
                    </span>
                  </span>
                  {intent && <span className="hidden rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] text-neutral-500 sm:inline dark:border-neutral-700 dark:text-neutral-400">{intent}</span>}
                  <span className="w-14 text-right text-xs font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{i.volume !== null ? compact(i.volume, locale) : "—"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

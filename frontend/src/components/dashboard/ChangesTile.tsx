"use client";

import Link from "next/link";
import { useEffect } from "react";
import { api, ChangesSummary } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { Spinner } from "@/components/ui/Spinner";
import { fieldsText, VERDICT_STYLE, verdictKey, verdictLabel } from "@/components/listings/analysis/changeLabels";

/** Dashboard: son 90 günde yayınlanan değişikliklerin sonuçları (iyileşti/değişmedi/kötüleşti/ölçülüyor) ve en yenileri.
 * "Yaptığım değişiklikler işe yarıyor mu?" sorusunun mağaza geneli cevabı. Hiç değişiklik yoksa görünmez. */
export default function ChangesTile({ shopId, className }: { shopId: number; className: string }) {
  const { t, locale } = useT();
  const [data, setData] = useCached<ChangesSummary>(`changes:${shopId}`);

  useEffect(() => {
    let cancelled = false;
    api.insights
      .changes(shopId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch(() => undefined); // yardımcı kart; yüklenemezse Dashboard etkilenmez
    return () => {
      cancelled = true;
    };
  }, [shopId, setData]);

  if (data && data.total === 0) return null;
  const c = data?.counts;

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-xs font-medium text-neutral-500 dark:text-neutral-400">
        <span>{t("Değişikliklerin sonuçları", "Results of your changes")}</span>
        {data && <span>{t(`son ${data.days} gün · ${data.total}`, `last ${data.days} days · ${data.total}`)}</span>}
      </div>
      {!data || !c ? (
        <div className="flex justify-center py-4">
          <Spinner size={18} />
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
            {c.better > 0 && <span className={`rounded-full px-2 py-0.5 ${VERDICT_STYLE.better}`}>{t(`${c.better} işe yaradı`, `${c.better} worked`)}</span>}
            {c.same > 0 && <span className={`rounded-full px-2 py-0.5 ${VERDICT_STYLE.same}`}>{t(`${c.same} fark yok`, `${c.same} no difference`)}</span>}
            {c.worse > 0 && <span className={`rounded-full px-2 py-0.5 ${VERDICT_STYLE.worse}`}>{t(`${c.worse} kötüleşti`, `${c.worse} got worse`)}</span>}
            {c.unclear > 0 && <span className={`rounded-full px-2 py-0.5 ${VERDICT_STYLE.unclear}`}>{t(`${c.unclear} belirsiz`, `${c.unclear} unclear`)}</span>}
            {c.waiting > 0 && <span className={`rounded-full px-2 py-0.5 ${VERDICT_STYLE.waiting}`}>{t(`${c.waiting} ölçülüyor`, `${c.waiting} measuring`)}</span>}
          </div>
          <ul className="mt-2 space-y-2">
            {data.items.map((i) => (
              <li key={i.change_id}>
                <Link href={`/listings/${i.listing_id}/edit`} className="group block">
                  <div className="truncate text-sm font-medium text-neutral-900 group-hover:text-[#B4553A] dark:text-neutral-100 dark:group-hover:text-[#E89A7F]">{i.title || `#${i.listing_id}`}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                    <span className={`rounded-full px-1.5 py-px font-medium ${VERDICT_STYLE[verdictKey(i.result)]}`}>{verdictLabel(t, i.result)}</span>
                    <span>
                      {new Date(i.published_at).toLocaleDateString(locale, { day: "2-digit", month: "short" })} · {fieldsText(t, i.fields)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
            {t(
              "Her yayın önceki ve sonraki eşit sürelerle, aynı dönemde dokunulmamış benzer listing'lere göre ölçülür (mevsim etkisi ayrılır); tesadüf olabilecek farklar \"belirsiz\" sayılır. Ayrıntı: listing'in Analiz → Değişiklikler ve sonuçları.",
              "Each publish is compared with an equal period before it, relative to similar listings left untouched in the same period (seasonality removed); differences that could be chance count as \"unclear\". Details: the listing's Analysis → Changes and results.",
            )}
          </p>
        </>
      )}
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { api, ListingDiagnosis } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { fieldsText, VERDICT_STYLE, verdictKey, verdictLabel } from "./changeLabels";
import NextStepCard from "./NextStepCard";

/** Düzenleyicide "AI Önerisi Üret"in altındaki kısa teşhis: sıradaki adım (AI önerisi buna odaklanır; düğmesi ilgili bölüme
 * götürür), son değişikliğin sonucu ve mevsim uyarısı. */
export default function DiagnosisStrip({
  shopId,
  listingId,
  onGo,
  onAi,
}: {
  shopId: number;
  listingId: number;
  onGo?: (sectionId: string) => void;
  onAi?: () => void;
}) {
  const { t, locale } = useT();
  const [d, setD] = useCached<ListingDiagnosis>(`diagnosis:${shopId}:${listingId}`);

  useEffect(() => {
    let cancelled = false;
    api.insights
      .diagnosis(shopId, listingId)
      .then((r) => {
        if (!cancelled) setD(r);
      })
      .catch(() => undefined); // şerit yardımcı bilgi; yüklenemezse düzenleyici etkilenmez
    return () => {
      cancelled = true;
    };
  }, [shopId, listingId, setD]);

  if (!d || !d.next_step) return null;
  const step = d.next_step;
  const lc = d.last_change;
  // Bekle / geri al / koru adımları son değişikliği zaten anlatıyor; diğerlerinde sonucu ayrıca göster.
  const showChange = lc && !["wait", "revert", "keep_working"].includes(step.key);
  const seasonWarning = (d.season.advice === "in_peak" || d.season.advice === "prepare") && !step.why.includes(d.season.text);

  return (
    <div className="space-y-2">
      {d.status === "declining" && (
        <span className="inline-block rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{d.headline}</span>
      )}
      <NextStepCard step={step} listingId={listingId} compact onGo={onGo} onAi={onAi} />
      {showChange && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          <span className={`mr-2 rounded-full px-2 py-0.5 font-medium ${VERDICT_STYLE[verdictKey(lc.result)]}`}>{verdictLabel(t, lc.result)}</span>
          {t(
            `Son değişiklik: ${new Date(lc.published_at).toLocaleDateString(locale, { day: "2-digit", month: "short" })} (${fieldsText(t, lc.fields)}). AI önerisi bu sonucu dikkate alır.`,
            `Last change: ${new Date(lc.published_at).toLocaleDateString(locale, { day: "2-digit", month: "short" })} (${fieldsText(t, lc.fields)}). The AI suggestion takes this result into account.`,
          )}
        </p>
      )}
      {seasonWarning && (
        <p className={`text-xs ${d.season.advice === "in_peak" ? "text-amber-700 dark:text-amber-400" : "text-[#B4553A] dark:text-[#E89A7F]"}`}>{d.season.text}</p>
      )}
    </div>
  );
}

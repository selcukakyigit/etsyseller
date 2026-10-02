"use client";

import { useEffect } from "react";
import { api, ListingDiagnosis } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";

/** Düzenleyicide "AI Önerisi Üret"in altındaki tek satırlık teşhis: öneri bu teşhise göre odaklanır. Yalnızca
 * düşüşte olan listing'lerde ya da mevsim uyarısı varken görünür; diğer durumlarda yer kaplamaz. */
export default function DiagnosisStrip({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t } = useT();
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

  if (!d) return null;
  const seasonWarning = d.season.advice === "in_peak" || d.season.advice === "prepare";
  if (d.status !== "declining" && !seasonWarning) return null;

  return (
    <div className="space-y-1.5 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      {d.status === "declining" && (
        <p className="text-neutral-800 dark:text-neutral-200">
          <span className="mr-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{d.headline}</span>
          {d.action.text}{" "}
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{t("AI önerisi bu teşhise göre odaklanır.", "The AI suggestion focuses on this diagnosis.")}</span>
        </p>
      )}
      {seasonWarning && (
        <p className={`text-xs ${d.season.advice === "in_peak" ? "text-amber-700 dark:text-amber-400" : "text-[#B4553A] dark:text-[#E89A7F]"}`}>{d.season.text}</p>
      )}
    </div>
  );
}

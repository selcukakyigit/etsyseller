"use client";

import { useEffect, useState } from "react";
import { dismissPublishJob, PublishJob } from "@/lib/publishJobs";
import { useT } from "@/lib/i18n-client";

/** Kart üzerinde arka planda süren yayının doluluk çubuğu; hata ve uyarıları da gösterir. Yüzde tahmindir (Etsy adım adım bildirmez). */
export default function PublishBar({ id, job }: { id: number; job: PublishJob }) {
  const { t } = useT();
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (job.phase !== "running") return;
    const tick = setInterval(() => {
      const s = (Date.now() - job.startedAt) / 1000;
      setPct(92 * (1 - Math.exp(-s / 8)));
    }, 150);
    return () => clearInterval(tick);
  }, [job.phase, job.startedAt]);

  if (job.phase === "error" || (job.phase === "done" && (job.warnings?.length ?? 0) > 0)) {
    const isError = job.phase === "error";
    return (
      <div
        className={`flex items-start gap-2 border-t px-3 py-2 text-xs ${
          isError ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        }`}
      >
        <div className="flex-1">
          {isError ? job.error : <>✓ {t("Yayınlandı.", "Published.")} {job.warnings?.join(" ")}</>}
        </div>
        <button type="button" onClick={() => dismissPublishJob(id)} aria-label={t("Kapat", "Close")} className="font-semibold">
          ×
        </button>
      </div>
    );
  }

  const shown = job.phase === "done" ? 100 : Math.round(pct);
  return (
    <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
      <div className="relative h-5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-[#D97757]/70 transition-[width] duration-200 ease-out" style={{ width: `${shown}%` }} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-neutral-900 dark:text-neutral-50">
          {job.phase === "done" ? t("Yayınlandı ✓", "Published ✓") : `${t("Etsy'de yayınlanıyor…", "Publishing to Etsy…")} %${shown}`}
        </span>
      </div>
    </div>
  );
}

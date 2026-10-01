"use client";

import { dismissRegenJob, RegenJob } from "@/lib/regenJobs";
import { useRegenProgress } from "@/lib/useRegenProgress";

/**
 * Sihirli değnekle yeniden oluşturulurken görseli bulanıktan berraklığa geçirir, üstünde dönen bir
 * spinner ve yüzdelik değer gösterir. Küçük kutucukta ve büyük önizlemede birebir aynı davranış için
 * tek yerde tutulur (MediaManager ikisinde de bunu kullanır).
 */
export default function RegenImage({
  src,
  alt,
  className,
  wrapperClassName = "h-full w-full",
  draggable,
  onClick,
  jobKey,
  job,
}: {
  src: string;
  alt: string;
  className: string;
  wrapperClassName?: string;
  draggable?: boolean;
  onClick?: () => void;
  jobKey: number;
  job: RegenJob | undefined;
}) {
  const pct = useRegenProgress(job);
  const running = job?.phase === "running";
  // %0'da belirgin bulanık (10px), ilerledikçe netleşir, bitince tamamen berrak.
  const blur = running ? Math.max(0, (100 - pct) / 100) * 10 : 0;

  return (
    <div className={`relative ${wrapperClassName}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={draggable}
        onClick={onClick}
        className={className}
        style={{ filter: running ? `blur(${blur}px)` : undefined, transition: "filter 0.2s linear" }}
      />
      {running && (
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[inherit] bg-black/15"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">%{Math.round(pct)}</span>
        </div>
      )}
      {job?.phase === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-[inherit] bg-red-950/85 p-2 text-center">
          <span className="text-[11px] font-medium text-red-200">{job.error ?? "Yeniden oluşturulamadı"}</span>
          <button
            type="button"
            onClick={() => dismissRegenJob(jobKey)}
            className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-neutral-900"
          >
            Kapat
          </button>
        </div>
      )}
    </div>
  );
}

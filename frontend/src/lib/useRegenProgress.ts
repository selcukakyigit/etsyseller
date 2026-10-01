"use client";

import { useEffect, useState } from "react";
import { RegenJob } from "./regenJobs";

/** publish/regen işlerinde kullanılan aynı zaman-bazlı gerçekçi ilerleme eğrisi (%92'ye asimptotik yaklaşır,
 * iş bitince çağıran %100'e tamamlar). Tek yerde tutulur ki dolum çubuğu ve bulanıklık geçişi aynı sayıyı kullansın. */
export function useRegenProgress(job: RegenJob | undefined): number {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!job || job.phase !== "running") {
      setPct(0);
      return;
    }
    const tick = setInterval(() => {
      const s = (Date.now() - job.startedAt) / 1000;
      setPct(92 * (1 - Math.exp(-s / 6)));
    }, 100);
    return () => clearInterval(tick);
  }, [job?.phase, job?.startedAt]);

  return pct;
}

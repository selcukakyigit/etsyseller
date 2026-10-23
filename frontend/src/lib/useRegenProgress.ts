"use client";

import { useEffect, useState } from "react";
import { RegenJob } from "./regenJobs";

/** publish/regen işlerinde kullanılan aynı zaman-bazlı gerçekçi ilerleme eğrisi (%92'ye asimptotik yaklaşır,
 * iş bitince çağıran %100'e tamamlar). Tek yerde tutulur ki dolum çubuğu ve bulanıklık geçişi aynı sayıyı kullansın. */
export function useRegenProgress(job: RegenJob | undefined): number {
  const [pct, setPct] = useState(0);
  const running = job?.phase === "running";
  const startedAt = job?.startedAt;

  useEffect(() => {
    if (!running || startedAt === undefined) return;
    const tick = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      setPct(92 * (1 - Math.exp(-s / 6)));
    }, 100);
    return () => {
      clearInterval(tick);
      setPct(0); // iş bitince ya da yenisi başlayınca eski değer görünmesin
    };
  }, [running, startedAt]);

  // İş çalışmıyorsa ilerleme 0'dır (durumu efektte sıfırlamak yerine türetilir).
  return running ? pct : 0;
}

"use client";

import { useEffect, useState } from "react";

/**
 * Süresi önceden bilinmeyen tek istekler (AI üretimi gibi) için tahmini ilerleme çubuğu.
 * İşlem sürerken yüzde yavaşça %92'ye yaklaşır; işlem bitince %100'e tamamlanıp kısa süre sonra kaybolur.
 * Yüzde gerçek ölçüm değil, tahmindir; aşamalar da süreye göre gösterilir.
 */
export default function ProgressBar({
  busy,
  stages,
  expectedSeconds = 20,
}: {
  busy: boolean;
  /** [eşik %, metin]: yüzde eşiği aşılınca gösterilecek aşama metni (artan sırada). */
  stages: [number, string][];
  /** Yaklaşık süre; çubuğun ne kadar hızlı ilerleyeceğini belirler. */
  expectedSeconds?: number;
}) {
  const [pct, setPct] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const tick = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setPct(92 * (1 - Math.exp(-s / (expectedSeconds / 2.5))));
      setVisible(true);
    }, 150);
    return () => {
      clearInterval(tick);
      // İşlem bitti: %100'e tamamla, kısa süre göster, sonra gizle ve sıfırla.
      setPct(100);
      setTimeout(() => {
        setVisible(false);
        setPct(0);
      }, 900);
    };
  }, [busy, expectedSeconds]);

  if (!visible) return null;
  const shown = Math.round(pct);
  const stage = [...stages].reverse().find(([from]) => pct >= from)?.[1] ?? stages[0]?.[1] ?? "";

  return (
    <div className="space-y-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
      <div className="relative h-7 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full rounded-full bg-[#F1641E]/70 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-neutral-900 dark:text-neutral-50">
          %{shown}
        </span>
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{pct >= 100 ? "Tamamlandı" : stage}</p>
    </div>
  );
}

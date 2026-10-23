"use client";

/** 12 aylık arama çizgisi. Renk yönü gösterir (artış yeşil, düşüş kırmızı, yatay nötr); veri yoksa "–". */
export default function Sparkline({ values, width = 72, height = 22, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return <span className="text-xs text-neutral-300 dark:text-neutral-600">–</span>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => `${(pad + i * step).toFixed(1)},${(height - pad - ((v - min) / span) * (height - pad * 2)).toFixed(1)}`).join(" ");
  const first = values.slice(0, 3).reduce((a, b) => a + b, 0);
  const last = values.slice(-3).reduce((a, b) => a + b, 0);
  const tone = last > first * 1.1 ? "text-green-600 dark:text-green-400" : last < first * 0.9 ? "text-red-500 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={tone} role="img" aria-label={label}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

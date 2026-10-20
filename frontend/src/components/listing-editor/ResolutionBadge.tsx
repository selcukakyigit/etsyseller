"use client";

import { tNow as t } from "@/lib/i18n";

/** Uzun kenara göre çözünürlük sınıfı (Gemini boyutlarıyla uyumlu: 1K ≈ 1024, 2K ≈ 2048, 4K ≈ 4096 px). */
export function resolutionOf(width: number, height: number): { label: string; low: boolean } {
  const long = Math.max(width, height);
  if (long >= 3500) return { label: "4K", low: false };
  if (long >= 1800) return { label: "2K", low: false };
  if (long >= 900) return { label: "1K", low: true };
  return { label: "<1K", low: true };
}

/** Fotoğraf kutucuğunda küçük çözünürlük rozeti. Etsy'nin önerdiği ≥2000 px'in altındakiler (1K ve altı) amber görünür. */
export default function ResolutionBadge({ width, height, className = "", showPixels }: { width?: number; height?: number; className?: string; showPixels?: boolean }) {
  if (!width || !height) return null;
  const { label, low } = resolutionOf(width, height);
  return (
    <span
      title={`${width}×${height} px${low ? ` — ${t("Etsy ≥2000 px önerir", "Etsy recommends ≥2000 px")}` : ""}`}
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums shadow ${low ? "bg-amber-400 text-neutral-900" : "bg-black/70 text-white"} ${className}`}
    >
      {label}
      {showPixels && <span className="ml-1.5 font-medium opacity-80">{width}×{height}</span>}
    </span>
  );
}

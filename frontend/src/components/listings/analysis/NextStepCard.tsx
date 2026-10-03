"use client";

import Link from "next/link";
import { NextStep } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

const ICON: Record<NextStep["key"], string> = {
  wait: "⏸",
  wait_data: "⏳",
  watching: "⏳",
  revert: "↩",
  keep: "✓",
  keep_working: "✓",
  keep_peak: "✓",
  title_tags: "✏️",
  description: "📝",
  photo: "🖼",
  price: "🏷",
  shop: "🏪",
  demand: "📉",
  track: "📍",
  deactivate: "⛔",
};

const TONE: Record<NextStep["key"], string> = {
  wait: "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30",
  wait_data: "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30",
  watching: "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30",
  keep: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
  keep_working: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
  keep_peak: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
  revert: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30",
  deactivate: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30",
  title_tags: "border-[#D97757]/40 bg-[#D97757]/5 dark:bg-[#D97757]/10",
  description: "border-[#D97757]/40 bg-[#D97757]/5 dark:bg-[#D97757]/10",
  photo: "border-[#D97757]/40 bg-[#D97757]/5 dark:bg-[#D97757]/10",
  price: "border-[#D97757]/40 bg-[#D97757]/5 dark:bg-[#D97757]/10",
  shop: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
  demand: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
  track: "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900",
};

/** Sıradaki adım (bkz. backend insights/next_step.py): listing için tek, somut öneri ve gerekçeleri. `compact`: düzenleyicideki
 * kısa hâl (yalnızca ilk gerekçe). Düğme hedefe götürür: düzenleyicide bölüm/AI önerisi (`onGo`/`onAi`), dışarıda düzenleyici bağlantısı. */
export default function NextStepCard({
  step,
  listingId,
  compact = false,
  onGo,
  onAi,
}: {
  step: NextStep;
  listingId: number;
  compact?: boolean;
  onGo?: (sectionId: string) => void;
  onAi?: () => void;
}) {
  const { t } = useT();
  const label =
    step.target === "ai"
      ? t("Bu adıma odaklı AI önerisi üret", "Generate an AI suggestion for this step")
      : step.target === "sec-media"
        ? t("Fotoğraflara git", "Go to photos")
        : step.target === "sec-options"
          ? t("Fiyat ve varyasyonlara git", "Go to price and variations")
          : null;
  const why = compact ? step.why.slice(0, 1) : step.why;
  const button = "rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C6613F]";

  let action: React.ReactNode = null;
  if (label && step.target) {
    if (step.target === "ai" && onAi) {
      action = <button type="button" onClick={onAi} className={button}>{label}</button>;
    } else if (step.target !== "ai" && onGo) {
      action = <button type="button" onClick={() => onGo(step.target!)} className={button}>{label}</button>;
    } else if (!onGo && !onAi) {
      const href = step.target === "ai" ? `/listings/${listingId}/edit` : `/listings/${listingId}/edit?section=${step.target}`;
      action = <Link href={href} className={`inline-block ${button}`}>{label} →</Link>;
    }
  }

  return (
    <div className={`rounded-xl border ${compact ? "px-4 py-3" : "p-4"} ${TONE[step.key]}`}>
      {!compact && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{t("Sıradaki adım", "Next step")}</p>}
      <p className={`${compact ? "" : "mt-1"} flex items-start gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100`}>
        <span aria-hidden>{ICON[step.key]}</span>
        <span>
          {compact && <span className="mr-1 font-normal text-neutral-500 dark:text-neutral-400">{t("Sıradaki adım:", "Next step:")}</span>}
          {step.text}
        </span>
      </p>
      {why.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
          {why.map((w, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-neutral-400 dark:text-neutral-500">·</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

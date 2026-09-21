"use client";

import { ReactNode } from "react";

/** Bölümün vurgu rengi: yalnızca sol şerit ve durum noktasında kullanılır (arka planı boyamaz). */
const ACCENTS = {
  orange: "border-l-orange-500",
  sky: "border-l-sky-500",
  violet: "border-l-violet-500",
  emerald: "border-l-emerald-500",
  teal: "border-l-teal-500",
  amber: "border-l-amber-500",
  slate: "border-l-slate-400",
} as const;

export type Accent = keyof typeof ACCENTS;

/**
 * Düzenleme formundaki her bölümün ortak çerçevesi: tutarlı başlık, kapalıyken tek satır özet ve
 * "dikkat" işareti. İçerik kapalıyken de DOM'da kalır (yalnızca gizlenir); böylece bileşenlerin
 * kendi durumu (varyasyon tablosu düzenlemeleri gibi) kaybolmaz.
 */
export default function SectionCard({
  id,
  title,
  summary,
  warning,
  accent,
  open,
  onToggle,
  hideInnerTitle,
  children,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  /** Doluysa başlığın yanında amber uyarı olarak gösterilir. */
  warning?: string | null;
  accent: Accent;
  open: boolean;
  onToggle: () => void;
  /** İçerikteki tek bileşenin kendi başlığı, kart başlığıyla aynıysa gizlenir. */
  hideInnerTitle?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-16 rounded-2xl border border-l-4 border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${ACCENTS[accent]}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          {summary && <p className="mt-0.5 truncate text-sm text-neutral-500 dark:text-neutral-400">{summary}</p>}
        </div>
        {warning && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            {warning}
          </span>
        )}
        <span aria-hidden className={`shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      <div
        id={`${id}-body`}
        hidden={!open}
        className={`space-y-8 border-t border-neutral-100 px-5 py-5 dark:border-neutral-800 ${hideInnerTitle ? "[&>section>h2:first-child]:hidden" : ""} [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0 [&>section]:shadow-none dark:[&>section]:bg-transparent`}
      >
        {children}
      </div>
    </section>
  );
}

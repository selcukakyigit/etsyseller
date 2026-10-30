"use client";

import type { ReactNode } from "react";
import HelpTip from "@/components/ui/HelpTip";

/** Keşfet ana ekranının kart çerçevesi: başlık, "?" ipucu ve sağda isteğe bağlı bir eylem. */
export function Card({ title, help, action, children, className = "" }: { title: ReactNode; help?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none ${className}`}>
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {help && <HelpTip>{help}</HelpTip>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** 18 100 -> "18,1 B" / "18.1K" (arayüz diline göre). */
export const compact = (n: number, locale: string) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);

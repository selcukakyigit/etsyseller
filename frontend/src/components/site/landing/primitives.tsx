import { ReactNode } from "react";
import { display } from "@/components/site/fonts";

// Tanıtım sayfalarının ortak görsel parçaları (kart, başlıklar, düğme stilleri, simgeler). Bölümler (sections.tsx, PricingSection.tsx) bunları kullanır.

export const card = "rounded-3xl border border-black/[0.07] bg-white dark:border-white/10 dark:bg-[#171513]";
export const h2Class = `${display.className} text-4xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 md:text-5xl`;
export const h3 = `${display.className} text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50`;
export const muted = "leading-relaxed text-neutral-600 dark:text-neutral-300";
export const primary =
  "inline-flex items-center gap-2 rounded-full bg-[#D97757] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(217,119,87,0.8)] transition hover:bg-[#C6613F]";
export const secondary =
  "inline-flex items-center rounded-full border border-black/15 bg-white/60 px-6 py-3.5 text-sm font-semibold text-neutral-800 transition hover:bg-white dark:border-white/20 dark:bg-white/5 dark:text-neutral-100 dark:hover:bg-white/10";

export function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${onDark ? "text-[#F2A68A]" : "text-[#A9502F] dark:text-[#F48771]"}`}>
      {children}
    </p>
  );
}

export function Heading({ standalone, className = "", children }: { standalone?: boolean; className?: string; children: ReactNode }) {
  return standalone ? (
    <h1 className={`${h2Class} md:text-6xl ${className}`}>{children}</h1>
  ) : (
    <h2 className={`${h2Class} ${className}`}>{children}</h2>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="M5 10.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Arrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

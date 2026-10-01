import Link from "next/link";
import { ReactNode } from "react";
import { BRAND, ETSY_DISCLAIMER, LEGAL_LINKS, LEGAL_UPDATED } from "@/lib/legal";

export function LegalFooter() {
  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800 mt-16">
      <div className="mx-auto max-w-3xl px-6 py-8 text-xs text-neutral-500 dark:text-neutral-400 space-y-3">
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          {LEGAL_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-neutral-800 dark:hover:text-neutral-200">
              {l.label}
            </Link>
          ))}
        </nav>
        <p>{ETSY_DISCLAIMER}</p>
        <p>© {new Date().getFullYear()} {BRAND}</p>
      </div>
    </footer>
  );
}

export default function LegalLayout({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="flex-1 bg-white dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold text-neutral-900 dark:text-neutral-100">
            {BRAND}
          </Link>
          <Link href="/login" className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            Giriş yap
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{title}</h1>
        <p className="mt-1 text-xs text-neutral-400">Son güncelleme: {LEGAL_UPDATED}</p>
        {intro && <p className="mt-4 text-sm leading-relaxed">{intro}</p>}
        <div className="mt-6">{children}</div>
      </main>
      <LegalFooter />
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">{children}</h2>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">{children}</ul>;
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs border border-neutral-200 dark:border-neutral-800">
        <thead className="bg-neutral-50 dark:bg-neutral-900">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium border-b border-neutral-200 dark:border-neutral-800">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

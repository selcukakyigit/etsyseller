import { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { Lang } from "@/lib/i18n";
import { LEGAL_UPDATED } from "@/lib/legal";

export default function LegalLayout({
  lang,
  title,
  intro,
  children,
}: {
  lang: Lang;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 bg-[#FBF9F6] text-neutral-800 dark:bg-[#0E0D0C] dark:text-neutral-200">
      <SiteHeader lang={lang} />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">{title}</h1>
        <p className="mt-1 text-xs text-neutral-400">
          {lang === "tr" ? "Son güncelleme" : "Last updated"}: {LEGAL_UPDATED[lang]}
        </p>
        {intro && <p className="mt-4 text-sm leading-relaxed">{intro}</p>}
        <div className="mt-6">{children}</div>
      </main>
      <SiteFooter lang={lang} />
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

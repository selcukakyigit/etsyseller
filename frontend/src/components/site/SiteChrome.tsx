import Link from "next/link";
import Logo from "@/components/Logo";
import LangSwitch from "@/components/LangSwitch";
import HeaderAuth from "@/components/site/HeaderAuth";
import { Lang } from "@/lib/i18n";
import { BRAND, ETSY_DISCLAIMER, LEGAL_LINKS } from "@/lib/legal";

const NAV = {
  en: [
    { href: "/#features", label: "What it does" },
    { href: "/#how", label: "How it works" },
    { href: "/#data", label: "Your data" },
  ],
  tr: [
    { href: "/#features", label: "Neler yapar" },
    { href: "/#how", label: "Nasıl çalışır" },
    { href: "/#data", label: "Verilerin" },
  ],
};

export function Wordmark({ height = 26 }: { height?: number }) {
  return (
    <Link href="/" aria-label={BRAND} className="flex items-center">
      <Logo height={height} />
    </Link>
  );
}

export function SiteHeader({ lang }: { lang: Lang }) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/5 bg-[#FBF9F6]/90 backdrop-blur dark:border-white/10 dark:bg-[#0E0D0C]/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
        <div className="flex items-center gap-10">
          <Wordmark />
          <nav className="hidden items-center gap-6 text-sm text-neutral-600 dark:text-neutral-300 md:flex">
            {NAV[lang].map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-neutral-900 dark:hover:text-white">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 sm:gap-5">
          <LangSwitch />
          <HeaderAuth lang={lang} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ lang }: { lang: Lang }) {
  return (
    <footer className="border-t border-black/5 dark:border-white/10">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-sm space-y-3">
            <Wordmark />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {lang === "tr"
                ? "Etsy satıcıları için ilan, sipariş ve kâr takibi."
                : "Listings, orders and profit tracking for Etsy sellers."}
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm text-neutral-600 dark:text-neutral-300">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-neutral-900 dark:hover:text-white">
                {l.label[lang]}
              </Link>
            ))}
          </nav>
        </div>
        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">{ETSY_DISCLAIMER}</p>
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">© {new Date().getFullYear()} {BRAND}</p>
      </div>
    </footer>
  );
}

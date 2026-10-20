import Link from "next/link";
import Logo from "@/components/Logo";
import LangSwitch from "@/components/LangSwitch";
import HeaderAuth from "@/components/site/HeaderAuth";
import { Lang } from "@/lib/i18n";
import { BRAND, ETSY_DISCLAIMER, LEGAL_LINKS } from "@/lib/legal";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Tanıtım sekmeleri; `key` sayfanın etkin sekme işaretiyle (SiteHeader `active`) eşleşir. */
const NAV: { key: "pricing" | "features" | "how" | "data" | "faq"; href: string; label: Record<Lang, string> }[] = [
  { key: "pricing", href: "/pricing", label: { en: "Pricing", tr: "Fiyatlar" } },
  { key: "features", href: "/features", label: { en: "What it does", tr: "Neler yapar" } },
  { key: "how", href: "/how-it-works", label: { en: "How it works", tr: "Nasıl çalışır" } },
  { key: "data", href: "/your-data", label: { en: "Your data", tr: "Verilerin" } },
  { key: "faq", href: "/faq", label: { en: "FAQ", tr: "SSS" } },
];

// Alt bilgideki sosyal medya hesapları. Adresler Yönetim > Landing'den gelir; boş olan gösterilmez.
type SocialKey = "instagram" | "youtube" | "linkedin" | "pinterest";

// Renkli marka simgeleri: markanın kendi renginde kare, üstünde beyaz işaret.
const SOCIAL: { key: SocialKey; label: string; icon: React.ReactNode }[] = [
  {
    key: "instagram",
    label: "Instagram",
    icon: (
      <>
        <defs>
          <radialGradient id="ulagg-ig" cx="0.3" cy="1.07" r="1.5">
            <stop offset="0" stopColor="#FDF497" />
            <stop offset="0.05" stopColor="#FDF497" />
            <stop offset="0.45" stopColor="#FD5949" />
            <stop offset="0.6" stopColor="#D6249F" />
            <stop offset="0.9" stopColor="#285AEB" />
          </radialGradient>
        </defs>
        <rect width="24" height="24" rx="6" fill="url(#ulagg-ig)" />
        <rect x="5.5" y="5.5" width="13" height="13" rx="4" stroke="#fff" strokeWidth="1.8" fill="none" />
        <circle cx="12" cy="12" r="3.1" stroke="#fff" strokeWidth="1.8" fill="none" />
        <circle cx="16.1" cy="7.9" r="1" fill="#fff" />
      </>
    ),
  },
  {
    key: "youtube",
    label: "YouTube",
    icon: (
      <>
        <rect width="24" height="24" rx="6" fill="#FF0000" />
        <path d="M9.6 7.6v8.8l7-4.4z" fill="#fff" />
      </>
    ),
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    icon: (
      <>
        <rect width="24" height="24" rx="6" fill="#0A66C2" />
        <circle cx="7.4" cy="7.3" r="1.5" fill="#fff" />
        <rect x="6.1" y="9.8" width="2.6" height="8.2" fill="#fff" />
        <path d="M11.4 18V9.8M11.4 13.4c0-2.1 1.2-3.6 3.1-3.6 1.8 0 2.9 1.2 2.9 3.4V18" stroke="#fff" strokeWidth="2.5" fill="none" />
      </>
    ),
  },
  {
    key: "pinterest",
    label: "Pinterest",
    icon: (
      <>
        <rect width="24" height="24" rx="6" fill="#E60023" />
        <path
          d="M11.1 13.9 9.4 20M9.5 12.6c-.4-.6-.6-1.4-.6-2.1 0-2.4 1.9-4.2 4.2-4.2 2.3 0 3.8 1.6 3.8 3.6 0 2.5-1.3 4.5-3.1 4.5-1 0-1.8-.8-1.6-1.9l.8-2.7"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </>
    ),
  },
];

/** Yönetimde girilen sosyal medya adresleri. Backend'e ulaşılamazsa boş döner (alt bilgi simgesiz çizilir, sayfa düşmez). */
async function loadSocial(): Promise<Partial<Record<SocialKey, string>>> {
  try {
    const res = await fetch(`${API_URL}/api/site/landing`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return {};
    const data: { social?: Partial<Record<SocialKey, string>> } = await res.json();
    return data.social ?? {};
  } catch {
    return {};
  }
}

export function Wordmark({ height = 26 }: { height?: number }) {
  return (
    <Link href="/" aria-label={BRAND} className="flex items-center">
      <Logo height={height} />
    </Link>
  );
}

export function SiteHeader({ lang, active }: { lang: Lang; active?: (typeof NAV)[number]["key"] }) {
  const link = (key: string) =>
    key === active
      ? "font-semibold text-neutral-900 dark:text-white"
      : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white";
  return (
    <header className="sticky top-0 z-40 border-b border-black/5 bg-[#FBF9F6]/90 backdrop-blur dark:border-white/10 dark:bg-[#0E0D0C]/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
        <div className="flex items-center gap-10">
          <Wordmark />
          <nav className="hidden items-center gap-1 text-sm md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={n.key === active ? "page" : undefined}
                className={`relative rounded-full px-3 py-1.5 transition ${link(n.key)} ${n.key === active ? "bg-black/[0.05] dark:bg-white/10" : ""}`}
              >
                {n.label[lang]}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 sm:gap-5">
          <LangSwitch />
          <HeaderAuth lang={lang} />
        </div>
      </div>
      {/* Telefonda sekmeler başlığın altında, yatay kaydırılabilir bir satırda. */}
      <nav className="flex flex-wrap justify-center gap-x-0.5 px-2 pb-2 text-[13px] md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={n.key === active ? "page" : undefined}
            className={`rounded-full px-2.5 py-1.5 ${link(n.key)} ${n.key === active ? "bg-black/[0.06] dark:bg-white/10" : ""}`}
          >
            {n.label[lang]}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export async function SiteFooter({ lang }: { lang: Lang }) {
  const urls = await loadSocial();
  const social = SOCIAL.flatMap((s) => (urls[s.key]?.startsWith("https://") ? [{ ...s, href: urls[s.key]! }] : []));
  return (
    <footer className="border-t border-black/5 dark:border-white/10">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center sm:items-start sm:text-left">
            <Wordmark />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {lang === "tr"
                ? "Etsy satıcıları için ilan, sipariş ve kâr takibi."
                : "Listings, orders and profit tracking for Etsy sellers."}
            </p>
          </div>
          {/* Telefonda (sm altı) iki liste alt alta, bağlantılar yan yana akar; sm ve üstünde eski iki sütun düzeni. */}
          <div className="grid grid-cols-1 justify-items-center gap-7 sm:justify-items-stretch sm:grid-cols-[auto_auto] sm:gap-10">
            <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2.5 text-sm sm:justify-start sm:flex-col sm:gap-2">
              <p className="mb-0 w-full text-center text-xs font-semibold sm:text-left uppercase tracking-wider text-neutral-400 sm:mb-1 sm:w-auto dark:text-neutral-500">
                {lang === "tr" ? "Ürün" : "Product"}
              </p>
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white">
                  {n.label[lang]}
                </Link>
              ))}
            </nav>
            <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs sm:justify-start sm:flex-col sm:gap-2 sm:text-sm">
              <p className="mb-0 w-full text-center text-xs font-semibold sm:text-left uppercase tracking-wider text-neutral-400 sm:mb-1 sm:w-auto dark:text-neutral-500">
                {lang === "tr" ? "Yasal" : "Legal"}
              </p>
              {LEGAL_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="text-neutral-500 hover:text-neutral-900 sm:text-neutral-600 dark:text-neutral-400 dark:hover:text-white dark:sm:text-neutral-300">
                  {l.label[lang]}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-xs leading-relaxed text-neutral-500 sm:mx-0 sm:mt-10 sm:text-left sm:text-sm sm:text-neutral-600 dark:text-neutral-400 dark:sm:text-neutral-300">{ETSY_DISCLAIMER}</p>
        <div className="mt-6 flex flex-col-reverse items-center gap-4 border-t border-black/5 pt-6 sm:flex-row sm:justify-between dark:border-white/10">
          <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">© {new Date().getFullYear()} {BRAND}</p>
          {social.length > 0 && (
            <ul className="flex items-center gap-3">
              {social.map((s) => (
                <li key={s.key}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    title={s.label}
                    className="block rounded-[10px] shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md dark:ring-white/10"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden className="block h-9 w-9">
                      {s.icon}
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </footer>
  );
}

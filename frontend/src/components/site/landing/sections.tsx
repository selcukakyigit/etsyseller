import Image from "next/image";
import Link from "next/link";
import { ReactNode } from "react";
import ProductMock from "@/components/site/ProductMock";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { display, sans } from "@/components/site/fonts";
import { Lang } from "@/lib/i18n";
import { PriceList } from "@/lib/pricing";
import { ETSY_DISCLAIMER } from "@/lib/legal";
import { LandingCopy } from "./copy";

// Tanıtım sayfalarının bölümleri. Ana sayfa ve her sekme sayfası (/features, /how-it-works, /your-data, /faq) bunları dizer.
// `standalone`: bölüm kendi sayfasında tek başına duruyorsa başlığı h1 olur ve üstten daha çok boşluk alır.
// Görseller public/landing altında; Gemini görsel modeliyle üretildi (ürün/marka/yazı içermez).

const card = "rounded-3xl border border-black/[0.07] bg-white dark:border-white/10 dark:bg-[#171513]";
const h2Class = `${display.className} text-4xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 md:text-5xl`;
const h3 = `${display.className} text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50`;
const muted = "leading-relaxed text-neutral-600 dark:text-neutral-300";
const primary =
  "inline-flex items-center gap-2 rounded-full bg-[#D97757] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(217,119,87,0.8)] transition hover:bg-[#C6613F]";
const secondary =
  "inline-flex items-center rounded-full border border-black/15 bg-white/60 px-6 py-3.5 text-sm font-semibold text-neutral-800 transition hover:bg-white dark:border-white/20 dark:bg-white/5 dark:text-neutral-100 dark:hover:bg-white/10";

export type NavKey = "pricing" | "features" | "how" | "data" | "faq";

/** Tanıtım sayfalarının ortak iskeleti: yazı tipi, üst menü (etkin sekme işaretli), içerik, kapanış çağrısı, alt bilgi. */
export function SitePage({ lang, c, active, children }: { lang: Lang; c: LandingCopy; active?: NavKey; children: ReactNode }) {
  return (
    <div className={`${sans.className} flex-1 overflow-x-clip bg-[#FBF9F6] text-neutral-800 dark:bg-[#0E0D0C] dark:text-neutral-200`}>
      <SiteHeader lang={lang} active={active} />
      <main>
        {children}
        <Closing c={c} />
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}

function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${onDark ? "text-[#F2A68A]" : "text-[#A9502F] dark:text-[#F48771]"}`}>
      {children}
    </p>
  );
}

function Heading({ standalone, className = "", children }: { standalone?: boolean; className?: string; children: ReactNode }) {
  return standalone ? (
    <h1 className={`${h2Class} md:text-6xl ${className}`}>{children}</h1>
  ) : (
    <h2 className={`${h2Class} ${className}`}>{children}</h2>
  );
}

function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="M5 10.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// "Verilerin" bölümündeki dört ilkenin simgeleri, sırasıyla.
const DATA_ICONS = [
  "M9 12l2 2 4-4M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z",
  "M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z",
  "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  "M4 4l16 16M10.6 6.1A9 9 0 0121 12a9.6 9.6 0 01-2.2 3.2M6.2 7.6A9.7 9.7 0 003 12a9 9 0 0012.5 5.3",
];

// "Ve dahası" listesinin simgeleri, sırasıyla.
const MORE_ICONS = [
  "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  "M3 6h18v12H3zM3 14l5-4 4 3 3-2 6 4",
  "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4",
  "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z",
  "M4 5h16v11H9l-5 4z",
];

// Ana sayfadaki sekme özet kartlarının simgeleri: Neler yapar, Nasıl çalışır, Verilerin, SSS.
const HIGHLIGHT_ICONS = [
  "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
  "M5 12h14M13 6l6 6-6 6",
  DATA_ICONS[0],
  "M9.5 9a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01M12 3a9 9 0 110 18 9 9 0 010-18z",
];

export function Hero({ lang, c }: { lang: Lang; c: LandingCopy }) {
  return (
    <section className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(60%_60%_at_80%_10%,rgba(217,119,87,0.18),transparent_70%)] dark:bg-[radial-gradient(60%_60%_at_80%_10%,rgba(217,119,87,0.14),transparent_70%)]"
      />
      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-4 pb-20 pt-14 sm:px-6 md:pt-20 lg:grid-cols-[1fr_1fr]">
        <div className="min-w-0">
          <Eyebrow>{c.eyebrow}</Eyebrow>
          <h1 className={`${display.className} mt-5 text-[2.6rem] font-semibold leading-[1.04] tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-[3.4rem]`}>
            {c.h1a} <span className="text-[#D97757]">{c.h1b}</span> {c.h1c}
          </h1>
          <p className={`mt-6 max-w-xl text-lg ${muted}`}>{c.sub}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login?mode=register" className={primary}>
              {c.cta}
              <Arrow />
            </Link>
            <Link href="/how-it-works" className={secondary}>
              {c.cta2}
            </Link>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-600 dark:text-neutral-300">
            {c.trust.map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-[#D97757]" />
                {t}
              </li>
            ))}
          </ul>
          {/* Etsy API Terms: bu cümle "belirgin bir yerde" olmalı (Commercial Access şartı); yalnızca footer'da kalmasın. */}
          <p className="mt-7 max-w-xl border-l-2 border-neutral-300 pl-3 text-xs leading-relaxed text-neutral-600 dark:border-neutral-600 dark:text-neutral-300">
            {ETSY_DISCLAIMER}
          </p>
        </div>

        <div className="relative min-w-0">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] shadow-[0_40px_80px_-40px_rgba(31,27,22,0.5)] ring-1 ring-black/5 dark:ring-white/10">
            <Image src="/landing/hero.webp" alt="" fill priority sizes="(min-width: 1024px) 560px, 100vw" className="object-cover" />
            <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-neutral-900 backdrop-blur dark:bg-[#171513]/90 dark:text-neutral-100">
              {c.heroChip}
            </span>
          </div>
          <div className="relative z-10 -mt-24 flex justify-center px-2 sm:-mt-28 lg:-ml-8 lg:justify-start lg:px-0">
            <ProductMock lang={lang} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function Problem({ c }: { c: LandingCopy }) {
  return (
    <section className="border-y border-black/5 bg-[#F3EEE7] dark:border-white/10 dark:bg-[#151311]">
      <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
        <p className={`${display.className} text-3xl font-semibold leading-tight tracking-tight text-neutral-500 dark:text-neutral-400 md:text-5xl`}>
          {c.problemA}
          <br />
          <span className="text-neutral-900 dark:text-neutral-50">{c.problemB}</span>
        </p>
        <p className={`mx-auto mt-6 max-w-2xl text-lg ${muted}`}>{c.problemSub}</p>
      </div>
    </section>
  );
}

/** Ana sayfada her sekmeye giden dört özet kartı. */
export function Highlights({ c }: { c: LandingCopy }) {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 pb-4 pt-24 sm:px-6">
        <div className="max-w-2xl">
          <Eyebrow>{c.highlightsEyebrow}</Eyebrow>
          <h2 className={`${h2Class} mt-4`}>{c.highlightsTitle}</h2>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {c.highlights.map(([href, title, text], i) => (
            <Link
              key={href}
              href={href}
              className={`${card} group flex flex-col p-6 transition hover:-translate-y-0.5 hover:border-[#D97757]/40 hover:shadow-[0_20px_40px_-24px_rgba(31,27,22,0.35)] dark:hover:border-[#D97757]/40`}
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#FBF1EA] text-[#C6613F] dark:bg-[#2A1D15] dark:text-[#F48771]">
                <Icon d={HIGHLIGHT_ICONS[i]} className="h-5 w-5" />
              </span>
              <h3 className={`${h3} mt-5`}>{title}</h3>
              <p className={`mt-2 flex-1 text-sm ${muted}`}>{text}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#A9502F] dark:text-[#F48771]">
                {c.moreLink}
                <Arrow className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Fiyatlandırma: kredi paketleri (kartlar) ve "neye kaç kredi" listesi. Paket yoksa hediye krediyle başlamaya çağırır; paketler açılınca kendiliğinden dolar. */
export function Pricing({ lang, c, pricing, standalone }: { lang: Lang; c: LandingCopy; pricing: PriceList; standalone?: boolean }) {
  const p = c.pricing;
  const money = (cents: number, currency: string) => {
    try {
      return (cents / 100).toLocaleString(lang === "tr" ? "tr-TR" : "en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  };
  const number = (n: number) => n.toLocaleString(lang === "tr" ? "tr-TR" : "en-US");
  const featured = pricing.packs.length >= 3 ? Math.floor(pricing.packs.length / 2) : -1;
  const groups = (["text", "image", "video"] as const).map((kind) => ({ kind, items: pricing.actions.filter((a) => a.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <section id="pricing">
      <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${standalone ? "pb-4 pt-16 md:pt-20" : "py-24"}`}>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>{p.eyebrow}</Eyebrow>
          <Heading standalone={standalone} className="mt-4">
            {p.title}
          </Heading>
          <p className={`mt-5 ${muted}`}>{p.sub}</p>
        </div>

        {pricing.welcome_credits > 0 && (
          <div className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-1 rounded-2xl border border-[#D97757]/30 bg-[#FBF1EA] px-6 py-5 text-center dark:border-[#D97757]/30 dark:bg-[#2A1D15]">
            <p className={`${display.className} text-xl font-semibold text-neutral-900 dark:text-neutral-50`}>{p.welcome(pricing.welcome_credits)}</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{p.welcomeSub}</p>
          </div>
        )}

        {pricing.packs.length > 0 ? (
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pricing.packs.map((pack, i) => (
              <div
                key={pack.id}
                className={`${card} relative flex flex-col p-7 ${i === featured ? "border-[#D97757] shadow-[0_20px_50px_-28px_rgba(217,119,87,0.7)] dark:border-[#D97757]" : ""}`}
              >
                {pack.discount_pct > 0 && (
                  <span className="absolute right-5 top-5 rounded-full bg-[#D97757] px-2.5 py-1 text-[11px] font-semibold text-white">{p.bonus(pack.discount_pct)}</span>
                )}
                <p className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">{lang === "tr" ? pack.name_tr : pack.name_en}</p>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className={`${display.className} text-5xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50`}>{money(pack.price_cents, pack.currency)}</span>
                  {pack.discount_pct > 0 && <span className="text-base text-neutral-400 line-through dark:text-neutral-500">{money(pack.list_price_cents, pack.currency)}</span>}
                </p>
                <p className="mt-2 text-lg font-semibold text-[#A9502F] dark:text-[#F48771]">
                  {number(pack.credits)} {p.credits}
                </p>
                <ul className={`mt-6 flex-1 space-y-2.5 text-sm ${muted}`}>
                  {p.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#D97757]" />
                      {perk}
                    </li>
                  ))}
                </ul>
                <Link href="/login?mode=register" className={`${i === featured ? primary : secondary} mt-7 justify-center`}>
                  {p.buy}
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className={`${card} mx-auto mt-10 max-w-2xl p-8 text-center`}>
            <p className={h3}>{p.soonTitle}</p>
            <p className={`mx-auto mt-2 max-w-md text-sm ${muted}`}>{p.soonText}</p>
            <Link href="/login?mode=register" className={`${primary} mt-6`}>
              {p.buy}
              <Arrow />
            </Link>
          </div>
        )}

        {pricing.packs.length > 0 && <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-neutral-600 dark:text-neutral-300">{p.custom}</p>}
        <p className="mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          {p.taxNote}{" "}
          <Link href="/terms" className="underline">{p.termsLink}</Link> · <Link href="/refunds" className="underline">{p.refundLink}</Link>
        </p>

        {groups.length > 0 && (
          <div className="mt-16">
            <h3 className={`${h3} text-center`}>{p.priceListTitle}</h3>
            <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
              {groups.map((g) => (
                <div key={g.kind} className={`${card} p-6`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">{p.groups[g.kind]}</p>
                  <ul className="mt-4 divide-y divide-black/5 dark:divide-white/10">
                    {g.items.map((a) => (
                      <li key={a.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="text-neutral-700 dark:text-neutral-200">{lang === "tr" ? a.label_tr : a.label_en}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
                          {number(a.credits)} {p.credits}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-5 text-center text-xs text-neutral-500 dark:text-neutral-400">{p.priceListNote}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function Features({ c, standalone }: { c: LandingCopy; standalone?: boolean }) {
  // Kâr dökümü çubukları: satışa göre oran (6940 = %100). İlan hunisi: görüntülenmeye göre çubuk genişliği.
  const profitBars = [100, 16.3, 5.9, 43];
  const funnel = [100, 38, 12];
  return (
    <section>
      <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${standalone ? "pb-4 pt-16 md:pt-20" : "py-24"}`}>
        <div className="max-w-2xl">
          <Eyebrow>{c.featuresEyebrow}</Eyebrow>
          <Heading standalone={standalone} className="mt-4">
            {c.featuresTitle}
          </Heading>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Kâr */}
          <article className={`${card} grid gap-8 p-7 md:grid-cols-2 lg:col-span-2`}>
            <div>
              <h3 className={h3}>{c.profit.title}</h3>
              <p className={`mt-3 ${muted}`}>{c.profit.text}</p>
            </div>
            <div aria-hidden className="rounded-2xl bg-[#FBF9F6] p-5 dark:bg-[#0E0D0C]">
              <ul className="space-y-3 text-sm">
                {c.profit.rows.map(([k, v], i) => (
                  <li key={k}>
                    <div className="flex justify-between">
                      <span className="text-neutral-600 dark:text-neutral-300">{k}</span>
                      <span className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{v}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-black/5 dark:bg-white/10">
                      <div
                        className={`h-full rounded-full ${i === 0 ? "bg-neutral-800 dark:bg-neutral-200" : "bg-neutral-300 dark:bg-neutral-600"}`}
                        style={{ width: `${profitBars[i]}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-baseline justify-between border-t border-black/10 pt-4 dark:border-white/10">
                <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{c.profit.net}</span>
                <span className={`${display.className} text-3xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400`}>$2,419</span>
              </div>
            </div>
          </article>

          {/* Yapay zekâyla fotoğraf */}
          <article className={`${card} flex flex-col p-7 lg:row-span-2`}>
            <h3 className={h3}>{c.ai.title}</h3>
            <p className={`mt-3 ${muted}`}>{c.ai.text}</p>
            <div aria-hidden className="mt-6 grid flex-1 grid-cols-2 gap-2 lg:grid-cols-1">
              {(
                [
                  ["/landing/before.webp", c.ai.before, false],
                  ["/landing/after.webp", c.ai.after, true],
                ] as const
              ).map(([src, label, isAfter]) => (
                <div key={src} className="relative min-h-40 overflow-hidden rounded-2xl">
                  <Image src={src} alt="" fill sizes="(min-width: 1024px) 340px, 50vw" className="object-cover" />
                  <span
                    className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white ${isAfter ? "bg-[#D97757]" : "bg-black/60"}`}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </article>

          {/* İlan sağlığı */}
          <article className={`${card} p-7`}>
            <h3 className={h3}>{c.health.title}</h3>
            <p className={`mt-3 ${muted}`}>{c.health.text}</p>
            <div aria-hidden className="mt-6 space-y-2">
              {c.health.steps.map(([k, v], i) => (
                <div key={k} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-neutral-600 dark:text-neutral-300">{k}</span>
                  <div className="h-7 flex-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.06]">
                    <div
                      className={`flex h-full items-center justify-end rounded-lg px-2 text-xs font-semibold tabular-nums ${
                        i === 1 ? "bg-[#D97757] text-white" : "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100"
                      }`}
                      style={{ width: `${Math.max(funnel[i], 18)}%` }}
                    >
                      {v}
                    </div>
                  </div>
                </div>
              ))}
              <p className="pt-2 text-xs font-semibold text-[#A9502F] dark:text-[#F48771]">↳ {c.health.flag}</p>
            </div>
          </article>

          {/* Taslak */}
          <article className={`${card} p-7`}>
            <h3 className={h3}>{c.draft.title}</h3>
            <p className={`mt-3 ${muted}`}>{c.draft.text}</p>
            <div aria-hidden className="mt-6 space-y-2 rounded-2xl bg-[#FBF9F6] p-4 text-sm dark:bg-[#0E0D0C]">
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800 line-through decoration-rose-400 dark:bg-rose-950/40 dark:text-rose-300">
                {c.draft.oldTitle}
              </p>
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{c.draft.newTitle}</p>
              <p className="flex items-center gap-1.5 pt-1 text-xs text-neutral-500 dark:text-neutral-400">
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                {c.draft.version}
              </p>
            </div>
          </article>

          {/* Sipariş ve kargo */}
          <article className={`${card} grid overflow-hidden md:grid-cols-2 lg:col-span-2`}>
            <div className="relative min-h-56">
              <Image src="/landing/packing.webp" alt="" fill sizes="(min-width: 1024px) 400px, 100vw" className="object-cover" />
              <span className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-neutral-900 shadow dark:bg-[#171513]/95 dark:text-neutral-100">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {c.orders.chip}
              </span>
            </div>
            <div className="p-7">
              <h3 className={h3}>{c.orders.title}</h3>
              <p className={`mt-3 ${muted}`}>{c.orders.text}</p>
              <ul aria-hidden className="mt-6 divide-y divide-black/5 rounded-2xl bg-[#FBF9F6] px-4 text-sm dark:divide-white/10 dark:bg-[#0E0D0C]">
                {c.orders.list.map(([item, status], i) => (
                  <li key={item} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="truncate text-neutral-800 dark:text-neutral-200">{item}</span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        i === 0
                          ? "bg-[#FBF1EA] text-[#A9502F] dark:bg-[#2A1D15] dark:text-[#F48771]"
                          : i === 2
                            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-black/5 text-neutral-700 dark:bg-white/10 dark:text-neutral-300"
                      }`}
                    >
                      {status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </article>

          {/* Ve dahası */}
          <article className={`${card} p-7`}>
            <h3 className={h3}>{c.moreTitle}</h3>
            <ul className="mt-5 space-y-4">
              {c.more.map(([title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FBF1EA] text-[#C6613F] dark:bg-[#2A1D15] dark:text-[#F48771]">
                    <Icon d={MORE_ICONS[i]} className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
                    <p className="text-sm text-neutral-600 dark:text-neutral-300">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

export function How({ c, standalone }: { c: LandingCopy; standalone?: boolean }) {
  return (
    <section className="bg-[#F3EEE7] dark:bg-[#151311]">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="relative order-2 aspect-[4/5] overflow-hidden rounded-[2rem] ring-1 ring-black/5 dark:ring-white/10 lg:order-1">
          <Image src="/landing/maker.webp" alt="" fill priority={standalone} sizes="(min-width: 1024px) 480px, 100vw" className="object-cover" />
        </div>
        <div className="order-1 lg:order-2">
          <Eyebrow>{c.howEyebrow}</Eyebrow>
          <Heading standalone={standalone} className="mt-4">
            {c.howTitle}
          </Heading>
          <ol className="relative mt-12 space-y-10 before:absolute before:bottom-6 before:left-[1.375rem] before:top-6 before:w-px before:bg-black/15 dark:before:bg-white/15">
            {c.steps.map(([title, text, tag], i) => (
              <li key={title} className="relative flex gap-5">
                <span
                  className={`${display.className} relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#D97757] text-lg font-semibold text-white ring-8 ring-[#F3EEE7] dark:ring-[#151311]`}
                >
                  {i + 1}
                </span>
                <div className="pt-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className={h3}>{title}</h3>
                    <span className="rounded-full border border-black/10 bg-white px-2.5 py-0.5 text-xs font-medium text-neutral-600 dark:border-white/15 dark:bg-white/5 dark:text-neutral-300">
                      {tag}
                    </span>
                  </div>
                  <p className={`mt-2 ${muted}`}>{text}</p>
                </div>
              </li>
            ))}
          </ol>
          {standalone && (
            <Link href="/login?mode=register" className={`${primary} mt-12`}>
              {c.cta}
              <Arrow />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

export function Data({ c, standalone }: { c: LandingCopy; standalone?: boolean }) {
  return (
    <section className="bg-[#1F1B16] text-neutral-200 dark:bg-[#0A0908]">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <Eyebrow onDark>{c.dataEyebrow}</Eyebrow>
          {standalone ? (
            <h1 className={`${display.className} mt-4 text-4xl font-semibold tracking-tight text-white md:text-6xl`}>{c.dataTitle}</h1>
          ) : (
            <h2 className={`${display.className} mt-4 text-4xl font-semibold tracking-tight text-white md:text-5xl`}>{c.dataTitle}</h2>
          )}
          <p className="mt-5 max-w-sm leading-relaxed text-neutral-300">{c.dataLead}</p>
          <Link href="/privacy" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
            {c.dataLink}
          </Link>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {c.data.map(([title, text], i) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#D97757]/15 text-[#F2A68A]">
                <Icon d={DATA_ICONS[i]} className="h-5 w-5" />
              </span>
              <dt className="mt-4 font-semibold text-white">{title}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-neutral-300">{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function Faq({ c, standalone }: { c: LandingCopy; standalone?: boolean }) {
  return (
    <section>
      <div className={`mx-auto max-w-3xl px-4 sm:px-6 ${standalone ? "pb-4 pt-16 md:pt-20" : "py-24"}`}>
        <div className="text-center">
          <Eyebrow>{c.faqEyebrow}</Eyebrow>
          <Heading standalone={standalone} className="mt-4">
            {c.faqTitle}
          </Heading>
          <p className={`mx-auto mt-5 max-w-xl ${muted}`}>{c.faqLead}</p>
        </div>
        <div className="mt-12 divide-y divide-black/10 border-y border-black/10 dark:divide-white/10 dark:border-white/10">
          {c.faq.map(([q, a], i) => (
            <details key={q} open={standalone && i === 0} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold text-neutral-900 dark:text-neutral-100 [&::-webkit-details-marker]:hidden">
                {q}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-black/15 text-neutral-600 transition group-open:rotate-45 dark:border-white/20 dark:text-neutral-300">
                  +
                </span>
              </summary>
              <p className={`mt-3 pr-10 ${muted}`}>{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-neutral-600 dark:text-neutral-300">
          {c.faqMore}{" "}
          <Link href="/contact" className="font-semibold text-neutral-900 underline underline-offset-4 dark:text-neutral-100">
            {c.faqContact}
          </Link>
        </p>
      </div>
    </section>
  );
}

function Closing({ c }: { c: LandingCopy }) {
  return (
    <section className="px-4 py-24 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-[#D97757] px-6 py-16 text-center sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_0%,rgba(255,255,255,0.25),transparent_70%)]" />
        <h2 className={`${display.className} relative text-4xl font-semibold tracking-tight text-white md:text-5xl`}>{c.endTitle}</h2>
        <p className="relative mx-auto mt-3 max-w-md text-white/90">{c.endSub}</p>
        <Link
          href="/login?mode=register"
          className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-[#1F1B16] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-black"
        >
          {c.cta}
          <Arrow />
        </Link>
      </div>
    </section>
  );
}

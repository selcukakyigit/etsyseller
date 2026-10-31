import Link from "next/link";
import { display } from "@/components/site/fonts";
import { Lang } from "@/lib/i18n";
import { PriceList } from "@/lib/pricing";
import { LandingCopy } from "./copy";
import CustomCalculator from "./CustomCalculator";
import { Arrow, card, Check, Eyebrow, h3, Heading, muted, primary, secondary } from "./primitives";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SIGN_UP = "/login?mode=register";

/** Fiyatlandırma. Ana sayfada kısa (başlık, ücretsiz başlangıç, paketler); kendi sayfasında (`standalone`) tam: özel miktar hesaplayıcısı, neye kaç kredi, nasıl
 * çalışır, sık sorulanlar, vergi ve iade notu. Paket yoksa hediye krediyle başlamaya çağırır; paketler açılınca kendiliğinden dolar. Fiyatların hepsi backend'den
 * gelir (bkz. app/billing/price_list.py, custom.py); burada hesap yapılmaz, yalnızca gösterilir. */
export function Pricing({ lang, c, pricing, standalone }: { lang: Lang; c: LandingCopy; pricing: PriceList; standalone?: boolean }) {
  const p = c.pricing;
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  const money = (cents: number, currency: string) => {
    try {
      return (cents / 100).toLocaleString(locale, { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  };
  const number = (n: number) => n.toLocaleString(locale);
  const featured = pricing.packs.length >= 3 ? Math.floor(pricing.packs.length / 2) : -1;
  const groups = (["text", "image", "video"] as const).map((kind) => ({ kind, items: pricing.actions.filter((a) => a.kind === kind) })).filter((g) => g.items.length > 0);
  const custom = pricing.custom;

  return (
    <section id="pricing">
      <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${standalone ? "pb-4 pt-16 md:pt-20" : "py-24"}`}>
        <header className="mx-auto max-w-2xl text-center">
          <Eyebrow>{p.eyebrow}</Eyebrow>
          <Heading standalone={standalone} className="mt-4">
            {p.title}
          </Heading>
          <p className={`mt-5 ${muted}`}>{p.sub}</p>
          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {p.chips.map((chip) => (
              <li key={chip} className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-medium text-neutral-700 dark:border-white/15 dark:bg-white/5 dark:text-neutral-200">
                <Check className="h-3.5 w-3.5 text-[#D97757]" />
                {chip}
              </li>
            ))}
          </ul>
        </header>

        {pricing.welcome_credits > 0 && (
          <div className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-1 rounded-2xl border border-[#D97757]/30 bg-[#FBF1EA] px-6 py-5 text-center dark:bg-[#2A1D15]">
            <p className={`${display.className} text-xl font-semibold text-neutral-900 dark:text-neutral-50`}>{p.welcome(pricing.welcome_credits)}</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{p.welcomeSub}</p>
          </div>
        )}

        {pricing.packs.length > 0 ? (
          <div className="mt-12 grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
            {pricing.packs.map((pack, i) => {
              const isFeatured = i === featured;
              const discounted = pack.discount_pct > 0;
              return (
                <div
                  key={pack.id}
                  className={`${card} relative flex flex-col p-8 ${isFeatured ? "border-[#D97757] shadow-[0_24px_60px_-30px_rgba(217,119,87,0.75)] dark:border-[#D97757]" : ""}`}
                >
                  {isFeatured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#D97757] px-3 py-1 text-xs font-semibold text-white">{p.popular}</span>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{lang === "tr" ? pack.name_tr : pack.name_en}</p>
                    {discounted && (
                      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">{p.bonus(pack.discount_pct)}</span>
                    )}
                  </div>
                  <p className="mt-5 flex items-baseline gap-2">
                    <span className={`${display.className} text-5xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50`}>{money(pack.price_cents, pack.currency)}</span>
                    {discounted && <span className="text-base text-neutral-400 line-through dark:text-neutral-500">{money(pack.list_price_cents, pack.currency)}</span>}
                  </p>
                  <p className="mt-3 text-lg font-semibold text-[#A9502F] dark:text-[#F48771]">
                    {number(pack.credits)} {p.credits}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {p.perThousand.replace("{price}", money(Math.round((pack.price_cents / pack.credits) * 1000), pack.currency))}
                  </p>
                  <ul className={`mt-6 flex-1 space-y-2.5 border-t border-black/[0.07] pt-6 text-sm dark:border-white/10 ${muted}`}>
                    {p.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#D97757]" />
                        {perk}
                      </li>
                    ))}
                  </ul>
                  <Link href={SIGN_UP} className={`${isFeatured ? primary : secondary} mt-8 justify-center`}>
                    {p.buy}
                  </Link>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={`${card} mx-auto mt-12 max-w-2xl p-8 text-center`}>
            <p className={h3}>{p.soonTitle}</p>
            <p className={`mx-auto mt-2 max-w-md text-sm ${muted}`}>{p.soonText}</p>
            <Link href={SIGN_UP} className={`${primary} mt-6`}>
              {p.buy}
              <Arrow />
            </Link>
          </div>
        )}

        {!standalone && pricing.packs.length > 0 && (
          <p className="mt-8 text-center">
            <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#A9502F] hover:underline dark:text-[#F48771]">
              {p.allPricing}
              <Arrow />
            </Link>
          </p>
        )}

        {standalone && custom && pricing.packs.length > 0 && (
          <div className={`${card} mt-8 grid gap-8 p-8 md:grid-cols-2 md:gap-12 md:p-10`}>
            <div>
              <Eyebrow>{p.customEyebrow}</Eyebrow>
              <h2 className={`${h3} mt-3 text-2xl`}>{p.customTitle}</h2>
              <p className={`mt-3 ${muted}`}>{p.customSub.replace("{min}", number(custom.min))}</p>
              {custom.tiers.length > 0 && (
                <ul className="mt-5 flex flex-wrap gap-2">
                  {custom.tiers.map((t) => (
                    <li key={t.from_credits} className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-neutral-700 dark:border-white/15 dark:text-neutral-200">
                      {p.customTier.replace("{from}", number(t.from_credits)).replace("{pct}", String(t.discount_pct))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <CustomCalculator
              min={custom.min}
              max={custom.max}
              apiUrl={API_URL}
              locale={locale}
              ctaHref={SIGN_UP}
              labels={{ label: p.customLabel, quick: p.customQuick, range: p.customRange, off: p.customOff, perThousand: p.perThousand, cta: p.customCta, note: p.customNote }}
            />
          </div>
        )}

        {standalone && groups.length > 0 && (
          <div className="mt-20">
            <h2 className={`${h3} text-center text-2xl`}>{p.priceListTitle}</h2>
            <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
              {groups.map((g) => (
                <div key={g.kind} className={`${card} p-6`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">{p.groups[g.kind]}</p>
                  <ul className="mt-4 divide-y divide-black/5 dark:divide-white/10">
                    {g.items.map((a) => (
                      <li key={a.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="text-neutral-700 dark:text-neutral-200">{lang === "tr" ? a.label_tr : a.label_en}</span>
                        <span className="shrink-0 rounded-full bg-black/[0.04] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-neutral-900 dark:bg-white/10 dark:text-neutral-50">
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

        {standalone && (
          <>
            <div className="mt-20">
              <h2 className={`${h3} text-center text-2xl`}>{p.howTitle}</h2>
              <ol className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
                {p.steps.map(([title, body], i) => (
                  <li key={title} className={`${card} p-6`}>
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#FBF1EA] text-sm font-semibold text-[#A9502F] dark:bg-[#2A1D15] dark:text-[#F48771]">{i + 1}</span>
                    <p className="mt-4 font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
                    <p className={`mt-2 text-sm ${muted}`}>{body}</p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mx-auto mt-20 max-w-3xl">
              <h2 className={`${h3} text-center text-2xl`}>{p.faqTitle}</h2>
              <div className="mt-8 divide-y divide-black/10 border-y border-black/10 dark:divide-white/10 dark:border-white/10">
                {p.faq.map(([q, a]) => (
                  <details key={q} className="group py-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold text-neutral-900 dark:text-neutral-100 [&::-webkit-details-marker]:hidden">
                      {q}
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-black/15 text-neutral-600 transition group-open:rotate-45 dark:border-white/20 dark:text-neutral-300">+</span>
                    </summary>
                    <p className={`mt-3 pr-10 ${muted}`}>{a.replace("{min}", number(custom?.min ?? 500))}</p>
                  </details>
                ))}
              </div>
            </div>
          </>
        )}

        <p className="mx-auto mt-14 max-w-3xl text-center text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          {p.taxNote}{" "}
          <Link href="/terms" className="underline">{p.termsLink}</Link> · <Link href="/refunds" className="underline">{p.refundLink}</Link> ·{" "}
          <Link href="/distance-sales" className="underline">{p.distanceLink}</Link>
        </p>
      </div>
    </section>
  );
}

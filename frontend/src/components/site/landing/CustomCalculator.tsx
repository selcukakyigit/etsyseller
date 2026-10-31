"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IntegerInput } from "@/components/ui/NumberInputs";
import { Spinner } from "@/components/ui/Spinner";

type Quote = { credits: number; price_cents: number; list_price_cents: number; discount_pct: number; currency: string };
export type CalculatorLabels = { label: string; quick: string; range: string; off: string; perThousand: string; cta: string; note: string };

const QUICK = [500, 2000, 10000];

/** Fiyat sayfasındaki özel miktar hesaplayıcısı: miktarı yaz, fiyatı ve otomatik indirimi gör. Hesabı sunucu yapar (ödemedeki hesapla aynı kaynak,
 * bkz. backend app/billing/custom.py); burada fiyat hesaplanmaz, yalnızca gösterilir. `{min}`, `{max}`, `{pct}` metin yer tutucularıdır. */
export default function CustomCalculator({
  min,
  max,
  apiUrl,
  locale,
  ctaHref,
  labels,
}: {
  min: number;
  max: number;
  apiUrl: string;
  locale: string;
  ctaHref: string;
  labels: CalculatorLabels;
}) {
  const [text, setText] = useState("500");
  const [result, setResult] = useState<Quote | null>(null);
  const n = Number(text);
  const inRange = Number.isInteger(n) && n >= min && n <= max;

  // Her tuşta istek atmamamak için kısa bekleme; sonuç yalnızca yazılı miktara aitse gösterilir.
  useEffect(() => {
    if (!inRange) return;
    let live = true;
    const id = setTimeout(() => {
      fetch(`${apiUrl}/api/site/quote?credits=${n}`)
        .then((r) => (r.ok ? (r.json() as Promise<Quote>) : null))
        .then((q) => live && setResult(q))
        .catch(() => live && setResult(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [n, inRange, apiUrl]);

  const quote = inRange && result?.credits === n ? result : null;
  const num = (v: number) => v.toLocaleString(locale);
  const money = (cents: number, currency: string) => {
    try {
      return (cents / 100).toLocaleString(locale, { style: "currency", currency });
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  };

  return (
    <div className="rounded-2xl border border-black/[0.07] bg-[#FBF9F6] p-6 dark:border-white/10 dark:bg-[#0E0D0C]">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{labels.label}</label>
      <IntegerInput
        value={text}
        onValue={setText}
        className="w-full rounded-xl border-2 border-black/15 bg-white px-4 py-3 text-xl font-semibold text-neutral-900 outline-none transition focus:border-[#D97757] dark:border-white/20 dark:bg-[#171513] dark:text-neutral-50"
        aria-label={labels.label}
        maxLength={String(max).length}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{labels.quick}</span>
        {QUICK.filter((q) => q >= min && q <= max).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setText(String(q))}
            className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-neutral-700 transition hover:border-[#D97757] hover:text-[#D97757] dark:border-white/15 dark:text-neutral-200"
          >
            {num(q)}
          </button>
        ))}
      </div>

      <div className="mt-6 min-h-[5.5rem]">
        {!inRange ? (
          <p className="text-sm text-red-600 dark:text-red-400">{labels.range.replace("{min}", num(min)).replace("{max}", num(max))}</p>
        ) : quote ? (
          <div>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-4xl font-semibold tabular-nums tracking-tight text-neutral-900 dark:text-neutral-50">{money(quote.price_cents, quote.currency)}</span>
              {quote.discount_pct > 0 && (
                <>
                  <span className="text-base tabular-nums text-neutral-400 line-through dark:text-neutral-500">{money(quote.list_price_cents, quote.currency)}</span>
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
                    {labels.off.replace("{pct}", String(quote.discount_pct))}
                  </span>
                </>
              )}
            </p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {labels.perThousand.replace("{price}", money((quote.price_cents / quote.credits) * 1000, quote.currency))}
            </p>
          </div>
        ) : (
          <div className="flex h-14 items-center">
            <Spinner size={18} />
          </div>
        )}
      </div>

      <Link
        href={ctaHref}
        className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-[#D97757] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(217,119,87,0.8)] transition hover:bg-[#C6613F]"
      >
        {labels.cta}
      </Link>
      <p className="mt-3 text-center text-xs text-neutral-500 dark:text-neutral-400">{labels.note}</p>
    </div>
  );
}

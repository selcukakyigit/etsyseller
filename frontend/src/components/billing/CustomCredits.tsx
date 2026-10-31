"use client";

import { useEffect, useState } from "react";
import HelpTip from "@/components/ui/HelpTip";
import { IntegerInput } from "@/components/ui/NumberInputs";
import { Spinner } from "@/components/ui/Spinner";
import { BillingCustomInfo, BillingQuote, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

const QUICK = [500, 2000, 10000];

/** "İstediğin kadar kredi al": miktarı yazarsın, fiyatı (ve otomatik indirimi) sunucu hesaplar. Ödemede aynı hesap sunucuda yeniden yapılır. */
export default function CustomCredits({
  info,
  disabled,
  buying,
  onBuy,
}: {
  info: BillingCustomInfo;
  disabled: boolean;
  buying: boolean;
  onBuy: (credits: number) => void;
}) {
  const { t, locale } = useT();
  const [text, setText] = useState("500");
  const [result, setResult] = useState<BillingQuote | null>(null);
  const n = Number(text);
  const inRange = Number.isInteger(n) && n >= info.min && n <= info.max;
  // Yazarken her tuşta istek atmamak için kısa bekleme; sonuç hangi miktara aitse yalnızca o miktar görünürken gösterilir.
  useEffect(() => {
    if (!inRange) return;
    let live = true;
    const id = setTimeout(() => {
      api.billing.quote(n).then((q) => live && setResult(q)).catch(() => live && setResult(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [n, inRange]);

  const quote = inRange && result?.credits === n ? result : null;
  const money = (cents: number, currency: string) => {
    try {
      return (cents / 100).toLocaleString(locale, { style: "currency", currency });
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  };
  const num = (v: number) => v.toLocaleString(locale);

  return (
    <div className="mt-5 rounded-xl border border-neutral-300 bg-neutral-50 p-5 dark:border-neutral-700 dark:bg-neutral-950">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Kendi miktarını seç", "Choose your own amount")}</h3>
        <HelpTip>
          {t(
            "İhtiyacın kadar kredi alabilirsin. Miktar büyüdükçe kredi başına fiyat kendiliğinden düşer; indirim, paketlerle aynı basamakları kullanır. Fiyat ödeme ekranından önce burada gösterilir.",
            "Buy exactly the credits you need. The price per credit drops automatically as the amount grows, using the same steps as the packs. The price is shown here before you reach checkout.",
          )}
        </HelpTip>
      </div>

      <div className="mt-4 grid items-start gap-5 sm:grid-cols-[minmax(0,15rem)_1fr_auto]">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Kredi miktarı", "Credit amount")}</label>
          <IntegerInput
            value={text}
            onValue={setText}
            unit={t("kredi", "credits")}
            className="w-full rounded-lg border-2 border-neutral-300 bg-white px-3 py-2.5 text-lg font-semibold text-neutral-900 outline-none transition focus:border-[#D97757] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-50"
            aria-label={t("Kredi miktarı", "Credit amount")}
            maxLength={String(info.max).length}
          />
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {QUICK.filter((q) => q >= info.min && q <= info.max).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setText(String(q))}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                  n === q
                    ? "border-[#D97757] bg-[#FBF1EA] text-[#A9502F] dark:bg-[#2A1D15] dark:text-[#F48771]"
                    : "border-neutral-300 bg-white text-neutral-600 hover:border-[#D97757] hover:text-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                {num(q)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-[4.5rem]">
          {!inRange ? (
            <p className="pt-6 text-xs text-red-600 dark:text-red-400">{t(`${num(info.min)} ile ${num(info.max)} arasında bir miktar yaz.`, `Enter an amount between ${num(info.min)} and ${num(info.max)}.`)}</p>
          ) : quote ? (
            <div className="pt-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">{money(quote.price_cents, quote.currency)}</span>
                {quote.discount_pct > 0 && (
                  <>
                    <span className="text-sm tabular-nums text-neutral-400 line-through dark:text-neutral-500">{money(quote.list_price_cents, quote.currency)}</span>
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
                      {t(`%${quote.discount_pct} indirim`, `${quote.discount_pct}% off`)}
                    </span>
                  </>
                )}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t(`1.000 kredi başına ${money((quote.price_cents / quote.credits) * 1000, quote.currency)}`, `${money((quote.price_cents / quote.credits) * 1000, quote.currency)} per 1,000 credits`)}
              </p>
            </div>
          ) : (
            <div className="flex h-14 items-center">
              <Spinner size={16} />
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={disabled || buying || !quote}
          onClick={() => onBuy(n)}
          className="inline-flex items-center justify-center gap-2 self-end rounded-lg bg-[#D97757] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#C6613F] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buying && <Spinner size={14} />}
          {t("Satın al", "Buy")}
        </button>
      </div>

      {info.tiers.length > 0 && (
        <p className="mt-4 border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          {info.tiers.map((x) => t(`${num(x.from_credits)}+ kredi: %${x.discount_pct} indirim`, `${num(x.from_credits)}+ credits: ${x.discount_pct}% off`)).join(" · ")}
        </p>
      )}
    </div>
  );
}

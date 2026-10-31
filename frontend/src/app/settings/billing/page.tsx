"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LEGAL_VERSION } from "@/lib/legal";
import SettingsSubpage from "@/components/SettingsSubpage";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import UsageBreakdown from "@/components/billing/UsageBreakdown";
import { BillingHistoryRow, BillingProductOption, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { useAuthAndShop } from "@/lib/useAuthAndShop";

const KIND_NAMES: Record<string, [string, string]> = {
  usage: ["Kullanım", "Usage"],
  purchase: ["Kredi paketi", "Credit pack"],
  grant: ["Hediye", "Gift"],
  adjust: ["Düzeltme", "Adjustment"],
  refund: ["İade", "Refund"],
};
const TASK_NAMES: Record<string, [string, string]> = {
  assistant: ["Asistan", "Assistant"],
  seo: ["SEO önerisi", "SEO suggestion"],
  vision: ["Alt metin", "Alt text"],
  document: ["Fatura/tablo okuma", "Invoice/table reading"],
  image: ["Görsel üretimi", "Image generation"],
  video: ["Video üretimi", "Video generation"],
};
const card = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";

export default function BillingSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  return (
    <SettingsSubpage user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} title={t("Plan ve krediler", "Plan and credits")}>
      {bootError && <p className="text-sm text-red-600 dark:text-red-400">{bootError}</p>}
      {user && <Billing />}
    </SettingsSubpage>
  );
}

function Billing() {
  const { t, locale } = useT();
  const summary = useApiData("billing:summary", api.billing.summary);
  const history = useApiData("billing:history", api.billing.history);
  const purchases = useApiData("billing:purchases", api.billing.purchases);
  const [buying, setBuying] = useState<number | null>(null);
  const [accepted, setAccepted] = useState(false);
  const { reload: reloadSummary } = summary;
  const { reload: reloadHistory } = history;
  const { reload: reloadPurchases } = purchases;

  // Ödemeden dönüşte (?checkout=done) kredi webhook'la birkaç saniye içinde yüklenir; bir kez bildirip yenileriz.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("checkout")) return;
    toast.success(t("Ödeme alındı. Kredin birkaç saniye içinde hesabına yüklenir.", "Payment received. Your credits will be added within a few seconds."));
    window.history.replaceState(null, "", window.location.pathname);
    const id = setTimeout(() => {
      reloadSummary();
      reloadHistory();
      reloadPurchases();
    }, 5000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buy(p: BillingProductOption) {
    setBuying(p.id);
    try {
      const { url } = await api.billing.checkout(p.id, LEGAL_VERSION);
      window.location.assign(url);
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
      setBuying(null);
    }
  }

  const data = summary.data;
  if (summary.error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{summary.error}</p>;
  if (!data) return <BlockSpinner />;

  const total = data.balance;
  const packs = data.products;
  const price = (p: BillingProductOption) => {
    try {
      return (p.price_cents / 100).toLocaleString(locale, { style: "currency", currency: p.currency });
    } catch {
      return `${(p.price_cents / 100).toFixed(2)} ${p.currency}`;
    }
  };

  return (
    <div className="space-y-6">
      <section className={card}>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("Kredi bakiyen", "Your credit balance")}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{total.toLocaleString(locale)}</p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("Satın alınan krediler süresizdir.", "Purchased credits never expire.")}</p>
        {!data.enabled && (
          <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
            {t("Kredi sistemi henüz aktif değil; AI özellikleri şimdilik bakiyenden düşmez.", "The credit system is not active yet; AI features are not deducted from your balance for now.")}
          </p>
        )}
      </section>

      {packs.length === 0 ? (
        <section className={card}>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Kredi satışı yakında açılacak.", "Credit packs are coming soon.")}</p>
        </section>
      ) : (
        <ProductList
          title={t("Kredi paketleri", "Credit packs")}
          products={packs}
          price={price}
          buying={buying}
          disabled={!data.can_buy || !accepted}
          onBuy={buy}
          accepted={accepted}
          onAccept={setAccepted}
        />
      )}

      <Purchases rows={purchases.data} />
      <Usage />
      <History rows={history.data} />
    </div>
  );
}

/** Harcama dökümü: kategori, günlük grafik ve model tablosu; dönem seçilebilir. */
function Usage() {
  const { t } = useT();
  const [days, setDays] = useState(30);
  const { data, error } = useApiData(`billing:usage:${days}`, () => api.billing.usage(days));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Harcama", "Spending")}</h2>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                days === d ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              {t(`${d} gün`, `${d} days`)}
            </button>
          ))}
        </div>
      </div>
      {error && !data ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : data ? <UsageBreakdown usage={data} /> : <BlockSpinner />}
    </section>
  );
}

function ProductList({
  title,
  products,
  price,
  buying,
  disabled,
  onBuy,
  accepted,
  onAccept,
}: {
  title: string;
  products: BillingProductOption[];
  price: (p: BillingProductOption) => string;
  buying: number | null;
  disabled: boolean;
  onBuy: (p: BillingProductOption) => void;
  accepted: boolean;
  onAccept: (v: boolean) => void;
}) {
  const { t, locale } = useT();
  const money = (cents: number, currency: string) => {
    try {
      return (cents / 100).toLocaleString(locale, { style: "currency", currency });
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  };
  // Bonus: paketin kredi/fiyat oranı, en düşük orana göre ne kadar fazla. En çok verilen paket "en popüler" sayılır (ortadaki).
  const minRate = Math.min(...products.map((p) => p.credits / p.price_cents));
  const bonus = (p: BillingProductOption) => Math.round((p.credits / p.price_cents / minRate - 1) * 100);
  const featured = products.length >= 3 ? Math.floor(products.length / 2) : -1;
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("Abonelik yok · Tek seferlik ödeme · Krediler süresiz", "No subscription · One-time payment · Credits never expire")}
        </p>
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((p, i) => {
          const isFeatured = i === featured;
          const pct = bonus(p);
          return (
            <li
              key={p.id}
              className={`relative flex flex-col rounded-xl border p-5 ${
                isFeatured
                  ? "border-[#D97757] bg-[#FBF1EA] shadow-[0_12px_32px_-20px_rgba(217,119,87,0.8)] dark:bg-[#2A1D15]"
                  : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
              }`}
            >
              {isFeatured && (
                <span className="absolute -top-2.5 left-5 rounded-full bg-[#D97757] px-2.5 py-0.5 text-[11px] font-semibold text-white">{t("En popüler", "Most popular")}</span>
              )}
              {pct >= 3 && (
                <span className="absolute right-4 top-4 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
                  {t(`%${pct} bonus`, `${pct}% bonus`)}
                </span>
              )}
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{p.name}</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-50">{price(p)}</p>
              <p className="mt-2 text-lg font-semibold tabular-nums text-[#A9502F] dark:text-[#F48771]">
                {t(`${p.credits.toLocaleString(locale)} kredi`, `${p.credits.toLocaleString(locale)} credits`)}
              </p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {t(`1.000 kredi ≈ ${money((p.price_cents / p.credits) * 1000, p.currency)}`, `1,000 credits ≈ ${money((p.price_cents / p.credits) * 1000, p.currency)}`)}
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                <li className="flex items-center gap-2"><span className="text-[#D97757]">✓</span>{t("Süresiz, yenilenmez", "Never expires, never renews")}</li>
                <li className="flex items-center gap-2"><span className="text-[#D97757]">✓</span>{t("Her satın alma için fatura", "Invoice for every purchase")}</li>
              </ul>
              <button
                type="button"
                disabled={disabled || buying !== null}
                onClick={() => onBuy(p)}
                className={`mt-5 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isFeatured
                    ? "bg-[#D97757] text-white hover:bg-[#C6613F]"
                    : "border border-neutral-300 text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {buying === p.id && <Spinner size={14} />}
                {t("Satın al", "Buy")}
              </button>
            </li>
          );
        })}
      </ul>
      <label
        className={`mt-5 flex items-start gap-3 rounded-lg border p-3 text-xs text-neutral-600 dark:text-neutral-300 ${
          accepted ? "border-[#D97757]/40 bg-[#FBF1EA] dark:bg-[#2A1D15]" : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"
        }`}
      >
        <input type="checkbox" checked={accepted} onChange={(e) => onAccept(e.target.checked)} className="mt-0.5" />
        <span>
          {t("", "I accept the ")}
          <Link href="/terms" target="_blank" className="underline">{t("Kullanım Koşulları", "Terms of Service")}</Link>
          {t(", ", ", the ")}
          <Link href="/refunds" target="_blank" className="underline">{t("İade Politikası", "Refund Policy")}</Link>
          {t(" ve ", " and the ")}
          <Link href="/distance-sales" target="_blank" className="underline">{t("Mesafeli Satış Sözleşmesi", "Distance Sales Contract")}</Link>
          {t(
            "'ni kabul ediyorum. Kredilerin ödemeden hemen sonra yüklenmesini ve harcanan kredilerde cayma/iade hakkımın kalmayacağını onaylıyorum.",
            ". I confirm the credits are delivered immediately after payment and that I cannot withdraw from or get a refund for credits I have spent.",
          )}
        </span>
      </label>
      {!accepted && <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{t("Satın al düğmeleri, onay kutusunu işaretleyince açılır.", "The Buy buttons unlock when you tick the box above.")}</p>}
    </section>
  );
}

/** Satın almalar ve iadeler (kullanım kayıtlarından ayrı). Tutar ve fatura ödeme ortağının e-postasında; burada paket, kredi ve tarih görünür. */
function Purchases({ rows }: { rows: BillingHistoryRow[] | null }) {
  const { t, locale } = useT();
  return (
    <section className={card}>
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Satın alma geçmişi", "Purchase history")}</h2>
      <div className="max-h-80 overflow-auto">
        {rows === null ? (
          <BlockSpinner />
        ) : rows.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz satın alma yok. Hediye kredinle başlayabilirsin.", "No purchases yet. You can start with your gift credits.")}</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-neutral-800 dark:text-neutral-200">
                    {r.kind === "refund" ? t("İade", "Refund") : t("Kredi paketi", "Credit pack")}
                    {r.note ? ` · ${r.note.replace(/^Refund:\s*/, "")}` : ""}
                  </p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">{r.created_at ? new Date(r.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—"}</p>
                </div>
                <span className={`flex-shrink-0 tabular-nums ${r.delta > 0 ? "text-green-700 dark:text-green-400" : "text-neutral-900 dark:text-neutral-100"}`}>
                  {r.delta > 0 ? "+" : ""}{r.delta.toLocaleString(locale)} {t("kredi", "credits")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">{t("Her ödemenin faturası e-postana gönderilir.", "An invoice for each payment is emailed to you.")}</p>
    </section>
  );
}

/** Önce son 10 hareket görünür; "Daha fazla göster" 10'ar 10'ar açar (liste sayfayı uzatmasın). */
const HISTORY_STEP = 10;

function History({ rows }: { rows: BillingHistoryRow[] | null }) {
  const { t, locale } = useT();
  const [shown, setShown] = useState(HISTORY_STEP);
  return (
    <section className={card}>
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Son hareketler", "Recent activity")}</h2>
      {rows === null ? (
        <BlockSpinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz hareket yok.", "No activity yet.")}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {rows.slice(0, shown).map((r) => {
            const kind = KIND_NAMES[r.kind];
            const task = r.task ? TASK_NAMES[r.task] : undefined;
            // Kredi sistemi kapalıyken kullanım ölçülür ama düşülmez (delta 0): "x kredi değerinde" gösterilir.
            const amount = r.delta !== 0 ? `${r.delta > 0 ? "+" : ""}${r.delta.toLocaleString(locale)}` : t(`${r.credits} kredi değerinde`, `worth ${r.credits} credits`);
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-neutral-800 dark:text-neutral-200">
                    {kind ? t(kind[0], kind[1]) : r.kind}
                    {task ? ` · ${t(task[0], task[1])}` : ""}
                  </p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">{r.created_at ? new Date(r.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—"}</p>
                </div>
                <span className={`flex-shrink-0 tabular-nums ${r.delta > 0 ? "text-green-700 dark:text-green-400" : r.delta < 0 ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-400 dark:text-neutral-500"}`}>
                  {amount}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {rows !== null && rows.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + HISTORY_STEP)} className="mt-3 text-sm font-medium text-[#A9502F] hover:underline dark:text-[#F48771]">
          {t(`Daha fazla göster (${rows.length - shown})`, `Show more (${rows.length - shown})`)}
        </button>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
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
  const [buying, setBuying] = useState<number | null>(null);
  const { reload: reloadSummary } = summary;
  const { reload: reloadHistory } = history;

  // Ödemeden dönüşte (?checkout=done) kredi webhook'la birkaç saniye içinde yüklenir; bir kez bildirip yenileriz.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("checkout")) return;
    toast.success(t("Ödeme alındı. Kredin birkaç saniye içinde hesabına yüklenir.", "Payment received. Your credits will be added within a few seconds."));
    window.history.replaceState(null, "", window.location.pathname);
    const id = setTimeout(() => {
      reloadSummary();
      reloadHistory();
    }, 5000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buy(p: BillingProductOption) {
    setBuying(p.id);
    try {
      const { url } = await api.billing.checkout(p.id);
      window.location.assign(url);
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
      setBuying(null);
    }
  }

  const data = summary.data;
  if (summary.error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{summary.error}</p>;
  if (!data) return <BlockSpinner />;

  const total = data.balance.plan + data.balance.purchased;
  const packs = data.products.filter((p) => p.kind === "pack");
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
        <ProductList title={t("Kredi paketleri", "Credit packs")} products={packs} price={price} buying={buying} disabled={!data.can_buy} onBuy={buy} />
      )}

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
}: {
  title: string;
  products: BillingProductOption[];
  price: (p: BillingProductOption) => string;
  buying: number | null;
  disabled: boolean;
  onBuy: (p: BillingProductOption) => void;
}) {
  const { t, locale } = useT();
  return (
    <section className={card}>
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {products.map((p) => (
          <li key={p.id} className="flex flex-col justify-between gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{p.name}</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{price(p)}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t(`${p.credits.toLocaleString(locale)} kredi`, `${p.credits.toLocaleString(locale)} credits`)}</p>
            </div>
            <button
              type="button"
              disabled={disabled || buying !== null}
              onClick={() => onBuy(p)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#D97757] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#C6613F] disabled:opacity-50"
            >
              {buying === p.id && <Spinner size={14} />}
              {t("Satın al", "Buy")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({ rows }: { rows: BillingHistoryRow[] | null }) {
  const { t, locale } = useT();
  return (
    <section className={card}>
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Son hareketler", "Recent activity")}</h2>
      {rows === null ? (
        <BlockSpinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz hareket yok.", "No activity yet.")}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {rows.map((r) => {
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
    </section>
  );
}

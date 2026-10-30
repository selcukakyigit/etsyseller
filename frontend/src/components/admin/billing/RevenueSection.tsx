"use client";

import Link from "next/link";
import { useState } from "react";
import MiniBars from "@/components/admin/MiniBars";
import { Badge, EmptyState, RangeButtons, Section, StatCard, useFormat } from "@/components/admin/ui";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";

const RANGES = [30, 90, 365] as const;

/** Yönetim > Satış > Gelir: brüt/iade/net gelir, günlük seri, ürün dökümü ve gelire karşı sağlayıcı maliyeti. */
export default function RevenueSection() {
  const { t } = useT();
  const f = useFormat();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const { data, error } = useApiData(`admin:revenue:${days}`, () => api.admin.revenue(days));

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;
  const main = data.currencies[0];
  const cost = data.cost;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Gelir", "Revenue")}</h2>
          <HelpTip>
            {t(
              "Kaynak Lemon Squeezy webhook kayıtlarıdır. Test siparişleri gelire katılmaz. Para birimleri toplanmaz, her biri ayrı gösterilir. Kısmi iadelerde tutar, Lemon'un bildirdiği iade tutarıdır.",
              "The source is the Lemon Squeezy webhook log. Test orders are not counted. Currencies are never added together; each is shown on its own. For partial refunds the amount is what Lemon reports as refunded.",
            )}
          </HelpTip>
        </div>
        <RangeButtons value={days} options={RANGES} onChange={setDays} />
      </div>

      {(data.failed_events > 0 || data.test_orders > 0) && (
        <div className="flex flex-wrap gap-2">
          {data.failed_events > 0 && (
            <Link href="/admin/billing/events" className="rounded-lg">
              <Badge tone="bad">{t(`${f.num(data.failed_events)} işlenemeyen ödeme olayı`, `${f.num(data.failed_events)} payment events failed`)}</Badge>
            </Link>
          )}
          {data.test_orders > 0 && <Badge tone="muted">{t(`${f.num(data.test_orders)} test siparişi sayılmadı`, `${f.num(data.test_orders)} test orders not counted`)}</Badge>}
        </div>
      )}

      {data.currencies.length === 0 ? (
        <EmptyState>{t("Bu aralıkta sipariş yok.", "No orders in this range.")}</EmptyState>
      ) : (
        <div className="space-y-3">
          {data.currencies.map((c) => (
            <div key={c.currency} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label={t(`Brüt gelir (${c.currency})`, `Gross revenue (${c.currency})`)} value={f.money(c.gross, c.currency)} hint={t(`${f.num(c.orders)} sipariş`, `${f.num(c.orders)} orders`)} />
              <StatCard label={t("İadeler", "Refunds")} value={f.money(c.refunds, c.currency)} hint={t(`${f.num(c.refunded_orders)} iade`, `${f.num(c.refunded_orders)} refunds`)} />
              <StatCard label={t("Net gelir", "Net revenue")} value={f.money(c.net, c.currency)} />
              <StatCard label={t("Ortalama sipariş", "Average order")} value={c.orders ? f.money(c.gross / c.orders, c.currency) : "—"} />
            </div>
          ))}
        </div>
      )}

      {main && data.daily.length > 0 && (
        <MiniBars
          label={t(`Günlük brüt gelir (${main.currency})`, `Daily gross revenue (${main.currency})`)}
          points={data.daily.map((d) => ({ date: d.date, value: d.gross }))}
          format={(v) => f.money(v, main.currency)}
        />
      )}

      <Section
        title={t("Gelir ve maliyet", "Revenue and cost")}
        action={
          <HelpTip>
            {t(
              "Maliyet, aralıktaki AI sağlayıcı harcaması (kredi defterindeki USD maliyet) ve araştırma sağlayıcısı (DataForSEO) çağrılarıdır. Karşılaştırma yalnızca USD gelirle yapılır; sabit giderler (sunucu, Supabase) dahil değildir.",
              "Cost is AI provider spend in the range (USD cost in the credit ledger) plus research provider (DataForSEO) calls. The comparison uses USD revenue only; fixed costs (server, Supabase) are not included.",
            )}
          </HelpTip>
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("Net gelir (USD)", "Net revenue (USD)")} value={cost.revenue_usd === null ? "—" : f.money(cost.revenue_usd, "USD")} />
          <StatCard label={t("AI maliyeti", "AI cost")} value={f.money(cost.ai_cost_usd, "USD")} />
          <StatCard label={t("Araştırma maliyeti", "Research cost")} value={f.money(cost.research_cost_usd, "USD")} />
          <StatCard
            label={t("Kalan", "Remaining")}
            value={
              <span className={cost.margin_usd !== null && cost.margin_usd < 0 ? "text-red-600 dark:text-red-400" : ""}>
                {cost.margin_usd === null ? "—" : f.money(cost.margin_usd, "USD")}
              </span>
            }
          />
        </div>
        {cost.revenue_usd === null && (
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">{t("Bu aralıkta USD cinsinden sipariş yok, kalan hesaplanamadı.", "There are no USD orders in this range, so the remainder cannot be calculated.")}</p>
        )}
      </Section>

      <Section title={t("Ürüne göre", "By product")}>
        {data.by_product.length === 0 ? (
          <EmptyState>{t("Bu aralıkta sipariş yok.", "No orders in this range.")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                  <th className="pb-2 font-medium">{t("Paket", "Pack")}</th>
                  <th className="pb-2 text-right font-medium">{t("Sipariş", "Orders")}</th>
                  <th className="pb-2 text-right font-medium">{t("Brüt", "Gross")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {data.by_product.map((p) => (
                  <tr key={p.name} className="text-neutral-800 dark:text-neutral-200">
                    <td className="py-2">{p.name}</td>
                    <td className="py-2 text-right tabular-nums">{f.num(p.orders)}</td>
                    <td className="py-2 text-right tabular-nums">{main ? f.money(p.gross, main.currency) : f.num(p.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

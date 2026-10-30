"use client";

import { useState } from "react";
import { RangeButtons, Section, useFormat } from "@/components/admin/ui";
import MiniBars from "@/components/admin/MiniBars";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { AdminTrendPoint, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";

const RANGES = [7, 30, 90] as const;

/** Genel bakış > Trendler: günlük kayıt, kullanım, maliyet ve gelir. Gün sayısını yönetici seçer. */
export default function TrendsSection() {
  const { t } = useT();
  const f = useFormat();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const { data, error } = useApiData(`admin:trends:${days}`, () => api.admin.trends(days));

  const series = (pick: (p: AdminTrendPoint) => number) => (data ? data.points.map((p) => ({ date: p.date, value: pick(p) })) : []);
  const usd = (v: number) => f.money(v, "USD");

  return (
    <Section
      title={t("Trendler", "Trends")}
      action={
        <div className="flex items-center gap-2">
          <HelpTip>
            {t(
              "Günlük değerler (UTC günü). Gelir, Lemon siparişlerinden en çok satış yapılan para biriminde, iadeler düşülmüş net tutardır; test siparişleri sayılmaz.",
              "Daily values (UTC day). Revenue comes from Lemon orders in the currency with the most sales, net of refunds; test orders are not counted.",
            )}
          </HelpTip>
          <RangeButtons value={days} options={RANGES} onChange={setDays} />
        </div>
      }
    >
      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MiniBars label={t("Yeni kayıt", "New sign-ups")} points={series((p) => p.signups)} format={f.num} />
          <MiniBars label={t("AI kullanan hesap", "Accounts using AI")} points={series((p) => p.active_workspaces)} format={f.num} />
          <MiniBars label={t("AI isteği", "AI requests")} points={series((p) => p.ai_requests)} format={f.num} />
          <MiniBars label={t("Harcanan kredi", "Credits spent")} points={series((p) => p.credits_spent)} format={f.num} />
          <MiniBars label={t("AI sağlayıcı maliyeti", "AI provider cost")} points={series((p) => p.ai_cost_usd)} format={usd} />
          <MiniBars
            label={data.revenue_currency ? t(`Net gelir (${data.revenue_currency})`, `Net revenue (${data.revenue_currency})`) : t("Net gelir", "Net revenue")}
            points={series((p) => p.revenue)}
            format={(v) => (data.revenue_currency ? f.money(v, data.revenue_currency) : f.num(v))}
          />
        </div>
      )}
    </Section>
  );
}

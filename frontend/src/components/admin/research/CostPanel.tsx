"use client";

import { Section, UsageBar, useFormat } from "@/components/admin/ui";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { researchAdmin } from "@/lib/researchApi";
import { useApiData } from "@/lib/useApiData";
import { fmtMoney } from "./shared";

/** Aylık maliyet: bütçe çubuğu, ay sonu tahmini, son 30 günün günlük grafiği ve uç nokta bazlı döküm. */
export default function CostPanel() {
  const { t, locale } = useT();
  const f = useFormat();
  const { data, error } = useApiData("admin:research:cost", researchAdmin.cost);

  return (
    <Section
      title={t("Aylık maliyet", "Monthly cost")}
      action={
        <HelpTip align="right">
          {t(
            "Bütçe dolunca yeni sağlayıcı isteği yapılmaz; havuzdaki eski veri 'güncel değil' etiketiyle sunulur. Tavan Veri işlemleri'nden değişir. Ay sonu tahmini, bu ayın şu ana kadarki günlük ortalamasına göredir.",
            "When the budget is reached no new provider requests are made; old pool data is shown as stale. Change the cap under Data operations. The month-end estimate follows this month's daily average so far.",
          )}
        </HelpTip>
      }
    >
      {error && !data ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !data ? (
        <BlockSpinner />
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm tabular-nums text-neutral-900 dark:text-neutral-100">
              {fmtMoney(data.month_spend, locale)} / {fmtMoney(data.month_budget, locale)}
              <span className={`ml-2 text-xs ${data.projected_month > data.month_budget ? "text-amber-700 dark:text-amber-400" : "text-neutral-500 dark:text-neutral-400"}`}>
                {t(`Ay sonu tahmini: ${fmtMoney(data.projected_month, locale)}`, `Month-end estimate: ${fmtMoney(data.projected_month, locale)}`)}
                {data.projected_month > data.month_budget && ` · ${t("bütçeyi aşabilir", "may exceed the budget")}`}
              </span>
            </p>
            <UsageBar used={data.month_spend} limit={data.month_budget || 1} />
          </div>

          <DailyBars days={data.days} />

          {data.by_endpoint.length > 0 && (
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-neutral-500 dark:text-neutral-400">
                  <tr>
                    <th className="py-1 pr-3 font-medium">{t("Uç nokta (son 30 gün)", "Endpoint (last 30 days)")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("Çağrı", "Calls")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("Hata", "Errors")}</th>
                    <th className="py-1 text-right font-medium">{t("Maliyet", "Cost")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 text-neutral-700 dark:divide-neutral-800 dark:text-neutral-300">
                  {data.by_endpoint.map((e) => (
                    <tr key={e.endpoint}>
                      <td className="max-w-[18rem] truncate py-1.5 pr-3">{e.endpoint}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{f.num(e.calls)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{f.num(e.errors)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.cost_usd, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/** Tek seri (günlük maliyet): ince çubuklar, marka rengi, üstüne gelince gün/maliyet/çağrı. Boş günler ince taban çizgisi. */
function DailyBars({ days }: { days: { day: string; cost_usd: number; calls: number; errors: number }[] }) {
  const { t, locale } = useT();
  const max = Math.max(...days.map((d) => d.cost_usd), 0);
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const total = days.reduce((s, d) => s + d.cost_usd, 0);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span>{t("Günlük maliyet (son 30 gün)", "Daily cost (last 30 days)")}</span>
        <span className="tabular-nums">{t(`En yüksek gün: ${fmtMoney(max, locale)}`, `Highest day: ${fmtMoney(max, locale)}`)}</span>
      </div>
      <div
        role="img"
        aria-label={t(`Son 30 günde toplam ${fmtMoney(total, locale)} harcandı`, `${fmtMoney(total, locale)} spent in the last 30 days`)}
        className="flex h-28 items-end gap-[3px] border-b border-neutral-200 dark:border-neutral-800"
      >
        {days.map((d) => (
          <div
            key={d.day}
            title={`${label(d.day)} · ${fmtMoney(d.cost_usd, locale)} · ${t(`${d.calls} çağrı`, `${d.calls} calls`)}${d.errors ? ` · ${t(`${d.errors} hata`, `${d.errors} errors`)}` : ""}`}
            className="flex h-full flex-1 items-end"
          >
            <div
              className={`w-full rounded-t-[4px] ${d.cost_usd > 0 ? "bg-[#D97757]" : "bg-neutral-200 dark:bg-neutral-800"}`}
              style={{ height: d.cost_usd > 0 && max > 0 ? `${Math.max(4, (d.cost_usd / max) * 100)}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-neutral-400 dark:text-neutral-500">
        <span>{label(days[0].day)}</span>
        <span>{label(days[days.length - 1].day)}</span>
      </div>
    </div>
  );
}

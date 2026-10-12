"use client";

import { CompareBars, StackedBars, monthLabel } from "@/components/finance/charts";
import { useT } from "@/lib/i18n-client";
import { card, h2, muted, rowBorder, td, th } from "../core/ui";
import { money, perUnit, qty, unitLabel } from "../core/units";
import { SupplyReport } from "./api";

const MATERIAL_COLOR = "#10B981";
const SERVICE_COLOR = "#D97757";
const FEE_COLOR = "#A3A3A3";
const PREVIOUS_COLOR = "#9CA3AF";

/** Tarihi bir yıl geriye alır (29 Şubat için 28 Şubat). */
export const lastYear = (date: string) => `${Number(date.slice(0, 4)) - 1}${date.slice(4) === "-02-29" ? "-02-28" : date.slice(4)}`;

/** Dönemdeki aylar ("YYYY-MM", baştan sona). */
function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  while (y < Number(end.slice(0, 4)) || (y === Number(end.slice(0, 4)) && m <= Number(end.slice(5, 7)))) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

export default function CostReport({ data, previous, start, end, currency }: { data: SupplyReport; previous: SupplyReport | undefined; start: string; end: string; currency: string }) {
  const { t, locale } = useT();
  const monthName = (m: string) =>
    new Date(`${m}-01T00:00:00`).toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
    });

  return (
    <div className="space-y-4">
      <CostCharts data={data} previous={previous} start={start} end={end} currency={currency} />

      <section className={card}>
        <h2 className={`${h2} mb-3`}>{t("Aylara göre", "By month")}</h2>
        {data.months.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Bu dönemde onaylanan iş yok.", "No confirmed jobs in this period.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className={rowBorder}>
                  <th className={th}>{t("Ay", "Month")}</th>
                  <th className={`${th} text-right`}>{t("İş", "Jobs")}</th>
                  <th className={`${th} text-right`}>{t("Tahmin", "Estimate")}</th>
                  <th className={`${th} text-right`}>{t("Gerçek", "Actual")}</th>
                  <th className={`${th} text-right`}>{t("Maliyet", "Cost")}</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.month} className={rowBorder}>
                    <td className={td}>{monthName(m.month)}</td>
                    <td className={`${td} text-right`}>{m.jobs}</td>
                    <td className={`${td} text-right`}>{money(m.estimate, currency, locale)}</td>
                    <td className={`${td} text-right`}>{money(m.actual, currency, locale)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(m.cost, currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.external.length > 0 && (
        <section className={card}>
          <h2 className={h2}>{t("Dış paylar", "External shares")}</h2>
          <p className={`${muted} mb-3`}>{t("Maliyetin kendi mağazalarına yazılmayan, başkasına ait kısmı (başka hesap, yerel satış…). Ürün maliyetine ve Finans'a girmez.", "The part of the cost that belongs to someone else (another account, local sales…). Not booked as product cost or in Finance.")}</p>
          <table className="w-full text-sm">
            <tbody>
              {data.external.map((x) => (
                <tr key={x.party_id} className={rowBorder}>
                  <td className={td}>{x.name}</td>
                  <td className={`${td} text-right ${muted}`}>
                    {x.jobs} {t("iş", "jobs")}
                  </td>
                  <td className={`${td} text-right font-semibold`}>{money(x.amount, currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className={card}>
        <h2 className={h2}>{t("Kalem kullanımı", "Item usage")}</h2>
        <p className={`${muted} mb-3`}>
          {t("Onaylanan işlerin tahmin satırlarından: ne kadar kullanıldı, ortalama birim fiyat.", "From the estimate lines of confirmed jobs: how much was used, average unit price.")}
        </p>
        {data.usage.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Veri yok.", "No data.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className={rowBorder}>
                  <th className={th}>{t("Kalem", "Item")}</th>
                  <th className={`${th} text-right`}>{t("Miktar", "Quantity")}</th>
                  <th className={`${th} text-right`}>{t("Ort. birim fiyat", "Avg. unit price")}</th>
                  <th className={`${th} text-right`}>{t("Tutar", "Amount")}</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((u) => (
                  <tr key={`${u.price_item_id}-${u.description}-${u.unit}`} className={rowBorder}>
                    <td className={td}>{u.description}</td>
                    <td className={`${td} text-right`}>
                      {qty(u.qty, locale)} {unitLabel(u.unit, t)}
                    </td>
                    <td className={`${td} text-right`}>{u.avg_unit_price !== null ? perUnit(money(u.avg_unit_price, currency, locale), u.unit, t) : "—"}</td>
                    <td className={`${td} text-right font-semibold`}>{money(u.amount, currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Maliyet grafikleri: dönemin malzeme / hizmet / sabit ücret dağılımı ve malzeme ile hizmet maliyetinin geçen yılın aynı dönemiyle karşılaştırması. */
function CostCharts({ data, previous, start, end, currency }: { data: SupplyReport; previous: SupplyReport | undefined; start: string; end: string; currency: string }) {
  const { t, locale } = useT();
  const fmt = (n: number) => money(n, currency, locale);
  const keys = monthsBetween(start, end);
  const at = (report: SupplyReport | undefined, key: string) => report?.months.find((m) => m.month === key);
  const prevKey = (key: string) => `${Number(key.slice(0, 4)) - 1}${key.slice(4)}`;
  const labor = (m: SupplyReport["months"][number] | undefined) => (m ? m.service + m.fee : 0);
  const series = [
    { name: t("Geçen yıl", "Last year"), color: PREVIOUS_COLOR },
    { name: t("Bu dönem", "This period"), color: SERVICE_COLOR },
  ];
  const split = [
    { name: t("Malzeme", "Material"), color: MATERIAL_COLOR },
    {
      name: t("Hizmet (lazer vb.)", "Service (laser etc.)"),
      color: SERVICE_COLOR,
    },
    { name: t("Sabit ücret", "Fixed charge"), color: FEE_COLOR },
  ];
  if (data.months.length === 0 && !previous?.months.length) return null;
  const total = (n: number, p: number | undefined) => (
    <span className={muted}>
      {fmt(n)} · {t("geçen yıl", "last year")} {p === undefined ? "—" : fmt(p)}
    </span>
  );
  return (
    <>
      <section className={card}>
        <h2 className={h2}>{t("Maliyet dağılımı", "Cost breakdown")}</h2>
        <p className={`${muted} mb-3`}>{t("Onaylanan işlerin maliyeti: malzeme, hizmet ve sabit ücret.", "Cost of confirmed jobs: material, service and fixed charges.")}</p>
        <StackedBars
          data={keys.map((k) => ({
            label: monthLabel(k),
            parts: [at(data, k)?.material ?? 0, at(data, k)?.service ?? 0, at(data, k)?.fee ?? 0],
          }))}
          legend={split}
          fmt={fmt}
        />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className={h2}>{t("Malzeme maliyeti", "Material cost")}</h2>
          <p className="mb-3 text-xs">{total(data.material, previous?.material)}</p>
          <CompareBars
            data={keys.map((k) => ({
              label: monthLabel(k),
              values: [at(previous, prevKey(k))?.material ?? 0, at(data, k)?.material ?? 0],
            }))}
            series={series}
            fmt={fmt}
          />
        </section>
        <section className={card}>
          <h2 className={h2}>{t("Hizmet / işçilik maliyeti", "Service / labour cost")}</h2>
          <p className="mb-3 text-xs">{total(data.service + data.fee, previous === undefined ? undefined : previous.service + previous.fee)}</p>
          <CompareBars
            data={keys.map((k) => ({
              label: monthLabel(k),
              values: [labor(at(previous, prevKey(k))), labor(at(data, k))],
            }))}
            series={series}
            fmt={fmt}
          />
        </section>
      </div>
    </>
  );
}

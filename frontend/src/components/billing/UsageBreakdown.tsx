"use client";

import { StackedBars } from "@/components/finance/charts";
import { CreditCategory, CreditUsage } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

/** Kategorilerin adı, rengi ve sırası; kullanıcı sayfası, üst çubuk açılır kutusu ve yönetici ekranı aynısını kullanır. */
export const CREDIT_CATEGORIES: { id: CreditCategory; tr: string; en: string; color: string }[] = [
  { id: "text", tr: "Metin (yapay zekâ)", en: "Text (AI)", color: "#D97757" },
  { id: "image", tr: "Görsel", en: "Image", color: "#10B981" },
  { id: "video", tr: "Video", en: "Video", color: "#6366F1" },
  { id: "system", tr: "Sistem", en: "System", color: "#A3A3A3" },
];

const tile = "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";

/** Kredi harcama dökümü: kategori kutuları, günlük yığılmış grafik ve model tablosu. `admin`: sağlayıcı maliyeti, gelir ve marj da gösterilir
 * (backend yalnızca yöneticiye gönderir). */
export default function UsageBreakdown({ usage, admin = false }: { usage: CreditUsage; admin?: boolean }) {
  const { t, locale } = useT();
  const fmt = (n: number) => new Intl.NumberFormat(locale).format(Math.round(n));
  const usd = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
  const name = (c: CreditCategory) => {
    const x = CREDIT_CATEGORIES.find((k) => k.id === c)!;
    return t(x.tr, x.en);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {CREDIT_CATEGORIES.map((c) => (
          <div key={c.id} className={tile}>
            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
              {t(c.tr, c.en)}
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{fmt(usage.by_category[c.id])}</div>
          </div>
        ))}
      </div>

      {admin && usage.cost_usd !== undefined && (
        <div className="grid grid-cols-3 gap-3">
          <div className={tile}>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("Sağlayıcı maliyeti", "Provider cost")}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{usd(usage.cost_usd)}</div>
          </div>
          <div className={tile}>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("Gelir (kredi değeri)", "Revenue (credit value)")}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{usd(usage.revenue_usd ?? 0)}</div>
          </div>
          <div className={tile}>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("Marj", "Margin")}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${(usage.margin_usd ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>{usd(usage.margin_usd ?? 0)}</div>
          </div>
        </div>
      )}

      <section className={tile}>
        <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t(`Günlük harcama (son ${usage.days} gün)`, `Daily spend (last ${usage.days} days)`)}</h3>
        {usage.daily.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Bu dönemde harcama yok.", "No spend in this period.")}</p>
        ) : (
          <StackedBars
            data={usage.daily.map((d) => ({ label: d.date.slice(5), parts: CREDIT_CATEGORIES.map((c) => d[c.id]) }))}
            legend={CREDIT_CATEGORIES.map((c) => ({ name: t(c.tr, c.en), color: c.color }))}
            fmt={fmt}
          />
        )}
      </section>

      <section className={tile}>
        <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Modele göre", "By model")}</h3>
        {usage.by_model.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Veri yok.", "No data.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <th className="py-2 pr-3 font-medium">{t("Model", "Model")}</th>
                  <th className="py-2 pr-3 font-medium">{t("Tür", "Type")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("İşlem", "Calls")}</th>
                  <th className="py-2 text-right font-medium">{t("Kredi", "Credits")}</th>
                  {admin && <th className="py-2 pl-3 text-right font-medium">{t("Maliyet", "Cost")}</th>}
                </tr>
              </thead>
              <tbody>
                {usage.by_model.map((m) => (
                  <tr key={`${m.category}-${m.model}`} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                    <td className="py-2 pr-3 text-neutral-800 dark:text-neutral-200">{m.model}</td>
                    <td className="py-2 pr-3 text-neutral-500 dark:text-neutral-400">{name(m.category)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-neutral-600 dark:text-neutral-300">{fmt(m.calls)}</td>
                    <td className="py-2 text-right font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{fmt(m.credits)}</td>
                    {admin && <td className="py-2 pl-3 text-right tabular-nums text-neutral-600 dark:text-neutral-300">{usd(m.cost_usd ?? 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {t(`Sistem payı: her işlemde alınan sabit platform ücreti (${fmt(usage.by_category.system)} kredi).`, `System share: the fixed platform fee taken on every action (${fmt(usage.by_category.system)} credits).`)}
        </p>
      </section>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button, Section, StatCard, errorText, useFormat } from "@/components/admin/ui";
import { toast } from "@/lib/toast";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { researchAdmin } from "@/lib/researchApi";
import { useApiData } from "@/lib/useApiData";
import { fmtMoney, useSourceLabels } from "./shared";

/** Havuz sağlığı: ölçümlerin tazeliği, yönetim durumu, dağılım ve önümüzdeki 30 günün yenileme maliyeti tahmini (varsayılan pazar/dil). */
export default function HealthPanel() {
  const { t, locale } = useT();
  const f = useFormat();
  const sources = useSourceLabels();
  const { data, error, reload } = useApiData("admin:research:health", researchAdmin.health);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshDue() {
    setRefreshing(true);
    try {
      const r = await researchAdmin.refreshDue();
      toast.success(r.queued > 0 ? t(`${f.num(r.queued)} kelime yenileme için kuyruğa alındı.`, `${f.num(r.queued)} keywords queued for refresh.`) : t("Yenilenecek kelime yok (bütçe ya da kullanım nedeniyle de olabilir).", "Nothing to refresh (it can also be due to budget or usage)."));
      reload();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  const measured = data.fresh + data.stale;
  const parts = [
    { key: "fresh", label: t("Güncel", "Fresh"), n: data.fresh - data.expiring_7d, bar: "bg-emerald-500 dark:bg-emerald-600" },
    { key: "expiring", label: t("7 günde dolacak", "Expires within 7 days"), n: data.expiring_7d, bar: "bg-amber-400 dark:bg-amber-500" },
    { key: "stale", label: t("Yenilenmeli", "Stale"), n: data.stale, bar: "bg-red-400 dark:bg-red-500" },
    { key: "missing", label: t("Ölçümsüz", "Not measured"), n: data.missing, bar: "bg-neutral-300 dark:bg-neutral-700" },
  ];
  const total = Math.max(1, parts.reduce((s, p) => s + p.n, 0));

  return (
    <Section
      title={t(`Havuz sağlığı (${data.market}/${data.language})`, `Pool health (${data.market}/${data.language})`)}
      action={
        <div className="flex items-center gap-2">
          <Button busy={refreshing} onClick={() => void refreshDue()}>
            {t("Süresi dolanları şimdi yenile", "Refresh expired now")}
          </Button>
          <HelpTip align="right">
          {t(
            "Varsayılan pazar ve dil için. 'Yenileme tahmini': önümüzdeki 30 günde süresi dolacak (ya da dolmuş) normal durumdaki kelimelerin hepsi yenilenirse kaç istek ve yaklaşık ne kadar tutar; sağlayıcı istek başına ücret alır (kelime sayısından bağımsız, istek başına en çok 1000 kelime). Gerçek harcama yenileme başına kelime sınırına ve kullanılmayan kelimelerin atlanmasına göre bundan düşüktür. 'Süresi dolanları şimdi yenile' haftalık otomatik işin kurallarıyla (kullanılan ya da sabitli kelimeler) hemen çalışır; otomatik yenileme kapalı olsa da çalışır.",
            "For the default market and language. 'Refresh forecast': how many requests, and roughly what cost, if every active keyword that expires (or has expired) within 30 days were refreshed; the provider charges per request (not per keyword, up to 1000 keywords each). Real spend is lower because of the per-run keyword cap and skipped unused keywords. 'Refresh expired now' runs the weekly automatic job's rules right away (used or pinned keywords); it works even when automatic refresh is off.",
          )}
        </HelpTip>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <div role="img" aria-label={t("Ölçüm tazeliği dağılımı", "Measurement freshness breakdown")} className="flex h-3 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            {parts.map((p) => (
              <div key={p.key} className={p.bar} style={{ width: `${(p.n / total) * 100}%` }} title={`${p.label}: ${f.num(p.n)}`} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${p.bar}`} aria-hidden />
                {p.label}: <span className="tabular-nums font-medium">{f.num(p.n)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("Kelime", "Keywords")} value={f.num(data.terms)} hint={t(`${f.num(measured)} ölçümlü`, `${f.num(measured)} measured`)} />
          <StatCard
            label={t("Yönetim durumu", "Management status")}
            value={t(`${f.num(data.pinned)} sabitli`, `${f.num(data.pinned)} pinned`)}
            hint={t(`${f.num(data.status.archived)} arşivli · ${f.num(data.status.blocked)} engelli`, `${f.num(data.status.archived)} archived · ${f.num(data.status.blocked)} blocked`)}
          />
          <StatCard label={t("90 gündür kullanılmayan", "Unused for 90 days")} value={f.num(data.unused_90d)} hint={t("Otomatik yenilenmez", "Not auto-refreshed")} />
          <StatCard
            label={t("Yenileme tahmini (30 gün)", "Refresh forecast (30 days)")}
            value={data.forecast.estimated_usd === null ? "—" : fmtMoney(data.forecast.estimated_usd, locale)}
            hint={t(`${f.num(data.forecast.due)} kelime · ${f.num(data.forecast.requests)} istek`, `${f.num(data.forecast.due)} keywords · ${f.num(data.forecast.requests)} request(s)`)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Breakdown title={t("İlk kaynağa göre", "By first source")} rows={data.sources.map((s) => ({ key: sources[s.key] ?? s.key, count: s.count }))} />
          <Breakdown title={t("Pazar / dil (ölçümlü kelime)", "Market / language (measured keywords)")} rows={data.markets} />
        </div>
      </div>
    </Section>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; count: number }[] }) {
  const f = useFormat();
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{title}</h3>
      <ul className="max-h-40 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-300">
            <span>{r.key}</span>
            <span className="tabular-nums text-neutral-500 dark:text-neutral-400">{f.num(r.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

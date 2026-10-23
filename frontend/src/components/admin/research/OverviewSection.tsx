"use client";

import Link from "next/link";
import { Badge, Section, StatCard, UsageBar, useFormat } from "@/components/admin/ui";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { researchAdmin } from "@/lib/researchApi";
import { useApiData } from "@/lib/useApiData";
import { fmtMoney } from "./shared";

export default function OverviewSection() {
  const { t, locale } = useT();
  const f = useFormat();
  const { data, error } = useApiData("admin:research:overview", researchAdmin.overview);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  const freshPct = data.terms ? Math.round((data.fresh_terms / data.terms) * 100) : 0;
  const errorPct = data.calls_24h ? Math.round((data.errors_24h / data.calls_24h) * 100) : 0;

  return (
    <div className="space-y-6">
      {data.credentials === "none" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t("Sağlayıcı kimlik bilgisi girilmemiş; yeni veri çekilmiyor. ", "Provider credentials are not set; no new data is fetched. ")}
          <Link href="/admin/research/operations" className="font-medium underline">
            {t("Veri işlemleri", "Data operations")}
          </Link>
        </p>
      )}
      {!data.enabled && (
        <p className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
          {t("Araştırma kapalı: yeni iş kuyruğa alınmıyor.", "Research is off: no new jobs are queued.")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("Havuzdaki kelime", "Keywords in pool")} value={f.num(data.terms)} hint={t(`Son 24 saatte +${f.num(data.new_terms_24h)}`, `+${f.num(data.new_terms_24h)} in the last 24 h`)} />
        <StatCard label={t("Güncel kelime", "Fresh keywords")} value={`%${freshPct}`} hint={t(`${f.num(data.fresh_terms)} kelime süresi dolmamış ölçümlü`, `${f.num(data.fresh_terms)} with an unexpired measurement`)} />
        <StatCard label={t("Sağlayıcı çağrısı (24 sa)", "Provider calls (24 h)")} value={f.num(data.calls_24h)} hint={t(`Hata oranı %${errorPct}`, `Error rate ${errorPct}%`)} />
        <StatCard label={t("Ölçüm kaydı", "Metric rows")} value={f.num(data.metrics)} />
      </div>

      <Section
        title={t("Aylık maliyet", "Monthly cost")}
        action={<HelpTip align="right">{t("Bütçe dolunca yeni sağlayıcı isteği yapılmaz; havuzdaki eski veri 'güncel değil' etiketiyle sunulur. Tavan Veri işlemleri'nden değişir.", "When the budget is reached no new provider requests are made; old pool data is shown as stale. Change the cap under Data operations.")}</HelpTip>}
      >
        <div className="space-y-2">
          <p className="text-sm tabular-nums text-neutral-900 dark:text-neutral-100">
            {fmtMoney(data.spend_month, locale)} / {fmtMoney(data.budget_month, locale)}
          </p>
          <UsageBar used={data.spend_month} limit={data.budget_month || 1} />
        </div>
      </Section>

      <Section title={t("İş kuyruğu", "Job queue")}>
        <div className="flex flex-wrap gap-2">
          {(["queued", "running", "failed", "dead", "done"] as const).map((s) => (
            <Badge key={s} tone={s === "failed" || s === "dead" ? ((data.jobs[s] ?? 0) > 0 ? "bad" : "muted") : s === "done" ? "good" : "muted"}>
              {s}: {f.num(data.jobs[s] ?? 0)}
            </Badge>
          ))}
        </div>
      </Section>
    </div>
  );
}

"use client";

import { Section, StatCard, useFormat } from "@/components/admin/ui";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { UsageDay, researchAdmin } from "@/lib/researchApi";
import { useApiData } from "@/lib/useApiData";
import { useRefusedText } from "./shared";

/** Kullanım analitiği: Keşfet aramalarının havuzdan karşılanma oranı, iş gecikmesi, en çok aranan / sonuçsuz kalan kelimeler, reddedilme nedenleri. Yalnızca sayı. */
export default function AnalyticsSection() {
  const { t } = useT();
  const f = useFormat();
  const refusedText = useRefusedText();
  const { data, error } = useApiData("admin:research:analytics", researchAdmin.analytics);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  const searches = data.days.reduce((s, d) => s + d.search_hit + d.search_stale + d.search_miss, 0);
  const suggest = data.latency.find((l) => l.kind === "suggest");
  const secs = (v: number | null) => (v === null ? "—" : v < 90 ? `${f.num(Math.round(v))} ${t("sn", "s")}` : `${f.num(Math.round(v / 60))} ${t("dk", "min")}`);
  const refusedTotal = data.refused.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("Havuzdan karşılanma (30 gün)", "Served from the pool (30 days)")}
          value={data.hit_rate === null ? "—" : `%${Math.round(data.hit_rate * 100)}`}
          hint={t("Aramanın ilk bakışta hazır çıkma oranı", "Share of searches ready on first look")}
        />
        <StatCard label={t("Keşfet araması (30 gün)", "Discover searches (30 days)")} value={f.num(searches)} />
        <StatCard
          label={t("Arama hazırlanma süresi", "Search preparation time")}
          value={secs(suggest?.p50_s ?? null)}
          hint={suggest ? t(`Yavaş %5: ${secs(suggest.p95_s)} · ${f.num(suggest.jobs)} iş (7 gün)`, `Slowest 5%: ${secs(suggest.p95_s)} · ${f.num(suggest.jobs)} jobs (7 days)`) : undefined}
        />
        <StatCard label={t("Reddedilen istek (30 gün)", "Refused requests (30 days)")} value={f.num(refusedTotal)} hint={t("Kota ya da bütçe nedeniyle", "Because of quota or budget")} />
      </div>

      <Section
        title={t("Günlük arama sonuçları", "Daily search outcomes")}
        action={
          <HelpTip align="right">
            {t(
              "Hazır: veri havuzdaydı. Eski: eski veri gösterildi, arka planda yenileniyor. Bekledi: veri havuzda yoktu, sağlayıcıdan çekilmesi gerekti. Ekran sonucu beklerken yoklar; aynı mağazanın aynı kelimeye 2 dakika içindeki tekrarları tek arama sayılır.",
              "Ready: the data was in the pool. Stale: old data was shown while it refreshes. Waited: the data was not in the pool and had to be fetched. The screen polls while waiting; repeats of the same keyword by the same shop within 2 minutes count as one search.",
            )}
          </HelpTip>
        }
      >
        <OutcomeBars days={data.days} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("En çok aranan kelimeler", "Most searched keywords")}>
          <SearchList rows={data.top_searches} showEmpty />
        </Section>
        <Section
          title={t("Sonuç göremeyen aramalar", "Searches with no result")}
          action={
            <HelpTip align="right">
              {t("Kota, bütçe ya da sağlayıcıda veri olmaması yüzünden kullanıcının sonuç göremediği aramalar. Sık geçen kelimeleri sabitleyip önceden ölçtürmek iyi bir başlangıçtır.", "Searches where the user saw no result because of quota, budget, or no data at the provider. Pinning and pre-measuring frequent ones is a good start.")}
            </HelpTip>
          }
        >
          <SearchList rows={data.empty_searches} />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("Reddedilme nedenleri", "Why requests were refused")}>
          {data.refused.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Reddedilen istek yok.", "No refused requests.")}</p>
          ) : (
            <ul className="max-h-80 divide-y divide-neutral-100 overflow-auto dark:divide-neutral-800">
              {data.refused.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <span>{refusedText(r.key) ?? r.key}</span>
                  <span className="tabular-nums text-neutral-500 dark:text-neutral-400">{f.num(r.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          title={t("Mağaza başına kullanım (30 gün)", "Usage per shop (30 days)")}
          action={<HelpTip align="right">{t("En çok araştırma işi açan 10 mağaza (kimlik numarası). Aşırı kullanımı ve kötüye kullanımı fark etmek için.", "The 10 shops that opened the most research jobs (id). To spot heavy or abusive use.")}</HelpTip>}
        >
          {data.shops.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Kullanım yok.", "No usage.")}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="py-1 font-medium">{t("Mağaza", "Shop")}</th>
                  <th className="py-1 text-right font-medium">{t("İş", "Jobs")}</th>
                  <th className="py-1 text-right font-medium">{t("Maliyet", "Cost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-700 dark:divide-neutral-800 dark:text-neutral-300">
                {data.shops.map((s) => (
                  <tr key={s.shop_id}>
                    <td className="py-1.5">#{s.shop_id}</td>
                    <td className="py-1.5 text-right tabular-nums">{f.num(s.jobs)}</td>
                    <td className="py-1.5 text-right tabular-nums">${s.cost_usd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}

function SearchList({ rows, showEmpty = false }: { rows: { term: string; market: string; searches: number; empty: number }[]; showEmpty?: boolean }) {
  const { t } = useT();
  const f = useFormat();
  if (rows.length === 0) return <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Henüz veri yok.", "No data yet.")}</p>;
  return (
    <ul className="max-h-80 divide-y divide-neutral-100 overflow-auto dark:divide-neutral-800">
      {rows.map((r) => (
        <li key={`${r.term}-${r.market}`} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="truncate text-neutral-900 dark:text-neutral-100">{r.term}</span>
          <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
            {showEmpty ? t(`${f.num(r.searches)} arama`, `${f.num(r.searches)} searches`) : t(`${f.num(r.empty)} kez sonuçsuz`, `${f.num(r.empty)} without result`)}
            {showEmpty && r.empty > 0 && <span className="ml-2 text-amber-700 dark:text-amber-400">{t(`${f.num(r.empty)} sonuçsuz`, `${f.num(r.empty)} empty`)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Günlük yığılmış çubuklar: hazır / eski / bekledi. Renk tek başına anlam taşımaz; üstüne gelince sayılar yazar. */
function OutcomeBars({ days }: { days: UsageDay[] }) {
  const { t, locale } = useT();
  const max = Math.max(...days.map((d) => d.search_hit + d.search_stale + d.search_miss), 0);
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const legend = [
    { label: t("Hazır", "Ready"), bar: "bg-emerald-500 dark:bg-emerald-600" },
    { label: t("Eski veri", "Stale"), bar: "bg-amber-400 dark:bg-amber-500" },
    { label: t("Bekledi", "Waited"), bar: "bg-neutral-400 dark:bg-neutral-500" },
  ];
  if (max === 0) return <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Son 30 günde arama yok.", "No searches in the last 30 days.")}</p>;
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
        {legend.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${l.bar}`} aria-hidden />
            {l.label}
          </li>
        ))}
      </ul>
      <div className="flex h-28 items-end gap-[3px] border-b border-neutral-200 dark:border-neutral-800">
        {days.map((d) => {
          const total = d.search_hit + d.search_stale + d.search_miss;
          return (
            <div
              key={d.day}
              title={`${label(d.day)} · ${t("hazır", "ready")} ${d.search_hit} · ${t("eski", "stale")} ${d.search_stale} · ${t("bekledi", "waited")} ${d.search_miss}`}
              className="flex h-full flex-1 flex-col-reverse"
            >
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-[4px]" style={{ height: total > 0 ? `${Math.max(4, (total / max) * 100)}%` : "2px" }}>
                {total === 0 ? (
                  <div className="h-full bg-neutral-200 dark:bg-neutral-800" />
                ) : (
                  <>
                    <div className="bg-emerald-500 dark:bg-emerald-600" style={{ height: `${(d.search_hit / total) * 100}%` }} />
                    <div className="bg-amber-400 dark:bg-amber-500" style={{ height: `${(d.search_stale / total) * 100}%` }} />
                    <div className="bg-neutral-400 dark:bg-neutral-500" style={{ height: `${(d.search_miss / total) * 100}%` }} />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-neutral-400 dark:text-neutral-500">
        <span>{label(days[0].day)}</span>
        <span>{label(days[days.length - 1].day)}</span>
      </div>
    </div>
  );
}

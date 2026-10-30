"use client";

import { Badge, useFormat } from "@/components/admin/ui";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { ResearchEtsyInsights, researchAdmin } from "@/lib/researchApi";
import { useApiData } from "@/lib/useApiData";
import { StateBadge, StatusBadges } from "./shared";

export default function KeywordDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, locale } = useT();
  const f = useFormat();
  const { data, error } = useApiData(`admin:research:keyword:${id}`, () => researchAdmin.keyword(id));

  return (
    <Modal title={data?.keyword.term ?? t("Kelime", "Keyword")} widthClass="max-w-2xl" onClose={onClose} closeButton>
      <div className="min-h-[24rem] space-y-5">
        {error && !data ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : !data ? (
          <BlockSpinner />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <StateBadge state={data.keyword.state} />
              <StatusBadges status={data.keyword.status} pinned={data.keyword.pinned} />
              <span>{t("İlk kaynak", "First source")}: {data.keyword.first_source || "—"}</span>
              <span>· {t("Keşif", "Discovered")}: {f.date(data.keyword.created_at)}</span>
              {data.keyword.intent && <Badge tone="muted">{data.keyword.intent}</Badge>}
            </div>

            <div>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                {t("Öneri sinyalleri", "Suggestion signals")}
                <HelpTip>
                  {t(
                    "Yalnızca sayılar; mağaza kimliği tutulmaz. 'Önerildi': son günlerde kaç farklı mağazaya önerildi (kalabalık). 'Uygulandı': kaç mağaza yapay zekâ önerisiyle ekledi. Sonuçlar, kontrol gruplu önce/sonra ölçümünün kesinleşmiş hâlidir; aynı değişiklikteki diğer etiketlerle birlikte ölçülür, tek ifadenin etkisi değildir ve nedensellik kanıtlamaz.",
                    "Counts only; no shop ids are kept. 'Suggested': how many different shops it was suggested to recently (crowding). 'Applied': how many shops added it from an AI suggestion. Results are the final control-group before/after measurements; they cover the whole change with its other tags, are not the effect of one phrase, and do not prove causation.",
                  )}
                </HelpTip>
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {(
                  [
                    [t("Önerildi", "Suggested"), data.signals.suggested_shops],
                    [t("Uygulandı", "Applied"), data.signals.applied],
                    [t("Ölçüldü", "Measured"), data.signals.measured],
                    [t("İyi / kötü", "Better / worse"), `${data.signals.better} / ${data.signals.worse}`],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
                    <p className="text-neutral-500 dark:text-neutral-400">{label}</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {data.etsy && <EtsyInsightsBox etsy={data.etsy} />}

            <div>
              <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("Ölçüm geçmişi", "Measurement history")}</h3>
              <ul className="max-h-48 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {data.history.length === 0 && <li className="p-3 text-sm text-neutral-400">{t("Ölçüm yok.", "No measurements.")}</li>}
                {data.history.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="tabular-nums text-neutral-900 dark:text-neutral-100">
                      {m.search_volume === null ? "—" : m.search_volume.toLocaleString(locale)} · {m.market} · {m.source}
                    </span>
                    <span className="text-neutral-500 dark:text-neutral-400">{f.dateTime(m.measured_at)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("İlişkili kelimeler", "Related keywords")}</h3>
              <ul className="max-h-48 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {data.related.length === 0 && data.seeds.length === 0 && <li className="p-3 text-sm text-neutral-400">{t("İlişki yok.", "No relations.")}</li>}
                {data.seeds.map((s) => (
                  <li key={`s-${s}`} className="px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
                    ↑ {s}
                  </li>
                ))}
                {data.related.map((r) => (
                  <li key={r.term} className="flex items-center justify-between px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
                    <span>{r.term}</span>
                    <span className="tabular-nums text-neutral-500 dark:text-neutral-400">{r.search_volume === null ? "—" : r.search_volume.toLocaleString(locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Mağazaların Marketplace Insights'tan yapıştırdığı veri: Google ölçümünden AYRI, kullanıcı kaynaklı; havuz ölçümüne karıştırılmaz. */
function EtsyInsightsBox({ etsy }: { etsy: ResearchEtsyInsights }) {
  const { t, locale } = useT();
  const f = useFormat();
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString(locale));
  const conv = {
    very_low: t("çok düşük", "very low"),
    low: t("düşük", "low"),
    medium: t("orta", "medium"),
    high: t("yüksek", "high"),
    very_high: t("çok yüksek", "very high"),
  };
  const spread = etsy.searches_min !== null && etsy.searches_max !== null && etsy.searches_min > 0 && etsy.searches_max / etsy.searches_min > 3;
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
        {t("Etsy Insights (mağaza yapıştırması)", "Etsy Insights (shop-pasted)")}
        <HelpTip>
          {t(
            "Mağazaların Etsy Marketplace Insights'tan kendi yapıştırdığı veri; mağaza başına en yeni yapıştırma. Kullanıcı kaynaklıdır, doğrulanmamıştır ve yukarıdaki Google ölçümüne karıştırılmaz. Mağaza kimliği tutulmaz. Değerler birbirinden çok ayrışıyorsa uyarı çıkar.",
            "Data shops pasted themselves from Etsy Marketplace Insights; the newest paste per shop. It is user-sourced, unverified and never mixed into the Google measurement above. No shop ids are kept. A warning shows if the values differ a lot.",
          )}
        </HelpTip>
      </h3>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {(
          [
            [t("Mağaza", "Shops"), n(etsy.shops)],
            [t("Arama (orta)", "Searches (median)"), n(etsy.searches_median)],
            [t("Arama aralığı", "Searches range"), `${n(etsy.searches_min)} – ${n(etsy.searches_max)}`],
            [t("Sonuç (orta)", "Results (median)"), n(etsy.results_median)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <p className="text-neutral-500 dark:text-neutral-400">{label}</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        {etsy.conversion && <span>{t("Dönüşüm", "Conversion")}: {conv[etsy.conversion]}</span>}
        {etsy.trend_median !== null && <span>· {t("Değişim", "Change")}: {etsy.trend_median > 0 ? "+" : ""}{etsy.trend_median}%</span>}
        {etsy.latest_on && <span>· {f.date(etsy.latest_on)}</span>}
        {spread && <Badge tone="warn">{t("Değerler çok ayrışıyor", "Values differ a lot")}</Badge>}
        {etsy.shops < 3 && <Badge tone="muted">{t("Az mağaza", "Few shops")}</Badge>}
      </p>
    </div>
  );
}

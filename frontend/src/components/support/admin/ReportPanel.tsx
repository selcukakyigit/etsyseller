"use client";

import { useState } from "react";
import { EmptyState, Section, StatCard } from "@/components/admin/ui";
import { categoryLabel, labelName, sourceLabel } from "@/components/support/meta";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { adminTicketsApi, TicketCategory, TicketLabelOption, TicketSource } from "@/lib/supportApi";
import { useApiData } from "@/lib/useApiData";

const RANGES = [7, 30, 90] as const;

function hours(t: (tr: string, en: string) => string, h: number | null) {
  if (h === null) return "—";
  return h < 48 ? t(`${h} sa`, `${h} h`) : t(`${Math.round(h / 24)} gün`, `${Math.round(h / 24)} d`);
}

/** Bir dağılımı (anahtar → adet) yatay çubuklarla gösterir; en çok olan %100. */
function Bars({ rows }: { rows: { key: string; label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (rows.length === 0) return <EmptyState>—</EmptyState>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2 text-xs">
          <span className="truncate text-neutral-700 dark:text-neutral-300">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <span className="block h-full rounded-full bg-[#D97757]" style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-neutral-500 dark:text-neutral-400">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

/** Destek raporu: dönemde açılan talepler, ilk yanıt ve çözüm süresi (ortanca), memnuniyet; tür, kaynak ve konu dağılımı. */
export default function ReportPanel({ labels }: { labels: TicketLabelOption[] }) {
  const { t } = useT();
  const [days, setDays] = useState<number>(30);
  const { data } = useApiData(`admin:tickets:report:${days}`, () => adminTicketsApi.report(days));
  const rows = (m: Record<string, number>, name: (k: string) => string) => Object.entries(m).map(([key, n]) => ({ key, label: name(key), n }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${days === d ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 dark:text-neutral-300"}`}
            >
              {t(`Son ${d} gün`, `Last ${d} days`)}
            </button>
          ))}
        </div>
        <HelpTip>
          {t(
            "Süreler ortancadır (yarısı bundan hızlı). İlk yanıt: talep açılınca ekibin kullanıcıya ilk yanıtı (iç notlar sayılmaz). Konu dağılımı yalnızca etiketlenmiş talepleri sayar; etiketsiz sayısı ayrıca yazılır.",
            "Times are medians (half were faster). First reply: the team's first answer to the user (internal notes do not count). The topic split counts only labelled requests; the unlabelled count is shown separately.",
          )}
        </HelpTip>
      </div>
      {!data ? (
        <BlockSpinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("Açılan talep", "Requests opened")} value={data.created} hint={t(`${data.resolved} çözüldü · şu an ${data.open_now} açık`, `${data.resolved} resolved · ${data.open_now} open now`)} />
            <StatCard label={t("İlk yanıt süresi", "First reply time")} value={hours(t, data.first_response_hours)} />
            <StatCard label={t("Çözüm süresi", "Resolution time")} value={hours(t, data.resolution_hours)} />
            <StatCard label={t("Memnuniyet", "Satisfaction")} value={`👍 ${data.rating_up}  👎 ${data.rating_down}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={t("Konu dağılımı", "Topics")} action={<span className="text-xs text-neutral-400">{t(`etiketsiz: ${data.unlabelled}`, `unlabelled: ${data.unlabelled}`)}</span>}>
              <Bars rows={rows(data.by_label, (k) => labelName(t, labels, k))} />
            </Section>
            <div className="space-y-4">
              <Section title={t("Tür", "Type")}>
                <Bars rows={rows(data.by_category, (k) => categoryLabel(t, k as TicketCategory))} />
              </Section>
              <Section title={t("Nereden açıldı", "Where it was opened")}>
                <Bars rows={rows(data.by_source, (k) => sourceLabel(t, k as TicketSource))} />
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

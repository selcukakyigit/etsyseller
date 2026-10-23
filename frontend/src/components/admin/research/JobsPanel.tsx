"use client";

import { useState } from "react";
import { Button, EmptyState, Section, errorText, inputClass, useFormat } from "@/components/admin/ui";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { researchAdmin } from "@/lib/researchApi";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { JobStatusBadge, fmtMoney } from "./shared";

/** İş kuyruğu (yeniden dene / iptal) ve son sağlayıcı çağrıları (maliyet, süre, hata). Listeler kendi içinde kayar. */
export default function JobsPanel() {
  const { t, locale } = useT();
  const f = useFormat();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const jobs = useApiData(`admin:research:jobs:${status}:${page}`, () => researchAdmin.jobs({ status, page }));
  const calls = useApiData("admin:research:calls", researchAdmin.calls);

  async function act(fn: () => Promise<{ ok: boolean }>) {
    try {
      const r = await fn();
      if (!r.ok) toast.error(t("İşlem bu iş için uygun değil.", "This action is not available for the job."));
      jobs.reload();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    }
  }

  const pages = jobs.data ? Math.max(1, Math.ceil(jobs.data.total / jobs.data.per_page)) : 1;

  return (
    <>
      <Section
        title={t("İş kuyruğu", "Job queue")}
        action={
          <div className="flex items-center gap-2">
            <HelpTip align="right">
              {t(
                "Geçici hatalar üstel beklemeyle en fazla 3 kez denenir; sonra 'Vazgeçildi' olur. Aynı sorgu iki kez kuyruğa girmez. Hacim işleri tek istekte birleştirilir.",
                "Transient errors are retried up to 3 times with exponential backoff, then marked 'Dead'. The same query is never queued twice. Volume jobs are merged into one request.",
              )}
            </HelpTip>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={`${inputClass} w-40`}
              aria-label={t("Durum", "Status")}
            >
              <option value="">{t("Hepsi", "All")}</option>
              {["queued", "running", "done", "failed", "dead", "cancelled"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="min-h-[12rem]">
          {jobs.error && !jobs.data ? (
            <p className="text-sm text-red-600 dark:text-red-400">{jobs.error}</p>
          ) : !jobs.data ? (
            <BlockSpinner />
          ) : jobs.data.items.length === 0 ? (
            <EmptyState>{t("İş yok.", "No jobs.")}</EmptyState>
          ) : (
            <ul className="max-h-80 divide-y divide-neutral-100 overflow-auto dark:divide-neutral-800">
              {jobs.data.items.map((j) => (
                <li key={j.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="text-neutral-900 dark:text-neutral-100">
                      #{j.id} · {j.kind} · {j.market}/{j.language} · {j.items.toLocaleString(locale)} {t("kelime", "items")}
                    </p>
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {f.dateTime(j.created_at)} · {t("deneme", "attempts")} {j.attempts} · {fmtMoney(j.cost_usd, locale)}
                      {j.error ? ` · ${j.error}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <JobStatusBadge status={j.status} />
                    {j.status === "queued" && <Button onClick={() => void act(() => researchAdmin.cancelJob(j.id))}>{t("İptal", "Cancel")}</Button>}
                    {(j.status === "failed" || j.status === "dead" || j.status === "cancelled") && (
                      <Button onClick={() => void act(() => researchAdmin.retryJob(j.id))}>{t("Yeniden dene", "Retry")}</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {jobs.data && jobs.data.total > jobs.data.per_page && (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ←
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
              →
            </Button>
          </div>
        )}
      </Section>

      <Section title={t("Son sağlayıcı çağrıları", "Recent provider calls")}>
        <div className="min-h-[12rem]">
          {calls.error && !calls.data ? (
            <p className="text-sm text-red-600 dark:text-red-400">{calls.error}</p>
          ) : !calls.data ? (
            <BlockSpinner />
          ) : calls.data.length === 0 ? (
            <EmptyState>{t("Henüz çağrı yok.", "No calls yet.")}</EmptyState>
          ) : (
            <ul className="max-h-80 divide-y divide-neutral-100 overflow-auto dark:divide-neutral-800">
              {calls.data.map((c) => (
                <li key={c.id} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 truncate text-neutral-900 dark:text-neutral-100">
                    <span className={c.ok ? "" : "text-red-600 dark:text-red-400"}>{c.ok ? "✓" : "✕"}</span> {c.endpoint} · {c.market}
                    {c.error ? ` · ${c.error}` : ""}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                    {c.items.toLocaleString(locale)} · {fmtMoney(c.cost_usd, locale)} · {c.duration_ms} ms · {f.dateTime(c.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </>
  );
}

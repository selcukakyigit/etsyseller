"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import DocumentAnalyzer from "../components/DocumentAnalyzer";
import { EntityAccess, can, isMember } from "../core/api";
import { errMsg } from "../core/errors";
import { badge, btnLink, btnOutline, btnPrimary, card, h2, input, muted, rowBorder, td, th } from "../core/ui";
import { money } from "../core/units";
import { ACCEPT, Job, JobStatus, supplyApi } from "./api";
import { useAnalyzeHandlers } from "./useAnalyze";
import JobEditor from "./JobEditor";
import { STATUS, statusLabel } from "./texts";

/** Süzgeç düğmeleri: varsayılan "Bekleyenler" (onaylanmamış işler); onaylananlar "Tamamlananlar"da, hepsi "Tümü"nde. */
const FILTERS: ("open" | "all" | JobStatus)[] = ["open", "submitted", "draft", "disputed", "confirmed", "all"];
const PER_PAGE = 30;

export default function JobsTab({
  entityId,
  currency,
  vatRate,
  access,
  jobId,
  onJob,
  status,
  onStatus,
  onChanged,
}: {
  entityId: number;
  currency: string;
  vatRate: number;
  access: EntityAccess | undefined;
  jobId: number | null;
  onJob: (id: number | null) => void;
  status: string;
  onStatus: (s: string) => void;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const filter = status || "open";
  const { data, error, reload } = useApiData(`supply-jobs:${entityId}:${filter}:${q}:${page}`, () => supplyApi.jobs.list(entityId, { status: filter === "all" ? "" : filter, q, page }));
  const member = isMember(access);
  const canCreate = can(access, "jobs.create");
  const canUpload = can(access, "documents.upload");

  function refresh() {
    reload();
    onChanged();
  }

  const analyze = useAnalyzeHandlers(entityId, { createJob: true }, (r) => {
    if (r.job) {
      refresh();
      onJob(r.job.id);
    } else {
      toast.info(t("Belge kaydedildi; Belgeler sekmesinden tekrar okutabilirsin.", "The document was saved; you can read it again from the Documents tab."));
      refresh();
    }
  });

  if (jobId !== null) {
    return <JobEditor entityId={entityId} jobId={jobId} currency={currency} vatRate={vatRate} access={access} onClose={() => onJob(null)} onOpenJob={onJob} onChanged={refresh} />;
  }


  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PER_PAGE));

  return (
    <div className="space-y-4">
      {(canCreate || canUpload) && (
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className={h2}>{t("Yeni iş", "New job")}</h2>
              <p className={muted}>
                {t("Raporu, faturayı ya da fişi yükle: iş kendiliğinden açılır. Ya da boş bir iş aç.", "Upload the report, invoice or receipt and the job opens by itself. Or start an empty job.")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canCreate && <EmptyJobButton entityId={entityId} onCreated={(id) => { refresh(); onJob(id); }} />}
              {canUpload && canCreate && (
                <button type="button" onClick={() => setShowNew((v) => !v)} className={btnPrimary}>
                  {showNew ? t("Kapat", "Close") : t("Belgeden iş aç", "Job from a document")}
                </button>
              )}
            </div>
          </div>
          {showNew && canUpload && canCreate && (
            <div className="mt-4">
              <DocumentAnalyzer
                accept={ACCEPT}
                hint={t("Üretim raporu, fatura, fiş (PDF, fotoğraf, Excel)", "Production report, invoice, receipt (PDF, photo, Excel)")}
                onFile={analyze.onFile}
                withNote
                onText={analyze.onText}
              />
            </div>
          )}
        </section>
      )}

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                onStatus(f);
                setPage(0);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === f ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              {f === "open" ? t("Bekleyenler", "Open") : f === "all" ? t("Tümü", "All") : f === "confirmed" ? t("Tamamlananlar", "Completed") : statusLabel(f, t)}
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            maxLength={80}
            placeholder={t("Başlık ya da not ara", "Search title or note")}
            className={`${input} ml-auto w-full sm:w-56`}
          />
        </div>
        {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!data ? (
          <BlockSpinner />
        ) : data.items.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{q || filter !== "open" ? t("Bu süzgece uyan iş yok.", "No jobs match this filter.") : t("Bekleyen iş yok; bitenler “Tamamlananlar”da.", "No open jobs; finished ones are under “Completed”.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className={rowBorder}>
                  <th className={th}>{t("İş", "Job")}</th>
                  <th className={th}>{t("Tarih", "Date")}</th>
                  <th className={th}>{t("Durum", "Status")}</th>
                  <th className={`${th} text-right`}>{t("Tahmin", "Estimate")}</th>
                  <th className={`${th} text-right`}>{t("Gerçek", "Actual")}</th>
                  <th className={`${th} text-right`}>{t("Maliyet", "Cost")}</th>
                  {member && <th className={th} />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((j) => (
                  <tr key={j.id} onClick={() => onJob(j.id)} className={`${rowBorder} cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40`}>
                    <td className={td}>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">#{j.number}</span> {j.title}
                      {j.created_via === "guest" && <span className="ml-1.5 text-[11px] text-[#C6613F] dark:text-[#E8A48C]">· {t("tedarikçi", "supplier")}</span>}
                    </td>
                    <td className={td}>{new Date(j.job_date).toLocaleDateString(locale)}</td>
                    <td className={td}>
                      <span className={`${badge} ${STATUS[j.status].cls}`}>{statusLabel(j.status, t)}</span>
                    </td>
                    <td className={`${td} text-right`}>{money(j.estimate, j.currency, locale)}</td>
                    <td className={`${td} text-right`}>{money(j.actual, j.currency, locale)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(j.basis, j.currency, locale)}</td>
                    {member && (
                      <td className={`${td} whitespace-nowrap text-right`} onClick={(e) => e.stopPropagation()}>
                        <CostsAction job={j} entityId={entityId} onDone={refresh} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={btnOutline}>
              ‹ {t("Önceki", "Previous")}
            </button>
            <span className={muted}>
              {page + 1} / {pages}
            </span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className={btnOutline}>
              {t("Sonraki", "Next")} ›
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyJobButton({ entityId, onCreated }: { entityId: number; onCreated: (id: number) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const j = await supplyApi.jobs.create(entityId, { title: "" });
          onCreated(j.id);
        } catch (e) {
          toast.error(errMsg(e, t("İş açılamadı", "Could not create the job")));
        }
        setBusy(false);
      }}
      className={btnOutline}
    >
      + {t("Boş iş", "Empty job")}
    </button>
  );
}

/** Onaylanmış işin ürün paylarını Finans'a birim maliyet olarak yazar; uygulananlar geri alınabilir. Hepsi uygulanmışsa düğme sönük kalır. */
function CostsAction({ job, entityId, onDone }: { job: Job; entityId: number; onDone: () => void }) {
  const { t } = useT();
  const [confirm, confirmEl] = useConfirm();
  const [busy, setBusy] = useState(false);
  const costs = job.product_costs;
  if (!costs || costs.total === 0) return null;
  const applied = costs.total - costs.pending;

  async function run(kind: "apply" | "undo") {
    const n = kind === "apply" ? costs!.pending : applied;
    const ok = await confirm(
      kind === "apply"
        ? {
            title: t(`${n} ürünün birim maliyeti güncellensin mi?`, `Update the unit cost of ${n} product(s)?`),
            message: t(
              "Finans'ta ürün maliyeti bu işin payıyla, işin tarihinden itibaren geçerli olur: o tarihten önceki siparişler eski maliyetle kalır, ürün kârlılığı güncel maliyeti kullanır.",
              "In Finance the product cost becomes this job's share from the job's date: earlier orders keep the old cost, product profitability uses the latest cost.",
            ),
            confirmLabel: t("Uygula", "Apply"),
          }
        : {
            title: t(`${n} ürünün birim maliyeti geri alınsın mı?`, `Revert the unit cost of ${n} product(s)?`),
            message: t("Finans'taki ürün maliyetleri bu işi uygulamadan önceki haline döner.", "Product costs in Finance go back to how they were before this job was applied."),
            confirmLabel: t("Geri al", "Revert"),
            destructive: true,
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      if (kind === "apply") {
        const r = await supplyApi.applyJobCosts(entityId, job.id);
        toast.success(t(`${r.applied} ürünün birim maliyeti Finans'a yazıldı`, `Unit cost applied to ${r.applied} product(s) in Finance`));
      } else {
        const r = await supplyApi.undoJobCosts(entityId, job.id);
        toast.success(t(`${r.reverted} ürünün birim maliyeti geri alındı`, `Unit cost reverted for ${r.reverted} product(s)`));
      }
      onDone();
    } catch (e) {
      toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center justify-end gap-3">
      {applied > 0 && (
        <button type="button" disabled={busy} onClick={() => void run("undo")} className={btnLink}>
          {t("Geri al", "Revert")}
        </button>
      )}
      {costs.pending > 0 ? (
        <button type="button" disabled={busy} onClick={() => void run("apply")} className={btnPrimary}>
          {busy ? <Spinner size={14} /> : null}
          {t("Ürünün birim maliyeti yap", "Set as product unit cost")}
        </button>
      ) : (
        <button type="button" disabled className={`${btnOutline} cursor-default`} title={t("Bu işin ürün payları Finans'a yazıldı.", "This job's product shares are written to Finance.")}>
          ✓ {t("Birim maliyet yapıldı", "Unit cost applied")}
        </button>
      )}
      {confirmEl}
    </div>
  );
}

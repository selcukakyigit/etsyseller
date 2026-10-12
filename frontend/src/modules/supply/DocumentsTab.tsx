"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import DocumentAnalyzer from "../components/DocumentAnalyzer";
import DocumentList from "../components/DocumentList";
import { EntityAccess, can, isMember } from "../core/api";
import { errMsg } from "../core/errors";
import { btnLink, card, h2, muted } from "../core/ui";
import { ACCEPT, AnalyzeResult, supplyApi } from "./api";
import { useAnalyzeHandlers } from "./useAnalyze";

export default function DocumentsTab({ entityId, access, onOpenJob }: { entityId: number; access: EntityAccess | undefined; onOpenJob: (id: number) => void }) {
  const { t } = useT();
  const { data, reload } = useApiData(`supply-docs:${entityId}`, () => supplyApi.documents.list(entityId));
  const [createJob, setCreateJob] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const canUpload = can(access, "documents.upload");
  const canJob = can(access, "jobs.create");

  const analyze = useAnalyzeHandlers(entityId, { createJob: createJob && canJob }, done);

  function done(r: AnalyzeResult) {
    reload();
    if (r.job && !r.duplicate) {
      toast.success(t(`İş #${r.job.number} açıldı`, `Job #${r.job.number} created`));
    }
  }

  async function wrap(id: number, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
    }
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      {canUpload && (
        <section className={card}>
          <h2 className={h2}>{t("Belge yükle", "Upload documents")}</h2>
          <p className={`${muted} mb-3`}>
            {t(
              "Makine raporları (ör. lazer kesim Production Report) yapay zekâsız, ücretsiz okunur. Fatura ve fişler metinden okunur; fotoğraf en son çaredir. Aynı dosya ikinci kez okunmaz. Okunduktan sonra dosya saklanmaz, yalnızca okunan veri kalır.",
              "Machine reports (e.g. a laser cutter's Production Report) are read for free, without AI. Invoices and receipts are read from text; photos are the last resort. The same file is never read twice. Files are not kept after reading; only the extracted data is.",
            )}
          </p>
          <DocumentAnalyzer
            accept={ACCEPT}
            hint={t("PDF, fotoğraf, Excel, CSV, HTML ya da metin · en fazla 15 MB", "PDF, photo, Excel, CSV, HTML or text · up to 15 MB")}
            onFile={analyze.onFile}
            withNote
            onText={analyze.onText}
            extra={
              canJob ? (
                <label className="mt-3 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                  <input type="checkbox" checked={createJob} onChange={(e) => setCreateJob(e.target.checked)} className="h-4 w-4 accent-[#D97757]" />
                  {t("Her belge için iş aç", "Create a job for each document")}
                </label>
              ) : null
            }
          />
        </section>
      )}
      <section className={card}>
        <h2 className={`${h2} mb-3`}>{t("Belgeler", "Documents")}</h2>
        <DocumentList
          api={supplyApi}
          entityId={entityId}
          items={data?.items ?? null}
          canDelete={isMember(access)}
          onChanged={reload}
          actions={(d) => (
            <>
              {!d.has_data && canUpload && (
                <button type="button" disabled={busy === d.id} onClick={() => void wrap(d.id, async () => { const r = await supplyApi.analyze.again(entityId, d.id, canJob); if (r.error) toast.error(r.error); done(r); })} className={btnLink}>
                  {t("Tekrar oku", "Read again")}
                </button>
              )}
              {d.has_data && canJob && (
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() =>
                    void wrap(d.id, async () => {
                      const j = await supplyApi.analyze.jobFrom(entityId, d.id);
                      if (j.existing) toast.info(t(`Bu belgeden zaten iş #${j.number} var; o açıldı.`, `This document already has job #${j.number}; opened it.`));
                      onOpenJob(j.id);
                    })
                  }
                  className={btnLink}
                >
                  {t("Bundan iş aç", "Create job")}
                </button>
              )}
            </>
          )}
        />
      </section>
    </div>
  );
}

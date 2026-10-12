"use client";

import { Fragment, useMemo, useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import DecimalInput, { NumberInput } from "../components/DecimalInput";
import { materialLabel } from "../core/materials";
import DocumentAnalyzer from "../components/DocumentAnalyzer";
import { SourceBadge } from "../components/DocumentList";
import UnitSelect from "../components/UnitSelect";
import { EntityAccess, PriceItem, can, isMember } from "../core/api";
import { errMsg } from "../core/errors";
import { badge, btnDanger, btnDark, btnLink, btnOutline, btnPrimary, card, h2, input, label, muted, rowBorder, td, th, warnBox } from "../core/ui";
import { UNIT_GROUPS, currencySymbol, money, perUnit, qty as fmtQty, unitLabel } from "../core/units";
import AllocationEditor from "./AllocationEditor";
import { ACCEPT, DocData, JobDetail, JobLine, PROFILE, supplyApi } from "./api";
import { STATUS, statusLabel } from "./texts";
import { useAnalyzeHandlers } from "./useAnalyze";

/** Birimin boyutu (sayılabilir birimler kendi başına): istemci tarafı uyumluluk süzgeci; asıl kontrol sunucuda. */
function dimOf(code: string): string {
  const g = UNIT_GROUPS.find((x) => x.units.includes(code));
  if (!g) return code;
  return g.key === "count" ? code : g.key;
}

/** İş düzenleyici. Alt düzenleyiciler (başlık, satırlar, tutarlar, dağıtım) yerel taslak tutar; sunucudan yeni iş gelince
 * `key={job.updated_at}` ile sıfırdan kurulur (effect içinde durum eşitlemek yerine). */
export default function JobEditor({
  entityId,
  jobId,
  currency,
  vatRate,
  access,
  onClose,
  onOpenJob,
  onChanged,
}: {
  entityId: number;
  jobId: number;
  currency: string;
  /** Tedarikçinin varsayılan KDV oranı ("KDV uygulanmaz" kapatılınca buna dönülür). */
  vatRate: number;
  access: EntityAccess | undefined;
  onClose: () => void;
  onOpenJob: (id: number) => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const { data: job, setData: setJob, error } = useApiData<JobDetail>(`supply-job:${entityId}:${jobId}`, () => supplyApi.jobs.get(entityId, jobId));
  const { data: priceData } = useApiData(`modkit-prices:${supplyApi.base}:${entityId}:false`, () => supplyApi.prices.list(entityId));
  const { data: mapData, reload: reloadMaps } = useApiData(`supply-mappings:${entityId}`, () => supplyApi.mappings.list(entityId));
  const [busy, setBusy] = useState(false);
  const [disputing, setDisputing] = useState(false);
  // Bu işe belge ekleme: okunan belge işe bağlanır, satırlar eşlemelere göre yeniden kurulur.
  const attach = useAnalyzeHandlers(entityId, { createJob: false, jobId }, async (r) => {
    setJob(r.job ?? (await supplyApi.jobs.get(entityId, jobId)));
    onChanged();
  });
  const [disputeNote, setDisputeNote] = useState("");
  const [confirm, confirmEl] = useConfirm();
  const items = useMemo(() => priceData?.items ?? [], [priceData]);
  const member = isMember(access);
  const canEdit = !!job && job.status !== "confirmed" && can(access, "jobs.create");
  const maps = useMemo(() => new Map((mapData?.items ?? []).filter((m) => m.profile === PROFILE).map((m) => [m.field_key, m.price_item_id])), [mapData]);

  /** İşlemi yürütür; başarılıysa true döner (onay sonrası listeye dönmek için). */
  async function run(fn: () => Promise<JobDetail | unknown>, ok?: string): Promise<boolean> {
    setBusy(true);
    let done = false;
    try {
      const r = await fn();
      if (r && typeof r === "object" && "lines" in r) setJob(r as JobDetail);
      if (ok) toast.success(ok);
      onChanged();
      done = true;
    } catch (e) {
      toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
    }
    setBusy(false);
    return done;
  }

  const act = async (fn: () => Promise<JobDetail | unknown>, ok?: string): Promise<void> => {
    await run(fn, ok);
  };

  if (!job) {
    return (
      <section className={card}>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <BlockSpinner />}
        <button type="button" onClick={onClose} className={`${btnLink} mt-3`}>
          ← {t("İşlere dön", "Back to jobs")}
        </button>
      </section>
    );
  }

  async function setMapping(fieldKey: string, itemId: number | null) {
    await act(async () => {
      await supplyApi.mappings.set(entityId, PROFILE, fieldKey, itemId);
      reloadMaps();
      return supplyApi.jobs.rebuild(entityId, jobId);
    }, t("Eşleme kaydedildi; sonraki belgeler de böyle okunacak", "Mapping saved; future documents will be read the same way"));
  }

  const st = STATUS[job.status];
  const data = job.document?.data ?? null;
  const twins = job.similar ?? [];
  const confirmedTwin = twins.find((s) => s.status === "confirmed");

  return (
    <div className="space-y-4">
      <button type="button" onClick={onClose} className={btnLink}>
        ← {t("İşlere dön", "Back to jobs")}
      </button>

      <Header key={job.updated_at} job={job} defaultVat={vatRate} canEdit={canEdit} busy={busy} onSave={(patch) => act(() => supplyApi.jobs.update(entityId, jobId, patch), t("Kaydedildi", "Saved"))} />

      <div className="flex flex-wrap items-center gap-2">
        <span className={`${badge} ${st.cls}`}>{statusLabel(job.status, t)}</span>
        {job.created_via === "guest" && <span className={`${badge} bg-[#D97757]/15 text-[#C6613F] dark:bg-[#D97757]/20 dark:text-[#E8A48C]`}>{t("tedarikçi ekledi", "added by supplier")}</span>}
        {job.status === "disputed" && job.dispute_note && <span className="text-xs text-red-700 dark:text-red-300">“{job.dispute_note}”</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {access?.role === "guest" && (job.status === "draft" || job.status === "disputed") && can(access, "jobs.create") && (
            <button type="button" disabled={busy} onClick={() => void act(() => supplyApi.jobs.submit(entityId, jobId), t("Onaya gönderildi", "Sent for approval"))} className={btnPrimary}>
              {t("Onaya gönder", "Send for approval")}
            </button>
          )}
          {member && (job.status === "submitted" || job.status === "draft") && (
            <button type="button" disabled={busy} onClick={() => setDisputing((v) => !v)} className={btnOutline}>
              {t("İtiraz et", "Dispute")}
            </button>
          )}
          {member && job.status === "confirmed" && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await confirm({ title: t("İş yeniden açılsın mı?", "Reopen this job?"), message: t("Finansa yazılan dağıtımlar kaldırılır; ürünlere uygulanmış birim maliyetler de uygulamadan önceki haline döner.", "Its allocations are removed from finance; unit costs already applied to products go back to their previous values."), confirmLabel: t("Yeniden aç", "Reopen") }))
                  await act(() => supplyApi.jobs.reopen(entityId, jobId));
              }}
              className={btnOutline}
            >
              {t("Yeniden aç", "Reopen")}
            </button>
          )}
          {job.status !== "confirmed" && (member || (access?.role === "guest" && job.created_via === "guest")) && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!(await confirm({ title: t(`İş #${job.number} silinsin mi?`, `Delete job #${job.number}?`), destructive: true, confirmLabel: t("Sil", "Delete") }))) return;
                setBusy(true);
                try {
                  await supplyApi.jobs.remove(entityId, jobId);
                  onChanged();
                  onClose();
                } catch (e) {
                  toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
                  setBusy(false);
                }
              }}
              className={btnDanger}
            >
              {t("Sil", "Delete")}
            </button>
          )}
        </div>
      </div>

      {member && job.status !== "confirmed" && twins.length > 0 && (
        <div className={warnBox}>
          {t("Aynı tarih ve tutarda başka iş var; mükerrer olabilir:", "Another job has the same date and amount; it may be a duplicate:")}{" "}
          {twins.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <button type="button" onClick={() => onOpenJob(s.id)} className="font-semibold underline">
                #{s.number}
              </button>{" "}
              ({statusLabel(s.status, t)})
            </span>
          ))}
        </div>
      )}

      {disputing && (
        <section className={card}>
          <label className={label}>{t("İtiraz notu (tedarikçi görür)", "Dispute note (the supplier sees it)")}</label>
          <textarea value={disputeNote} onChange={(e) => setDisputeNote(e.target.value)} rows={2} maxLength={500} className={`${input} w-full`} />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                await act(() => supplyApi.jobs.dispute(entityId, jobId, disputeNote), t("İtiraz kaydedildi", "Dispute saved"));
                setDisputing(false);
                setDisputeNote("");
              }}
              className={btnDark}
            >
              {t("İtirazı gönder", "Send dispute")}
            </button>
            <button type="button" onClick={() => setDisputing(false)} className={btnLink}>
              {t("Vazgeç", "Cancel")}
            </button>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {job.document ? (
            <DocPanel
              entityId={entityId}
              job={job}
              items={items}
              maps={maps}
              canMap={canEdit}
              busy={busy}
              onMap={(k, id) => void setMapping(k, id)}
            />
          ) : (
            canEdit &&
            can(access, "documents.upload") && (
              <section className={card}>
                <h2 className={h2}>{t("Belge ekle", "Attach a document")}</h2>
                <p className={`${muted} mb-3`}>
                  {t("Üretim raporu, fatura ya da fiş: okunan ölçüler fiyat listesine göre hesaplanır, yazan tutar gerçek tutar olur.", "Production report, invoice or receipt: measured values are priced from the list, the written amount becomes the actual amount.")}
                </p>
                <DocumentAnalyzer
                  accept={ACCEPT}
                  multiple={false}
                  hint={t("PDF, fotoğraf, Excel ya da metin", "PDF, photo, Excel or text")}
                  onFile={attach.onFile}
                  withNote
                  onText={attach.onText}
                />
              </section>
            )
          )}

          <LinesEditor
            key={`lines-${job.updated_at}`}
            job={job}
            items={items}
            currency={currency}
            canEdit={canEdit}
            busy={busy}
            onSave={(lines) => act(() => supplyApi.jobs.setLines(entityId, jobId, lines), t("Satırlar kaydedildi", "Lines saved"))}
          />

          {member && (
            <AllocationEditor
              key={`alloc-${job.updated_at}`}
              entityId={entityId}
              job={job}
              onJob={(j) => {
                setJob(j);
                onChanged();
              }}
            />
          )}
        </div>

        <div className="space-y-4">
          <Totals key={job.updated_at} job={job} data={data} currency={currency} canEdit={canEdit} busy={busy} onActual={(v) => act(() => supplyApi.jobs.update(entityId, jobId, { actual: v }), t("Kaydedildi", "Saved"))} />
          {member && job.status !== "confirmed" && (
            <section className={card}>
              <h2 className={h2}>{t("Onay", "Approval")}</h2>
              <p className={`${muted} mt-1`}>
                {t(
                  "Onayladığında maliyet seçtiğin ürünlere ya da genel gidere yazılır ve Finans raporlarına girer. Onaylanan iş değiştirilemez; gerekirse yeniden açılır.",
                  "When you confirm, the cost is written to the products or overhead you chose and shows up in Finance. A confirmed job cannot be edited; reopen it if needed.",
                )}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  // Aynı maliyet iki kez Finans'a yazılmasın: onaylanmış bir ikiz varsa önce sor.
                  if (
                    confirmedTwin &&
                    !(await confirm({
                      title: t(`İş #${confirmedTwin.number} ile aynı tarih ve tutar. Yine de onaylansın mı?`, `Same date and amount as job #${confirmedTwin.number}. Confirm anyway?`),
                      message: t("Aynı belge iki kez girilmiş olabilir; onaylarsan maliyet iki kez yazılır.", "The same document may have been entered twice; confirming records the cost twice."),
                      confirmLabel: t("Yine de onayla", "Confirm anyway"),
                    }))
                  )
                    return;
                  // Onaydan sonra iş listesine dönülür: ürün maliyetleri oradan Finans'a uygulanır.
                  if (await run(() => supplyApi.jobs.confirm(entityId, jobId, !!confirmedTwin), t("İş onaylandı; ürün maliyetlerini listeden uygulayabilirsin", "Job confirmed; you can apply the product costs from the list"))) onClose();
                }}
                className={`${btnPrimary} mt-3 w-full`}
              >
                {busy ? <Spinner size={14} /> : null}
                {t("Onayla ve maliyete yaz", "Confirm and record the cost")}
              </button>
            </section>
          )}
        </div>
      </div>
      {confirmEl}
    </div>
  );
}

function Header({ job, defaultVat, canEdit, busy, onSave }: { job: JobDetail; defaultVat: number; canEdit: boolean; busy: boolean; onSave: (p: { title?: string; job_date?: string; note?: string; vat_rate?: number }) => Promise<void> }) {
  const { t, locale } = useT();
  const [title, setTitle] = useState(job.title);
  const [date, setDate] = useState(job.job_date);
  const [vat, setVat] = useState(String(job.vat_rate));
  const [note, setNote] = useState(job.note);
  const noVat = vat.trim() !== "" && Number(vat.replace(",", ".")) === 0;
  const dirty = title !== job.title || date !== job.job_date || Number(vat.replace(",", ".")) !== job.vat_rate || note !== job.note;

  if (!canEdit) {
    return (
      <section className={card}>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          #{job.number} {job.title || t("Adsız iş", "Untitled job")}
        </h2>
        <p className={muted}>
          {new Date(job.job_date).toLocaleDateString(locale)} · {job.vat_rate === 0 ? t("KDV uygulanmaz", "No VAT") : `${t("KDV", "VAT")} %${job.vat_rate}`}
        </p>
        {job.note && <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{job.note}</p>}
      </section>
    );
  }
  return (
    <section className={card}>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_110px]">
        <div>
          <label className={label}>
            {t("İş", "Job")} #{job.number}
          </label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("Başlık (ör. 21 Eylül kesim)", "Title (e.g. Sept 21 cut)")} className={`${input} w-full`} />
        </div>
        <div>
          <label className={label}>{t("Tarih", "Date")}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${input} w-full`} />
        </div>
        <div>
          <label className={label}>{t("KDV %", "VAT %")}</label>
          <DecimalInput value={vat} onValue={setVat} className={`${input} w-full`} />
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            <input
              type="checkbox"
              checked={noVat}
              onChange={(e) => setVat(e.target.checked ? "0" : String(defaultVat > 0 ? defaultVat : 20))}
              className="h-3.5 w-3.5 accent-[#D97757]"
            />
            {t("KDV uygulanmaz", "No VAT")}
          </label>
        </div>
      </div>
      <div className="mt-3">
        <label className={label}>{t("Not (iki taraf da görür)", "Note (both sides see it)")}</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={5000} className={`${input} w-full`} />
      </div>
      {dirty && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={busy || !date}
            onClick={() => {
              const v = Number(vat.replace(",", "."));
              if (!Number.isFinite(v) || v < 0 || v > 100) {
                toast.error(t("KDV 0-100 arası olmalı", "VAT must be between 0 and 100"));
                return;
              }
              void onSave({ title, job_date: date, note, vat_rate: v });
            }}
            className={btnDark}
          >
            {t("Kaydet", "Save")}
          </button>
          <span className={muted}>{date !== job.job_date ? t("Tarih değişince fiyatlar o tarihteki listeden yeniden alınır.", "Changing the date re-prices lines from the list as of that date.") : ""}</span>
        </div>
      )}
    </section>
  );
}

function DocPanel({
  entityId,
  job,
  items,
  maps,
  canMap,
  busy,
  onMap,
}: {
  entityId: number;
  job: JobDetail;
  items: PriceItem[];
  maps: Map<string, number>;
  canMap: boolean;
  busy: boolean;
  onMap: (fieldKey: string, itemId: number | null) => void;
}) {
  const { t, locale } = useT();
  const doc = job.document!;
  const data = doc.data;
  const priced = items.filter((i) => i.kind === "service" || i.kind === "material");
  // Belge ölçülerinden gelen satırlar birden çok boyutta (süre + uzunluk/delme…) fiyatlanıyorsa aynı iş iki kez sayılıyor olabilir.
  const measureDims = new Set(job.lines.filter((l) => l.price_item_id && l.source_key && !l.source_key.startsWith("line:")).map((l) => dimOf(l.unit)));

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={h2}>{t("Belgeden okunanlar", "Read from the document")}</h2>
        <div className="flex items-center gap-2">
          <SourceBadge source={doc.source} />
          <a href={supplyApi.documents.fileUrl(entityId, doc.id)} target="_blank" rel="noopener noreferrer" className={btnLink}>
            {doc.filename}
          </a>
        </div>
      </div>
      {!data ? (
        <p className={`${warnBox} mt-3`}>{t("Belge okunamadı. Belgeler sekmesinden tekrar okutabilirsin.", "The document could not be read. You can read it again from the Documents tab.")}</p>
      ) : (
        <>
          <p className={`${muted} mt-1`}>
            {t(
              "Bir ölçüyü fiyat kalemine bir kez eşle: tahmin buna göre hesaplanır ve bu tedarikçinin sonraki belgeleri otomatik fiyatlanır.",
              "Map a value to a price item once: the estimate is calculated from it, and this supplier's next documents are priced automatically.",
            )}
          </p>
          {data.measures.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className={rowBorder}>
                    <th className={th}>{t("Ölçü", "Measure")}</th>
                    <th className={th}>{t("Değer", "Value")}</th>
                    <th className={th}>{t("Fiyat kalemi", "Price item")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.measures.map((m) => {
                    const options = priced.filter((i) => dimOf(i.unit) === dimOf(m.unit));
                    const cur = maps.get(m.key) ?? null;
                    return (
                      <tr key={m.key} className={rowBorder}>
                        <td className={td}>{m.label}</td>
                        <td className={td}>
                          {m.text}
                          <span className="ml-1 text-[11px] text-neutral-400">
                            ({fmtQty(m.value, locale)} {unitLabel(m.unit, t)})
                          </span>
                        </td>
                        <td className={td}>
                          <select
                            value={cur ?? ""}
                            disabled={!canMap || busy}
                            onChange={(e) => onMap(m.key, e.target.value ? Number(e.target.value) : null)}
                            className={`${input} max-w-[220px] py-1 text-xs`}
                            aria-label={t("Fiyat kalemi", "Price item")}
                          >
                            <option value="">{options.length ? t("— eşleme yok —", "— not mapped —") : t("uygun birimde kalem yok", "no item with a matching unit")}</option>
                            {options.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({unitLabel(i.unit, t)})
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {measureDims.size > 1 && (
            <p className={`${warnBox} mt-3`}>
              {t(
                "Birden fazla ölçü fiyatlanıyor (ör. süre ve uzunluk ya da delme). Kesimciniz yalnızca birine göre fatura ediyorsa iş iki kez fiyatlanır ve tahmin yüksek çıkar.",
                "More than one measure is priced (e.g. time and length or pierces). If your supplier bills by only one of them, the job is priced twice and the estimate comes out too high.",
              )}
            </p>
          )}
          {data.lines.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <div className={`${muted} mb-1`}>{t("Belgede yazan tutarlar", "Amounts written on the document")}</div>
              <table className="w-full min-w-[520px] text-sm">
                <tbody>
                  {data.lines.map((ln) => {
                    const cur = maps.get(ln.key) ?? null;
                    return (
                      <tr key={ln.key + (ln.amount ?? "")} className={rowBorder}>
                        <td className={td}>
                          {ln.description}
                          {ln.qty ? <span className="ml-1 text-[11px] text-neutral-400">× {fmtQty(ln.qty, locale)}</span> : null}
                        </td>
                        <td className={`${td} whitespace-nowrap text-right font-medium`}>{money(ln.amount, job.currency, locale)}</td>
                        <td className={td}>
                          <select
                            value={cur ?? ""}
                            disabled={!canMap || busy}
                            onChange={(e) => onMap(ln.key, e.target.value ? Number(e.target.value) : null)}
                            className={`${input} max-w-[220px] py-1 text-xs`}
                            aria-label={t("Fiyat kalemi", "Price item")}
                          >
                            <option value="">{t("— tahmine katma —", "— not in estimate —")}</option>
                            {priced.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({unitLabel(i.unit, t)})
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(data.net !== null || data.total !== null) && (
            <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
              {data.net !== null && (
                <>
                  {t("KDV hariç", "Excl. VAT")}: <b>{money(data.net, job.currency, locale)}</b>
                </>
              )}
              {data.total !== null && (
                <span className="ml-3">
                  {t("Genel toplam", "Grand total")}: <b>{money(data.total, job.currency, locale)}</b>
                </span>
              )}
            </p>
          )}
          {data.info.length > 0 && (
            <p className={`${muted} mt-2`}>
              {data.info.map((i) => `${i.label}: ${i.text}`).join(" · ")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function LinesEditor({
  job,
  items,
  currency,
  canEdit,
  busy,
  onSave,
}: {
  job: JobDetail;
  items: PriceItem[];
  currency: string;
  canEdit: boolean;
  busy: boolean;
  onSave: (lines: JobLine[]) => Promise<void>;
}) {
  const { t, locale } = useT();
  const symbol = currencySymbol(currency, locale);
  const [lines, setLines] = useState<JobLine[]>(job.lines);
  const dirty = JSON.stringify(lines) !== JSON.stringify(job.lines);
  const active = items.filter((i) => !i.archived && i.kind !== "minimum");
  const byId = new Map(items.map((i) => [i.id, i]));
  const patch = (i: number, p: Partial<JobLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const amountOf = (l: JobLine) => Math.round(l.qty * l.unit_price * 100) / 100;

  function addItem(id: number) {
    const it = byId.get(id);
    if (!it) return;
    setLines((ls) => [...ls, { price_item_id: it.id, description: it.name, qty: 1, unit: it.unit, unit_price: it.price ?? 0, manual_price: false, source_key: "" }]);
  }

  return (
    <section className={card}>
      <h2 className={h2}>{t("Tahmin satırları", "Estimate lines")}</h2>
      <p className={`${muted} mb-3`}>{t("Fiyat listesinden hesaplanır; tedarikçinin istediği tutarı sağdaki “Gerçek tutar”a yaz.", "Calculated from the price list; enter what the supplier charges as the “Actual amount” on the right.")}</p>
      {lines.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Satır yok.", "No lines.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={rowBorder}>
                <th className={th}>{t("Kalem", "Item")}</th>
                <th className={th}>{t("Miktar", "Qty")}</th>
                <th className={th}>{t("Birim fiyat", "Unit price")}</th>
                <th className={`${th} text-right`}>{t("Tutar", "Amount")}</th>
                {canEdit && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const item = l.price_item_id ? byId.get(l.price_item_id) : undefined;
                return (
                  <tr key={i} className={rowBorder}>
                    <td className={td}>
                      {l.price_item_id ? (
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">{item?.name ?? l.description}</span>
                      ) : canEdit ? (
                        <input value={l.description} onChange={(e) => patch(i, { description: e.target.value })} maxLength={200} className={`${input} w-full`} aria-label={t("Açıklama", "Description")} />
                      ) : (
                        l.description
                      )}
                      {l.source_key && <div className="text-[11px] text-neutral-400">{t("belgeden", "from document")}</div>}
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        {canEdit ? (
                          <NumberInput value={l.qty} onValue={(v) => patch(i, { qty: v })} className={`${input} w-24`} aria-label={t("Miktar", "Qty")} />
                        ) : (
                          fmtQty(l.qty, locale)
                        )}
                        {l.price_item_id || !canEdit ? (
                          <span className={muted}>{unitLabel(l.unit, t)}</span>
                        ) : (
                          <UnitSelect value={l.unit} onChange={(u) => patch(i, { unit: u })} className="py-1 text-xs" />
                        )}
                      </div>
                    </td>
                    <td className={td}>
                      {canEdit && (l.manual_price || !l.price_item_id) ? (
                        <NumberInput value={l.unit_price} onValue={(v) => patch(i, { unit_price: v })} unit={symbol} className={`${input} w-28`} aria-label={t("Birim fiyat", "Unit price")} />
                      ) : (
                        <span>{perUnit(money(l.unit_price, currency, locale), l.unit, t)}</span>
                      )}
                      {canEdit && l.price_item_id && (
                        <label className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          <input type="checkbox" checked={l.manual_price} onChange={(e) => patch(i, { manual_price: e.target.checked, unit_price: e.target.checked ? l.unit_price : item?.price ?? l.unit_price })} className="h-3.5 w-3.5 accent-[#D97757]" />
                          {t("elle fiyat", "manual price")}
                        </label>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right font-medium`}>{money(amountOf(l), currency, locale)}</td>
                    {canEdit && (
                      <td className={`${td} text-right`}>
                        <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className={btnDanger} aria-label={t("Satırı sil", "Remove line")}>
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value="" onChange={(e) => e.target.value && addItem(Number(e.target.value))} className={input} aria-label={t("Listeden kalem ekle", "Add item from list")}>
            <option value="">+ {t("Listeden kalem ekle", "Add item from list")}</option>
            {active.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} — {perUnit(money(i.price, currency, locale), i.unit, t)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { price_item_id: null, description: "", qty: 1, unit: "piece", unit_price: 0, manual_price: true, source_key: "" }])}
            className={btnOutline}
          >
            + {t("Serbest satır", "Free line")}
          </button>
          {dirty && (
            <>
              <button
                type="button"
                disabled={busy || lines.some((l) => !l.price_item_id && !l.description.trim())}
                onClick={() =>
                  void onSave(
                    lines.map((l) => ({ price_item_id: l.price_item_id, description: l.description, qty: l.qty, unit: l.unit, unit_price: l.unit_price, manual_price: l.manual_price, source_key: l.source_key })),
                  )
                }
                className={btnDark}
              >
                {t("Satırları kaydet", "Save lines")}
              </button>
              <button type="button" onClick={() => setLines(job.lines)} className={btnLink}>
                {t("Vazgeç", "Cancel")}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const G = "text-emerald-700 dark:text-emerald-400"; // tutar rengi: yeşil

function Totals({
  job,
  data,
  currency,
  canEdit,
  busy,
  onActual,
}: {
  job: JobDetail;
  data: DocData | null;
  currency: string;
  canEdit: boolean;
  busy: boolean;
  onActual: (v: number | null) => Promise<void>;
}) {
  const { t, locale } = useT();
  const symbol = currencySymbol(currency, locale);
  const [actual, setActual] = useState(job.actual !== null ? String(job.actual) : "");
  const e = job.estimate_totals;
  const row = (k: string, v: number | null, strong = false) => (
    <div className={`flex justify-between gap-3 py-0.5 ${strong ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-300"}`}>
      <span>{k}</span>
      <span>{money(v, currency, locale)}</span>
    </div>
  );
  const noVat = job.vat_rate === 0;
  // Tahmin (lazer + malzeme) ile gerçek tutar arasındaki fark %5'in altındaysa uyarı değil, uyum bilgisi gösterilir.
  const base = e.net + (job.materials?.total ?? 0);
  const close = job.diff !== null && base > 0 && Math.abs(job.diff) / base <= 0.05;
  const parsed = actual.trim() === "" ? null : Number(actual.replace(",", "."));
  const changed = parsed !== job.actual && (parsed === null || (Number.isFinite(parsed) && parsed >= 0));

  return (
    <section className={card}>
      <h2 className={`${h2} mb-2`}>{t("Tutarlar", "Amounts")}</h2>
      <div className="text-sm">
        <div className={muted}>{t("Tahmin (fiyat listesi)", "Estimate (price list)")}</div>
        {row(t("Satırlar", "Lines"), e.lines)}
        {e.minimum_adjust > 0 && row(t("Minimuma tamamlama", "Up to minimum"), e.minimum_adjust)}
        {row(noVat ? t("Toplam (KDV yok)", "Total (no VAT)") : t("KDV hariç", "Excl. VAT"), e.net, true)}
        {!noVat && row(t(`KDV %${job.vat_rate}`, `VAT ${job.vat_rate}%`), e.vat)}
        {!noVat && row(t("Toplam", "Total"), e.total)}
        {job.materials && (
          <div className="mt-3 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <div className={muted}>{t("Malzeme (ürünlerden tahmin)", "Material (estimated from products)")}</div>
            {job.materials.items.map((m) => (
              <Fragment key={`${m.name}-${m.thickness}`}>{row(`${materialLabel(m.type, t) || m.name}${m.thickness ? ` ${m.thickness} mm` : ""} · ${fmtQty(m.kg, locale)} kg`, m.cost)}</Fragment>
            ))}
            {row(t("Malzeme toplamı", "Material total"), job.materials.total, true)}
            {row(t("Tahmin (lazer + malzeme, KDV hariç)", "Estimate (laser + material, excl. VAT)"), e.net + job.materials.total, true)}
          </div>
        )}
      </div>
      <div className="mt-4 border-t border-neutral-100 pt-3 text-sm dark:border-neutral-800">
        <label className={label}>{noVat ? t("Gerçek tutar", "Actual amount") : t("Gerçek tutar (KDV hariç)", "Actual amount (excl. VAT)")}</label>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <DecimalInput value={actual} onValue={setActual} unit={symbol} placeholder={data?.net != null ? String(data.net) : "—"} className={`${input} w-36`} />
            {changed && (
              <button type="button" disabled={busy} onClick={() => void onActual(parsed)} className={btnDark}>
                {t("Kaydet", "Save")}
              </button>
            )}
          </div>
        ) : (
          <div className="font-semibold text-neutral-900 dark:text-neutral-100">{money(job.actual, currency, locale)}</div>
        )}
        {job.actual_totals && !noVat && (
          <div className="mt-2">
            {row(t(`KDV %${job.vat_rate}`, `VAT ${job.vat_rate}%`), job.actual_totals.vat)}
            {row(t("Toplam", "Total"), job.actual_totals.total)}
          </div>
        )}
        {job.diff !== null && job.diff !== 0 && (
          <p className={`mt-2 text-xs font-medium ${close ? G : job.diff > 0 ? "text-red-600 dark:text-red-400" : G}`}>
            {close
              ? t(`Tahminle uyumlu (${job.diff > 0 ? "+" : "−"}${money(Math.abs(job.diff), currency, locale)})`, `In line with the estimate (${job.diff > 0 ? "+" : "−"}${money(Math.abs(job.diff), currency, locale)})`)
              : job.diff > 0
                ? t(`Tahminden ${money(job.diff, currency, locale)} fazla istendi`, `${money(job.diff, currency, locale)} more than the estimate`)
                : t(`Tahminden ${money(-job.diff, currency, locale)} az istendi`, `${money(-job.diff, currency, locale)} less than the estimate`)}
          </p>
        )}
      </div>
      <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950/30">
        <div className={muted}>{t("Maliyet olarak yazılacak", "Will be recorded as cost")}</div>
        <div className={`text-lg font-semibold ${G}`}>{money(job.basis, currency, locale)}</div>
        <div className="text-[11px] text-neutral-400">
          {job.actual !== null ? t("gerçek tutar", "actual amount") : t("tahmin (gerçek tutar girilmedi)", "estimate (no actual amount)")}
          {noVat ? "" : job.vat_in_cost ? t(" + KDV", " + VAT") : t(", KDV hariç", ", excl. VAT")}
        </div>
      </div>
    </section>
  );
}

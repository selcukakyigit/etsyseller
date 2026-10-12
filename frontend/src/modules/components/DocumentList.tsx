"use client";

import { ReactNode, useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/listing-editor/Modal";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { DocumentRow, EntityApi } from "../core/api";
import { errMsg } from "../core/errors";
import { badge, btnDanger, btnLink, muted, rowBorder } from "../core/ui";

/** Belgenin nasıl okunduğu: ücretsiz yollar yeşil, yapay zekâ yolları nötr. */
export function SourceBadge({ source }: { source: string }) {
  const { t } = useT();
  const map: Record<string, [string, string, boolean]> = {
    cache: ["daha önce okunmuş", "read before", true],
    rule: ["kuralla okundu · 0 kredi", "read by rules · 0 credits", true],
    table: ["tablodan okundu · 0 kredi", "read from table · 0 credits", true],
    text: ["metinden okundu", "read from text", false],
    vision: ["görüntüden okundu", "read from image", false],
  };
  const m = map[source];
  if (!m) return <span className={`${badge} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>{t("okunamadı", "not read")}</span>;
  return (
    <span className={`${badge} ${m[2] ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
      {t(m[0], m[1])}
    </span>
  );
}

export default function DocumentList({
  api,
  entityId,
  items,
  canDelete,
  onChanged,
  actions,
}: {
  api: EntityApi;
  entityId: number;
  items: DocumentRow[] | null;
  canDelete: boolean;
  onChanged: () => void;
  actions?: (doc: DocumentRow) => ReactNode;
}) {
  const { t, locale } = useT();
  const [confirm, confirmEl] = useConfirm();
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  if (!items) return <BlockSpinner />;
  if (items.length === 0) return <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz belge yok.", "No documents yet.")}</p>;

  async function remove(doc: DocumentRow) {
    if (!(await confirm({ title: t(`"${doc.filename}" silinsin mi?`, `Delete "${doc.filename}"?`), destructive: true, confirmLabel: t("Sil", "Delete") }))) return;
    try {
      await api.documents.remove(entityId, doc.id);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, t("Silinemedi", "Could not delete")));
    }
  }

  return (
    <>
    <ul>
      {items.map((d) => (
        <li key={d.id} className={`${rowBorder} flex flex-wrap items-center justify-between gap-2 py-2.5 last:border-0`}>
          <div className="min-w-0">
            {d.has_file ? (
              <a href={api.documents.fileUrl(entityId, d.id)} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-100">
                {d.filename}
              </a>
            ) : (
              <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{d.filename}</span>
            )}
            <div className={`${muted} flex flex-wrap items-center gap-1.5`}>
              <SourceBadge source={d.source} />
              <span>
                {(d.size / 1024).toFixed(0)} KB · {d.uploaded_by || "—"} · {new Date(d.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {d.has_file && d.content_type.startsWith("image/") && (
              <button type="button" onClick={() => setPreview(d)} className={btnLink}>
                {t("Önizle", "Preview")}
              </button>
            )}
            {actions?.(d)}
            {canDelete && (
              <button type="button" onClick={() => void remove(d)} className={btnDanger}>
                {t("Sil", "Delete")}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
    {confirmEl}
    {preview && (
      <Modal
        title={preview.filename}
        widthClass="max-w-3xl"
        onClose={() => setPreview(null)}
        footer={
          <>
            <a href={api.documents.fileUrl(entityId, preview.id)} target="_blank" rel="noopener noreferrer" className={btnLink}>
              {t("Yeni sekmede aç", "Open in new tab")}
            </a>
            <button type="button" onClick={() => setPreview(null)} className={btnLink}>
              {t("Kapat", "Close")}
            </button>
          </>
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={api.documents.fileUrl(entityId, preview.id)} alt={preview.filename} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg" />
      </Modal>
    )}
    </>
  );
}

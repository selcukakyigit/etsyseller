"use client";

import { useState } from "react";
import { Button, errorText, useFormat } from "@/components/admin/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n-client";
import { BulkAction, BulkResult, KeywordFilters, researchAdmin } from "@/lib/researchApi";
import { toast } from "@/lib/toast";
import { useRefusedText } from "./shared";

const LIMIT = 1000; // backend `admin_pool.BULK_MAX`

/** Toplu işlem çubuğu: seçili kelimelere, hiçbiri seçili değilse süzgece uyan kelimelere (en çok 1000) uygular. Yıkıcı işlemler onay ister. */
export default function BulkBar({
  selected,
  filters,
  matching,
  capped,
  onDone,
}: {
  selected: number[];
  filters: KeywordFilters;
  matching: number; // süzgece uyan toplam (üst sınırda durabilir)
  capped: boolean;
  onDone: () => void;
}) {
  const { t } = useT();
  const f = useFormat();
  const [confirm, confirmElement] = useConfirm();
  const refusedText = useRefusedText();
  const [action, setAction] = useState<BulkAction | "">("");
  const [busy, setBusy] = useState(false);

  const byIds = selected.length > 0;
  const count = byIds ? selected.length : Math.min(matching, LIMIT);
  const more = !byIds && (capped || matching > LIMIT) ? "+" : "";
  const names: Record<BulkAction, string> = {
    refresh: t("Ölç / yenile", "Measure / refresh"),
    pin: t("Sabitle", "Pin"),
    unpin: t("Sabitlemeyi kaldır", "Unpin"),
    block: t("Engelle", "Block"),
    unblock: t("Engeli kaldır", "Unblock"),
    archive: t("Arşivle", "Archive"),
    unarchive: t("Arşivden çıkar", "Unarchive"),
    delete: t("Sil", "Delete"),
  };

  function summary(a: BulkAction, r: BulkResult): string {
    if (a === "refresh") return t(`${f.num(r.pending)} kelime ${f.num(r.requests)} istekle kuyruğa alındı.`, `${f.num(r.pending)} keywords queued in ${f.num(r.requests)} request(s).`);
    if (a === "delete") {
      const done = t(`${f.num(r.changed)} kelime silindi.`, `${f.num(r.changed)} keywords deleted.`);
      if (r.skipped === 0) return done;
      return `${done} ${t(`${f.num(r.skipped)} kelime bir çalışma alanının kaydı ya da sıra takibinde olduğu için silinmedi.`, `${f.num(r.skipped)} were kept because a workspace saved or tracks them.`)}`;
    }
    return t(`${f.num(r.changed)} kelime güncellendi.`, `${f.num(r.changed)} keywords updated.`);
  }

  async function run() {
    if (!action || count === 0) return;
    if (action === "block" || action === "delete") {
      const ok = await confirm({
        title: action === "delete" ? t("Kelimeler silinsin mi?", "Delete these keywords?") : t("Kelimeler engellensin mi?", "Block these keywords?"),
        message:
          action === "delete"
            ? t(`${f.num(count)} kelime ve tüm ölçüm geçmişi havuzdan silinir. Geri alınamaz.`, `${f.num(count)} keywords and their whole measurement history are deleted from the pool. This cannot be undone.`)
            : t(
                `${f.num(count)} kelime bir daha ölçülmez ve Keşfet ile asistanın önerilerinde görünmez. Engeli sonra kaldırabilirsin.`,
                `${f.num(count)} keywords will no longer be measured and disappear from Discover and assistant suggestions. You can unblock them later.`,
              ),
        confirmLabel: names[action],
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await researchAdmin.bulk(action, byIds ? { ids: selected } : { filters });
      const refused = refusedText(r.refused);
      if (refused && r.pending === 0 && action === "refresh") toast.error(refused);
      else toast.success(summary(action, r));
      setAction("");
      onDone();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900 sm:flex-row sm:items-center">
      {confirmElement}
      <span className="text-neutral-700 dark:text-neutral-300">
        {byIds
          ? t(`${f.num(selected.length)} kelime seçili`, `${f.num(selected.length)} keywords selected`)
          : t(`Seçim yok: işlem süzgece uyan ${f.num(count)}${more} kelimeye uygulanır (en çok ${LIMIT})`, `Nothing selected: the action applies to the ${f.num(count)}${more} keywords matching the filters (max ${LIMIT})`)}
      </span>
      <div className="flex items-center gap-2 sm:ml-auto">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as BulkAction | "")}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          aria-label={t("Toplu işlem", "Bulk action")}
        >
          <option value="">{t("İşlem seç…", "Choose action…")}</option>
          {(Object.keys(names) as BulkAction[]).map((a) => (
            <option key={a} value={a}>
              {names[a]}
            </option>
          ))}
        </select>
        <Button tone={action === "delete" || action === "block" ? "danger" : "primary"} busy={busy} disabled={!action || count === 0} onClick={() => void run()}>
          {t("Uygula", "Apply")}
        </Button>
      </div>
    </div>
  );
}

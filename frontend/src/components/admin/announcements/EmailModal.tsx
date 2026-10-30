"use client";

import { useState } from "react";
import { Badge, Field, errorText, inputClass, useFormat } from "@/components/admin/ui";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AdminBroadcast, AdminBroadcastInput, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

const EMPTY: AdminBroadcastInput = { subject_tr: "", subject_en: "", body_tr: "", body_en: "" };
const pick = (b: AdminBroadcastInput): AdminBroadcastInput => ({ subject_tr: b.subject_tr, subject_en: b.subject_en, body_tr: b.body_tr, body_en: b.body_en });

/** Yeni e-posta / taslağı düzenle / gönderilmişi görüntüle penceresi. Taslak: kaydet, kendine test, herkese gönder. Gönderilmiş: yalnızca okunur. */
export default function EmailModal({
  broadcast,
  copyOf,
  onClose,
  onChanged,
}: {
  broadcast: AdminBroadcast | null;
  copyOf: AdminBroadcast | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const f = useFormat();
  const [form, setForm] = useState<AdminBroadcastInput>(broadcast ? pick(broadcast) : copyOf ? pick(copyOf) : EMPTY);
  // Taslak ilk kaydedilince kimliği buradan sürer: aynı pencerede ikinci kayıt yeni satır açmaz.
  const [draftId, setDraftId] = useState<number | null>(broadcast?.status === "draft" ? broadcast.id : null);
  const [busy, setBusy] = useState<"save" | "test" | "send" | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const readOnly = !!broadcast && broadcast.status !== "draft";

  const set = (patch: Partial<AdminBroadcastInput>) => setForm((current) => ({ ...current, ...patch }));
  const filled = form.subject_tr.trim().length >= 3 && form.subject_en.trim().length >= 3 && form.body_tr.trim().length >= 10 && form.body_en.trim().length >= 10;
  const anything = Object.values(form).some((v) => v.trim());

  async function run(kind: "save" | "test" | "send", action: () => Promise<void>) {
    setBusy(kind);
    try {
      await action();
    } catch (e) {
      const msg = errorText(e);
      if (msg) toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft(): Promise<number> {
    const saved = draftId ? await api.admin.updateBroadcast(draftId, form) : await api.admin.createBroadcast(form);
    setDraftId(saved.id);
    onChanged();
    return saved.id;
  }

  const save = () =>
    run("save", async () => {
      await saveDraft();
      toast.success(t("Taslak kaydedildi", "Draft saved"));
      onClose();
    });

  const test = () =>
    run("test", async () => {
      await api.admin.broadcastTest(form);
      toast.success(t("Test e-postaları adresine gönderildi (Türkçe ve İngilizce)", "Test emails sent to your address (Turkish and English)"));
    });

  const send = () =>
    run("send", async () => {
      const preview = await api.admin.broadcastPreview();
      if (!preview.configured) {
        toast.error(t("E-posta gönderimi yapılandırılmamış.", "Email sending is not configured."));
        return;
      }
      const ok = await confirm({
        title: t("E-posta herkese gönderilsin mi?", "Send the email to everyone?"),
        message: t(
          `${f.num(preview.recipients)} kullanıcıya gönderilecek (${f.num(preview.tr)} Türkçe, ${f.num(preview.en)} İngilizce). Geri alınamaz.`,
          `It will be sent to ${f.num(preview.recipients)} users (${f.num(preview.tr)} Turkish, ${f.num(preview.en)} English). This cannot be undone.`,
        ),
        confirmLabel: t("Gönder", "Send"),
        destructive: true,
      });
      if (!ok) return;
      const id = await saveDraft();
      await api.admin.sendBroadcast(id, preview.recipients);
      toast.success(t("Gönderim başladı", "Sending started"));
      onChanged();
      onClose();
    });

  const title = readOnly ? t("Gönderilmiş e-posta", "Sent email") : draftId ? t("Taslağı düzenle", "Edit draft") : t("Yeni e-posta", "New email");

  return (
    <Modal
      title={title}
      widthClass="max-w-3xl"
      sheet
      closeButton
      onClose={onClose}
      footer={
        readOnly ? (
          <>
            <span />
            <button type="button" className={btnGhost} onClick={onClose}>
              {t("Kapat", "Close")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={btnGhost} disabled={busy !== null || !filled} onClick={() => void test()}>
              {busy === "test" ? t("Gönderiliyor…", "Sending…") : t("Kendime test gönder", "Send myself a test")}
            </button>
            <div className="flex items-center gap-2">
              <button type="button" className={btnGhost} disabled={busy !== null || !anything} onClick={() => void save()}>
                {busy === "save" ? t("Kaydediliyor…", "Saving…") : t("Taslak kaydet", "Save draft")}
              </button>
              <button type="button" className={btnPrimary} disabled={busy !== null || !filled} onClick={() => void send()}>
                {busy === "send" ? t("Gönderiliyor…", "Sending…") : t("Herkese gönder…", "Send to everyone…")}
              </button>
            </div>
          </>
        )
      }
    >
      <div className="min-h-[26rem] space-y-4">
        {readOnly && broadcast && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <Badge tone={broadcast.status === "done" ? "good" : broadcast.status === "sending" ? "warn" : "bad"}>
              {broadcast.status === "done" ? t("Gönderildi", "Sent") : broadcast.status === "sending" ? t("Gönderiliyor", "Sending") : t("Yarım kaldı", "Interrupted")}
            </Badge>
            <span className="tabular-nums">
              {f.num(broadcast.sent)} / {f.num(broadcast.total)}
            </span>
            {broadcast.failed > 0 && <Badge tone="bad">{t(`${f.num(broadcast.failed)} gönderilemedi`, `${f.num(broadcast.failed)} failed`)}</Badge>}
            <span>{f.dateTime(broadcast.started_at)}</span>
            <span>{broadcast.created_by}</span>
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Konu (Türkçe)", "Subject (Turkish)")}>
            <input value={form.subject_tr} maxLength={150} readOnly={readOnly} onChange={(e) => set({ subject_tr: e.target.value })} className={inputClass} />
          </Field>
          <Field label={t("Konu (İngilizce)", "Subject (English)")}>
            <input value={form.subject_en} maxLength={150} readOnly={readOnly} onChange={(e) => set({ subject_en: e.target.value })} className={inputClass} />
          </Field>
          <Field label={t("Metin (Türkçe)", "Body (Turkish)")}>
            <textarea value={form.body_tr} maxLength={5000} readOnly={readOnly} onChange={(e) => set({ body_tr: e.target.value })} className={`${inputClass} h-56 resize-none`} />
          </Field>
          <Field label={t("Metin (İngilizce)", "Body (English)")}>
            <textarea value={form.body_en} maxLength={5000} readOnly={readOnly} onChange={(e) => set({ body_en: e.target.value })} className={`${inputClass} h-56 resize-none`} />
          </Field>
        </div>
      </div>
      {confirmElement}
    </Modal>
  );
}

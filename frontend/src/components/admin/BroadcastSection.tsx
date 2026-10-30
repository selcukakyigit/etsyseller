"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Field, Section, errorText, inputClass, useFormat } from "@/components/admin/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import HelpTip from "@/components/ui/HelpTip";
import { AdminBroadcastInput, AdminBroadcastStatus, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

const EMPTY: AdminBroadcastInput = { subject_tr: "", subject_en: "", body_tr: "", body_en: "" };

/** Yönetim > Duyuru > E-posta: aktif kullanıcıların hepsine hizmet duyurusu. Önce kendine test, sonra alıcı sayısı onaylanarak gönderilir. */
export default function BroadcastSection() {
  const { t } = useT();
  const f = useFormat();
  const [form, setForm] = useState<AdminBroadcastInput>(EMPTY);
  const [status, setStatus] = useState<AdminBroadcastStatus | null>(null);
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [confirm, confirmElement] = useConfirm();

  const valid = form.subject_tr.trim().length >= 3 && form.subject_en.trim().length >= 3 && form.body_tr.trim().length >= 10 && form.body_en.trim().length >= 10;
  const sending = status?.state === "sending";

  // Açılışta son durum alınır; gönderim sürerken 2 sn'de bir yenilenir.
  useEffect(() => {
    let alive = true;
    const load = () => void api.admin.broadcastStatus().then((s) => alive && setStatus(s)).catch(() => undefined);
    load();
    if (!sending) return () => { alive = false; };
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sending]);

  const set = (patch: Partial<AdminBroadcastInput>) => setForm((current) => ({ ...current, ...patch }));
  const clean = (): AdminBroadcastInput => ({
    subject_tr: form.subject_tr.trim(), subject_en: form.subject_en.trim(), body_tr: form.body_tr.trim(), body_en: form.body_en.trim(),
  });

  async function run(kind: "test" | "send", action: () => Promise<void>) {
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

  const sendTest = () =>
    run("test", async () => {
      await api.admin.broadcastTest(clean());
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
        title: t("E-posta duyurusu gönderilsin mi?", "Send the email announcement?"),
        message: t(
          `${f.num(preview.recipients)} kullanıcıya gönderilecek (${f.num(preview.tr)} Türkçe, ${f.num(preview.en)} İngilizce). Geri alınamaz.`,
          `It will be sent to ${f.num(preview.recipients)} users (${f.num(preview.tr)} Turkish, ${f.num(preview.en)} English). This cannot be undone.`,
        ),
        confirmLabel: t("Gönder", "Send"),
        destructive: true,
      });
      if (!ok) return;
      setStatus(await api.admin.broadcastSend(clean(), preview.recipients));
    });

  return (
    <Section
      title={t("E-posta ile duyuru", "Email announcement")}
      action={
        <HelpTip align="right">
          {t(
            "Askıda ve engelli olmayan tüm kullanıcılara, kendi dillerinde gönderilir. Yalnızca hesapla ilgili hizmet bildirimleri içindir (bakım, önemli değişiklik); pazarlama için değil, çünkü abonelikten çıkma yoktur. Önce kendine test gönder. Gönderim sürerken sayfayı kapatabilirsin; sunucu yeniden başlarsa yarım kalır. İki gönderim arasında 10 dakika beklenir.",
            "Goes to every user who is not suspended or blocked, in their own language. For account-related service notices only (maintenance, important changes), not marketing, because there is no unsubscribe. Send yourself a test first. You can close the page while it sends; a server restart cuts it short. There is a 10-minute wait between sends.",
          )}
        </HelpTip>
      }
    >
      <div className="max-w-2xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Konu (Türkçe)", "Subject (Turkish)")}>
            <input value={form.subject_tr} maxLength={150} onChange={(e) => set({ subject_tr: e.target.value })} className={inputClass} />
          </Field>
          <Field label={t("Konu (İngilizce)", "Subject (English)")}>
            <input value={form.subject_en} maxLength={150} onChange={(e) => set({ subject_en: e.target.value })} className={inputClass} />
          </Field>
          <Field label={t("Metin (Türkçe)", "Body (Turkish)")}>
            <textarea value={form.body_tr} maxLength={5000} rows={6} onChange={(e) => set({ body_tr: e.target.value })} className={`${inputClass} h-36 resize-none`} />
          </Field>
          <Field label={t("Metin (İngilizce)", "Body (English)")}>
            <textarea value={form.body_en} maxLength={5000} rows={6} onChange={(e) => set({ body_en: e.target.value })} className={`${inputClass} h-36 resize-none`} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button busy={busy === "test"} disabled={!valid || busy !== null || sending} onClick={() => void sendTest()}>
            {t("Kendime test gönder", "Send myself a test")}
          </Button>
          <Button tone="primary" busy={busy === "send"} disabled={!valid || busy !== null || sending} onClick={() => void send()}>
            {t("Herkese gönder…", "Send to everyone…")}
          </Button>
        </div>

        {status && status.state !== "idle" && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300" aria-live="polite">
            {sending ? <Badge tone="warn">{t("Gönderiliyor", "Sending")}</Badge> : <Badge tone="good">{t("Tamamlandı", "Done")}</Badge>}
            <span className="tabular-nums">
              {f.num(status.sent + status.failed)} / {f.num(status.total)}
            </span>
            {status.failed > 0 && <Badge tone="bad">{t(`${f.num(status.failed)} gönderilemedi`, `${f.num(status.failed)} failed`)}</Badge>}
            {status.started_at && <span className="text-xs text-neutral-500 dark:text-neutral-400">{f.dateTime(status.started_at)}</span>}
          </p>
        )}
      </div>
      {confirmElement}
    </Section>
  );
}

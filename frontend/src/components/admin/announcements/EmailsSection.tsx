"use client";

import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, Section, errorText, useFormat } from "@/components/admin/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { AdminBroadcast, AdminBroadcastStatus, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import EmailModal from "./EmailModal";

const STATUS: Record<AdminBroadcastStatus, { tone: "muted" | "warn" | "good" | "bad"; tr: string; en: string }> = {
  draft: { tone: "muted", tr: "Taslak", en: "Draft" },
  sending: { tone: "warn", tr: "Gönderiliyor", en: "Sending" },
  done: { tone: "good", tr: "Gönderildi", en: "Sent" },
  interrupted: { tone: "bad", tr: "Yarım kaldı", en: "Interrupted" },
};

/** E-postalar sekmesi: taslaklar ve gönderilmiş e-postaların geçmişi. Gönderim sürerken liste kendiliğinden yenilenir. */
export default function EmailsSection() {
  const { t } = useT();
  const f = useFormat();
  const { data, error, reload } = useApiData("admin:broadcasts", api.admin.broadcasts);
  // `copyOf`: gönderilmiş e-postanın metniyle açılan yeni taslak. `open`: düzenlenen/görüntülenen kayıt ("new": boş yeni).
  const [modal, setModal] = useState<{ open: AdminBroadcast | "new"; copyOf?: AdminBroadcast } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const sending = !!data?.some((b) => b.status === "sending");

  useEffect(() => {
    if (!sending) return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [sending, reload]);

  async function remove(b: AdminBroadcast) {
    if (!(await confirm({ title: t("Taslak silinsin mi?", "Delete the draft?"), message: b.subject_tr || b.subject_en, confirmLabel: t("Sil", "Delete"), destructive: true }))) return;
    try {
      await api.admin.deleteBroadcast(b.id);
      reload();
    } catch (e) {
      const msg = errorText(e);
      if (msg) toast.error(msg);
    }
  }

  return (
    <Section
      title={t("Toplu e-postalar", "Email announcements")}
      action={
        <div className="flex items-center gap-2">
          <HelpTip align="right">
            {t(
              "Askıda ve engelli olmayan tüm kullanıcılara, kendi dillerinde gider. Yalnızca hesapla ilgili hizmet bildirimleri içindir (bakım, önemli değişiklik); pazarlama için değil, çünkü abonelikten çıkma yoktur. Önce kendine test gönder. Gönderilmiş e-posta değişmez, geçmişte kalır. İki gönderim arasında 10 dakika beklenir; sunucu yeniden başlarsa süren gönderim yarım kalır.",
              "Goes to every user who is not suspended or blocked, in their own language. For account-related service notices only (maintenance, important changes), not marketing, because there is no unsubscribe. Send yourself a test first. A sent email never changes; it stays in the history. There is a 10-minute wait between sends; a server restart cuts a running send short.",
            )}
          </HelpTip>
          <Button tone="primary" onClick={() => setModal({ open: "new" })}>
            {t("Yeni e-posta", "New email")}
          </Button>
        </div>
      }
    >
      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.length === 0 && <EmptyState>{t("Henüz e-posta yok.", "No emails yet.")}</EmptyState>}
      {data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                <th className="pb-2 pr-3 font-medium">{t("Konu", "Subject")}</th>
                <th className="pb-2 pr-3 font-medium">{t("Durum", "Status")}</th>
                <th className="pb-2 pr-3 text-right font-medium">{t("Gönderilen", "Delivered")}</th>
                <th className="pb-2 pr-3 font-medium">{t("Tarih", "Date")}</th>
                <th className="pb-2 text-right font-medium">
                  <span className="sr-only">{t("İşlemler", "Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.map((b) => {
                const st = STATUS[b.status];
                return (
                  <tr key={b.id} className="align-top text-neutral-800 dark:text-neutral-200">
                    <td className="max-w-xs py-3 pr-3">
                      <p className="line-clamp-1 break-words">{b.subject_tr || "—"}</p>
                      <p className="line-clamp-1 break-words text-xs text-neutral-500 dark:text-neutral-400">{b.subject_en}</p>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge tone={st.tone}>{t(st.tr, st.en)}</Badge>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-right tabular-nums">
                      {b.status === "draft" ? "—" : `${f.num(b.sent)} / ${f.num(b.total)}`}
                      {b.failed > 0 && <span className="ml-1 text-xs text-red-600 dark:text-red-400">({t(`${f.num(b.failed)} hata`, `${f.num(b.failed)} failed`)})</span>}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-xs text-neutral-500 dark:text-neutral-400">{f.dateTime(b.started_at ?? b.created_at)}</td>
                    <td className="whitespace-nowrap py-3 text-right">
                      <Button className="mr-1.5 px-2 py-1 text-xs" onClick={() => setModal({ open: b })}>
                        {b.status === "draft" ? t("Düzenle", "Edit") : t("Görüntüle", "View")}
                      </Button>
                      {b.status === "draft" ? (
                        <Button tone="danger" className="px-2 py-1 text-xs" onClick={() => void remove(b)}>
                          {t("Sil", "Delete")}
                        </Button>
                      ) : (
                        <Button className="px-2 py-1 text-xs" onClick={() => setModal({ open: "new", copyOf: b })}>
                          {t("Kopyala", "Copy")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {modal && (
        <EmailModal
          broadcast={modal.open === "new" ? null : modal.open}
          copyOf={modal.copyOf ?? null}
          onClose={() => setModal(null)}
          onChanged={reload}
        />
      )}
      {confirmElement}
    </Section>
  );
}

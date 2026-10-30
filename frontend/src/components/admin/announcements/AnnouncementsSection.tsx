"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Section, Toggle, errorText, useFormat } from "@/components/admin/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { AdminAnnouncement, AdminAnnouncementInput, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import AnnouncementModal from "./AnnouncementModal";

/** Duyurular sekmesi: liste, aç/kapa, düzenle, sil. "Yeni duyuru" ve "Düzenle" aynı pencereyi açar. */
export default function AnnouncementsSection() {
  const { t } = useT();
  const f = useFormat();
  const { data, error, reload } = useApiData("admin:announcements", api.admin.announcements);
  const [editing, setEditing] = useState<AdminAnnouncement | "new" | null>(null);
  const [confirm, confirmElement] = useConfirm();

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      reload();
    } catch (e) {
      const msg = errorText(e);
      if (msg) toast.error(msg);
    }
  }

  const toggle = (a: AdminAnnouncement, active: boolean) => {
    const body: AdminAnnouncementInput = { active, tone: a.tone, text_tr: a.text_tr, text_en: a.text_en, ends_at: a.ends_at };
    return run(() => api.admin.updateAnnouncement(a.id, body));
  };

  async function remove(a: AdminAnnouncement) {
    if (!(await confirm({ title: t("Duyuru silinsin mi?", "Delete the announcement?"), message: a.text_tr, confirmLabel: t("Sil", "Delete"), destructive: true }))) return;
    await run(() => api.admin.deleteAnnouncement(a.id));
  }

  return (
    <Section
      title={t("Uygulama içi duyurular", "In-app announcements")}
      action={
        <div className="flex items-center gap-2">
          <HelpTip align="right">
            {t(
              "Aktif ve süresi dolmamış duyuruların hepsi, giriş yapmış herkesin sayfasının üstünde alt alta bant olarak görünür. Kullanıcı bir bandı kapatabilir; metin değişirse yeniden görünür. Her iki dilde de metin gerekir. Bitiş zamanı boşsa duyuru siz kapatana kadar kalır.",
              "Every active, unexpired announcement shows as a banner at the top of every signed-in page, one under another. Users can dismiss a banner; it comes back if the text changes. Text is required in both languages. With no end time it stays until you turn it off.",
            )}
          </HelpTip>
          <Button tone="primary" onClick={() => setEditing("new")}>
            {t("Yeni duyuru", "New announcement")}
          </Button>
        </div>
      }
    >
      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.length === 0 && <EmptyState>{t("Henüz duyuru yok.", "No announcements yet.")}</EmptyState>}
      {data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                <th className="pb-2 pr-3 font-medium">{t("Durum", "Status")}</th>
                <th className="pb-2 pr-3 font-medium">{t("Metin", "Text")}</th>
                <th className="pb-2 pr-3 font-medium">{t("Bitiş", "Ends")}</th>
                <th className="pb-2 text-right font-medium">
                  <span className="sr-only">{t("İşlemler", "Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.map((a) => (
                <tr key={a.id} className="align-top text-neutral-800 dark:text-neutral-200">
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <Toggle checked={a.active} disabled={a.expired} onChange={(v) => void toggle(a, v)} label={t("Duyuru açık", "Announcement on")} />
                      {a.expired ? <Badge tone="warn">{t("Süresi doldu", "Expired")}</Badge> : a.active ? <Badge tone="good">{t("Aktif", "Active")}</Badge> : <Badge tone="muted">{t("Pasif", "Inactive")}</Badge>}
                    </div>
                  </td>
                  <td className="max-w-md py-3 pr-3">
                    <p className="flex items-start gap-1.5">
                      {a.tone === "warning" && <Badge tone="warn">{t("Uyarı", "Warning")}</Badge>}
                      <span className="line-clamp-2 break-words">{a.text_tr}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-1 break-words text-xs text-neutral-500 dark:text-neutral-400">{a.text_en}</p>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3 text-xs text-neutral-500 dark:text-neutral-400">{a.ends_at ? f.dateTime(a.ends_at) : t("Süresiz", "No end")}</td>
                  <td className="whitespace-nowrap py-3 text-right">
                    <Button className="mr-1.5 px-2 py-1 text-xs" onClick={() => setEditing(a)}>
                      {t("Düzenle", "Edit")}
                    </Button>
                    <Button tone="danger" className="px-2 py-1 text-xs" onClick={() => void remove(a)}>
                      {t("Sil", "Delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <AnnouncementModal
          announcement={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {confirmElement}
    </Section>
  );
}

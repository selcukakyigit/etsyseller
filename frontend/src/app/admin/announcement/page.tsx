"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import BroadcastSection from "@/components/admin/BroadcastSection";
import { Button, Field, Section, Toggle, errorText, inputClass } from "@/components/admin/ui";
import AnnouncementView from "@/components/layout/AnnouncementBar";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { AdminAnnouncement, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";

export default function AdminAnnouncementPage() {
  return (
    <AdminShell current="/admin/announcement">
      <div className="space-y-6">
        <Announcement />
        <BroadcastSection />
      </div>
    </AdminShell>
  );
}

/** ISO (UTC) <-> `datetime-local` (yerel saat) çevirisi: yönetici kendi saatini yazar, sunucuya UTC gider. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

function Announcement() {
  const { t } = useT();
  const { data, error } = useApiData("admin:announcement", api.admin.announcement);
  const [form, setForm] = useState<AdminAnnouncement | null>(null);
  const [saving, setSaving] = useState(false);

  // Sunucudaki değer ilk geldiğinde forma yazılır; sonrası yöneticinin düzenlemesidir.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setForm((current) => current ?? data);
  }, [data]);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!form) return <BlockSpinner />;
  const set = (patch: Partial<AdminAnnouncement>) => setForm({ ...form, ...patch });

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      setForm(await api.admin.saveAnnouncement(form));
      toast.success(t("Duyuru kaydedildi", "Announcement saved"));
    } catch (e) {
      const msg = errorText(e);
      if (msg) toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title={t("Uygulama içi duyuru", "In-app announcement")}
      action={
        <HelpTip align="right">
          {t(
            "Açıkken giriş yapmış herkesin sayfasının üstünde bir bant görünür (bakım, yeni özellik). Kullanıcı kapatabilir; metin değişirse yeniden görünür. Her iki dilde de metin gerekir. Bitiş zamanı boşsa duyuru siz kapatana kadar kalır.",
            "While on, a banner shows at the top of every signed-in page (maintenance, new feature). Users can dismiss it; it comes back if the text changes. Text is required in both languages. With no end time it stays until you turn it off.",
          )}
        </HelpTip>
      }
    >
      <div className="max-w-2xl space-y-4">
        <div className="flex items-center gap-3">
          <Toggle checked={form.active} onChange={(active) => set({ active })} label={t("Duyuru açık", "Announcement on")} />
          <span className="text-sm text-neutral-700 dark:text-neutral-300">{form.active ? t("Yayında", "Live") : t("Kapalı", "Off")}</span>
        </div>
        <Field label={t("Tür", "Type")}>
          <select value={form.tone} onChange={(e) => set({ tone: e.target.value as AdminAnnouncement["tone"] })} className={inputClass}>
            <option value="info">{t("Bilgi", "Info")}</option>
            <option value="warning">{t("Uyarı (bakım gibi)", "Warning (like maintenance)")}</option>
          </select>
        </Field>
        <Field label={t("Türkçe metin", "Turkish text")}>
          <textarea value={form.text_tr} maxLength={400} rows={2} onChange={(e) => set({ text_tr: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t("İngilizce metin", "English text")}>
          <textarea value={form.text_en} maxLength={400} rows={2} onChange={(e) => set({ text_en: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t("Bitiş zamanı (isteğe bağlı)", "End time (optional)")}>
          <input type="datetime-local" value={toLocalInput(form.ends_at)} onChange={(e) => set({ ends_at: fromLocalInput(e.target.value) })} className={inputClass} />
        </Field>

        {(form.text_tr || form.text_en) && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Önizleme", "Preview")}</p>
            {form.text_tr && <AnnouncementView tone={form.tone} text={form.text_tr} />}
            {form.text_en && <AnnouncementView tone={form.tone} text={form.text_en} />}
          </div>
        )}

        <Button tone="primary" busy={saving} onClick={() => void save()}>
          {t("Kaydet", "Save")}
        </Button>
      </div>
    </Section>
  );
}

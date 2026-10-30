"use client";

import { useState } from "react";
import { Field, Toggle, errorText, inputClass } from "@/components/admin/ui";
import AnnouncementView from "@/components/layout/AnnouncementBar";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { AdminAnnouncement, AdminAnnouncementInput, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

const EMPTY: AdminAnnouncementInput = { active: true, tone: "info", text_tr: "", text_en: "", ends_at: null };

/** ISO (UTC) <-> `datetime-local` (yerel saat): yönetici kendi saatini yazar, sunucuya UTC gider. */
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

/** Yeni duyuru / düzenle penceresi. Boyut sabit: önizleme alanı metin boşken de yer tutar, pencere yazdıkça zıplamaz. */
export default function AnnouncementModal({ announcement, onClose, onSaved }: { announcement: AdminAnnouncement | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState<AdminAnnouncementInput>(
    announcement ? { active: announcement.active, tone: announcement.tone, text_tr: announcement.text_tr, text_en: announcement.text_en, ends_at: announcement.ends_at } : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<AdminAnnouncementInput>) => setForm((current) => ({ ...current, ...patch }));
  const valid = form.text_tr.trim().length > 0 && form.text_en.trim().length > 0;

  async function save() {
    setSaving(true);
    try {
      const body = { ...form, text_tr: form.text_tr.trim(), text_en: form.text_en.trim() };
      if (announcement) await api.admin.updateAnnouncement(announcement.id, body);
      else await api.admin.createAnnouncement(body);
      toast.success(t("Duyuru kaydedildi", "Announcement saved"));
      onSaved();
    } catch (e) {
      const msg = errorText(e);
      if (msg) toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={announcement ? t("Duyuruyu düzenle", "Edit announcement") : t("Yeni duyuru", "New announcement")}
      widthClass="max-w-xl"
      sheet
      closeButton
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={onClose}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button type="button" className={btnPrimary} disabled={!valid || saving} onClick={() => void save()}>
            {saving ? t("Kaydediliyor…", "Saving…") : t("Kaydet", "Save")}
          </button>
        </>
      }
    >
      <div className="min-h-[30rem] space-y-4">
        <div className="flex items-center gap-3">
          <Toggle checked={form.active} onChange={(active) => set({ active })} label={t("Duyuru açık", "Announcement on")} />
          <span className="text-sm text-neutral-700 dark:text-neutral-300">{form.active ? t("Aktif: hemen yayınlanır", "Active: shown right away") : t("Pasif: yayınlanmaz", "Inactive: not shown")}</span>
        </div>
        <Field label={t("Tür", "Type")}>
          <select value={form.tone} onChange={(e) => set({ tone: e.target.value as AdminAnnouncementInput["tone"] })} className={inputClass}>
            <option value="info">{t("Bilgi", "Info")}</option>
            <option value="warning">{t("Uyarı (bakım gibi)", "Warning (like maintenance)")}</option>
          </select>
        </Field>
        <Field label={t("Türkçe metin", "Turkish text")}>
          <textarea value={form.text_tr} maxLength={400} rows={2} onChange={(e) => set({ text_tr: e.target.value })} className={`${inputClass} h-16 resize-none`} />
        </Field>
        <Field label={t("İngilizce metin", "English text")}>
          <textarea value={form.text_en} maxLength={400} rows={2} onChange={(e) => set({ text_en: e.target.value })} className={`${inputClass} h-16 resize-none`} />
        </Field>
        <Field label={t("Bitiş zamanı (isteğe bağlı)", "End time (optional)")}>
          <input type="datetime-local" value={toLocalInput(form.ends_at)} onChange={(e) => set({ ends_at: fromLocalInput(e.target.value) })} className={inputClass} />
        </Field>
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Önizleme", "Preview")}</p>
          <div className="min-h-[5.5rem] space-y-2">
            {form.text_tr && <AnnouncementView tone={form.tone} text={form.text_tr} />}
            {form.text_en && <AnnouncementView tone={form.tone} text={form.text_en} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

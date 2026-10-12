"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { Entity, EntityApi } from "../core/api";
import { errMsg } from "../core/errors";
import { btnDanger, btnDark, btnOutline, card, h2, input, label, muted } from "../core/ui";
import EntityFields, { entityFieldsFrom, parseEntityFields } from "./EntityFields";
import EntityImagePicker from "./EntityImagePicker";

/** Kaydın ayarlar kartı (her modülde aynı): logo, temel alanlar, iletişim, iç not, arşiv ve kalıcı silme.
 * `deleteWarningTr/En`: silmede neyin gideceğini modül söyler (ör. "işleri ve belgeleri"). */
export default function EntitySettings({
  api,
  entity,
  backHref,
  labelTitleTr,
  labelTitleEn,
  deleteWarningTr,
  deleteWarningEn,
  onChanged,
}: {
  api: EntityApi;
  entity: Entity;
  backHref: string;
  labelTitleTr: string;
  labelTitleEn: string;
  deleteWarningTr: string;
  deleteWarningEn: string;
  onChanged: () => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const [fields, setFields] = useState(() => entityFieldsFrom(entity));
  const [contact, setContact] = useState(entity.contact_email ?? "");
  const [note, setNote] = useState(entity.note ?? "");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");

  async function run(fn: () => Promise<unknown>, fallback: string, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, fallback));
    }
    setBusy(false);
  }

  function save() {
    const parsed = parseEntityFields(fields, t);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    void run(() => api.update(entity.id, { ...parsed.value, contact_email: contact.trim(), note }), t("Kaydedilemedi", "Could not save"), t("Kaydedildi", "Saved"));
  }

  async function remove() {
    setBusy(true);
    try {
      await api.remove(entity.id, typed);
      toast.success(t("Silindi", "Deleted"));
      router.push(backHref);
    } catch (e) {
      toast.error(errMsg(e, t("Silinemedi", "Could not delete")));
      setBusy(false);
    }
  }

  return (
    <section className={card}>
      <h2 className={`${h2} mb-3`}>{t("Ayarlar", "Settings")}</h2>
      <div className="mb-4">
        <EntityImagePicker api={api} entity={entity} onChanged={onChanged} />
      </div>
      <EntityFields value={fields} onChange={setFields} labelTitle={t(labelTitleTr, labelTitleEn)} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>{t("İletişim e-postası", "Contact email")}</label>
          <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={255} className={`${input} w-full`} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>{t("Not (yalnızca sen görürsün)", "Note (only you see it)")}</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={5000} className={`${input} w-full`} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className={btnDark}>
          {t("Kaydet", "Save")}
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => api.archive(entity.id, !entity.archived), t("İşlem başarısız", "Action failed"))} className={btnOutline}>
          {entity.archived ? t("Arşivden çıkar", "Restore") : t("Arşivle", "Archive")}
        </button>
        <button type="button" onClick={() => setDeleting((v) => !v)} className={btnDanger}>
          {t("Kalıcı olarak sil…", "Delete permanently…")}
        </button>
      </div>
      {entity.archived && <p className={`${muted} mt-2`}>{t("Arşivli kayıt davetli kişilere kapalıdır.", "An archived record is closed to invited people.")}</p>}
      {deleting && (
        <div className="mt-3 rounded-lg border border-red-200 p-3 dark:border-red-900">
          <p className="text-xs text-red-700 dark:text-red-300">
            {t(`${deleteWarningTr} Onay için adını yaz: ${entity.name}`, `${deleteWarningEn} Type its name to confirm: ${entity.name}`)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className={`${input} w-56`} aria-label={t("Ad", "Name")} />
            <button
              type="button"
              disabled={busy || typed.trim() !== entity.name}
              onClick={() => void remove()}
              className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
            >
              {t("Sil", "Delete")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Davetli (misafir) kullanıcının gördüğü kart: kaydın paylaşıldığını anlatır, erişimden ayrılma sunar. */
export function EntityGuestNotice({ api, entityId, backHref, bodyTr, bodyEn }: { api: EntityApi; entityId: number; backHref: string; bodyTr: string; bodyEn: string }) {
  const { t } = useT();
  const router = useRouter();
  const [confirm, confirmEl] = useConfirm();
  return (
    <section className={card}>
      <h2 className={h2}>{t("Paylaşılan kayıt", "Shared record")}</h2>
      <p className={`${muted} mt-1`}>{t(bodyTr, bodyEn)}</p>
      <button
        type="button"
        className={`${btnDanger} mt-3`}
        onClick={async () => {
          if (!(await confirm({ title: t("Erişimden ayrılmak istiyor musun?", "Leave this record?"), destructive: true, confirmLabel: t("Ayrıl", "Leave") }))) return;
          try {
            await api.sharing.leave(entityId);
            router.push(backHref);
          } catch (e) {
            toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
          }
        }}
      >
        {t("Erişimden ayrıl", "Leave")}
      </button>
      {confirmEl}
    </section>
  );
}

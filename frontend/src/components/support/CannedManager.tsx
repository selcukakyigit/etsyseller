"use client";

import { useState } from "react";
import { Button, Field, inputClass } from "@/components/admin/ui";
import { useT } from "@/lib/i18n-client";
import { adminTicketsApi, CannedReply } from "@/lib/supportApi";
import { toast } from "@/lib/toast";

/** Hazır yanıtları ekleme, düzenleme ve silme (yönetici). Liste üst bileşende durur ki yanıt kutusu aynı veriyi kullansın. */
export default function CannedManager({ replies, onChange }: { replies: CannedReply[]; onChange: (next: CannedReply[]) => void }) {
  const { t } = useT();
  const [editing, setEditing] = useState<{ id: number | null; title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const saved = await adminTicketsApi.saveCanned(editing.id, { title: editing.title, body: editing.body });
      onChange(editing.id ? replies.map((r) => (r.id === saved.id ? saved : r)) : [...replies, saved]);
      setEditing(null);
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await adminTicketsApi.deleteCanned(id);
      onChange(replies.filter((r) => r.id !== id));
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    }
  }

  return (
    <div className="space-y-3">
      {replies.length === 0 && !editing && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Henüz hazır yanıt yok.", "No canned replies yet.")}</p>}
      <ul className="space-y-1.5">
        {replies.map((r) => (
          <li key={r.id} className="flex items-start gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{r.title}</p>
              <p className="line-clamp-2 whitespace-pre-wrap text-xs text-neutral-500 dark:text-neutral-400">{r.body}</p>
            </div>
            <Button onClick={() => setEditing({ id: r.id, title: r.title, body: r.body })}>{t("Düzenle", "Edit")}</Button>
            <Button tone="danger" onClick={() => void remove(r.id)}>
              {t("Sil", "Delete")}
            </Button>
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <Field label={t("Başlık", "Title")}>
            <input value={editing.title} maxLength={80} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={inputClass} />
          </Field>
          <Field label={t("Metin", "Text")}>
            <textarea value={editing.body} rows={4} maxLength={4000} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className={`${inputClass} resize-y`} />
          </Field>
          <div className="flex gap-2">
            <Button tone="primary" busy={busy} disabled={!editing.title.trim() || !editing.body.trim()} onClick={() => void save()}>
              {t("Kaydet", "Save")}
            </Button>
            <Button onClick={() => setEditing(null)}>{t("Vazgeç", "Cancel")}</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setEditing({ id: null, title: "", body: "" })}>{t("+ Hazır yanıt ekle", "+ Add canned reply")}</Button>
      )}
    </div>
  );
}

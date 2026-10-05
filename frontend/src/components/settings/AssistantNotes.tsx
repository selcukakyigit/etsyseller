"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, AssistantNote } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";

const MAX_CHARS = 300;

/** Ulagg'ın hatırladıkları: asistanın sohbetler arasında kullandığı mağaza notları (backend assistant/memory.py).
 *  Notlar mağazaya bağlıdır; mağazanın tüm kullanıcıları aynı notları görür. */
export default function AssistantNotes({ shopId }: { shopId: number }) {
  const { t } = useT();
  const [notes, setNotes] = useState<AssistantNote[] | null>(null);
  const [max, setMax] = useState(30);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();

  const load = useCallback(() => {
    api.assistant
      .notes(shopId)
      .then((r) => {
        setNotes(r.notes);
        setMax(r.max);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("Notlar yüklenemedi", "Notes could not be loaded")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("İşlem yapılamadı", "Could not complete the action"));
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    void run(async () => {
      await api.assistant.addNote(shopId, text);
      setDraft("");
    });
  }

  async function clearAll() {
    const ok = await confirm({
      title: t("Tüm notlar silinsin mi?", "Delete all notes?"),
      message: t("Ulagg bu mağaza için hatırladığı her şeyi unutur. Geri alınamaz.", "Ulagg forgets everything it remembers for this shop. This cannot be undone."),
      confirmLabel: t("Hepsini sil", "Delete all"),
      destructive: true,
    });
    if (ok) void run(() => api.assistant.clearNotes(shopId));
  }

  const full = notes !== null && notes.length >= max;

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Ulagg'ın hatırladıkları", "What Ulagg remembers")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            {t(
              "Asistana söylediğin kalıcı tercihler (ör. \"başlıklarda marka adı kullanma\"). Ulagg bunları her yeni sohbette dikkate alır. Notlar bu mağazaya aittir ve mağazanın tüm kullanıcıları için geçerlidir.",
              "Lasting preferences you told the assistant (e.g. \"don't use the brand name in titles\"). Ulagg uses them in every new chat. Notes belong to this shop and apply to all of its users.",
            )}
          </p>
        </div>
        {notes !== null && notes.length > 0 && (
          <button
            type="button"
            onClick={() => void clearAll()}
            disabled={busy}
            className="shrink-0 text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            {t("Hepsini sil", "Delete all")}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {notes === null ? (
        !error && <BlockSpinner />
      ) : notes.length === 0 ? (
        <p className="rounded-lg bg-neutral-50 px-3 py-3 text-xs text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
          {t(
            "Henüz not yok. Sohbette \"bunu hatırla\" demen ya da aşağıdan eklemen yeterli.",
            "No notes yet. Say \"remember this\" in a chat or add one below.",
          )}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-800 dark:text-neutral-100">{n.text}</p>
                <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                  {n.source === "assistant" ? t("Sohbetten kaydedildi", "Saved from a chat") : t("Elle eklendi", "Added manually")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void run(() => api.assistant.deleteNote(shopId, n.id))}
                disabled={busy}
                aria-label={t("Notu sil", "Delete note")}
                title={t("Notu sil", "Delete note")}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-50 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-red-400"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
          disabled={busy || full}
          placeholder={full ? t(`En fazla ${max} not; önce birini sil.`, `Up to ${max} notes; delete one first.`) : t("Yeni not ekle…", "Add a new note…")}
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-[#D97757] focus:outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={busy || full || !draft.trim()}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#D97757] px-3 py-2 text-sm font-medium text-white hover:bg-[#C6613F] disabled:opacity-50"
        >
          {busy && <Spinner size={14} />}
          {t("Ekle", "Add")}
        </button>
      </form>
      {notes !== null && (
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
          {notes.length}/{max} · {t("Şifre ya da alıcı bilgisi gibi kişisel veri ekleme.", "Do not add passwords or buyers' personal data.")}
        </p>
      )}
      {confirmElement}
    </section>
  );
}

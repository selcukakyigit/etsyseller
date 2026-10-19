"use client";

import { useState } from "react";
import { OrderStep } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { useT } from "@/lib/i18n-client";

const MAX_STEPS = 12;
const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const iconBtn =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800";

type Row = { key: string; id: number | null; name: string };

/** Etsy'deki "Customize progress steps" karşılığı: New ve Completed sabit; aralarındaki adımlar eklenir, adlandırılır, sıralanır, silinir.
 * Adımlar yalnızca bu uygulamada tutulur (Etsy API'si vermez). Silinen adımdaki siparişler New'e döner. */
export default function OrderStepsModal({
  steps,
  onSave,
  onClose,
}: {
  steps: OrderStep[];
  onSave: (steps: { id: number | null; name: string }[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>(steps.map((s) => ({ key: `s${s.id}`, id: s.id, name: s.name })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = (i: number, d: number) =>
    setRows((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(rows.map((r) => ({ id: r.id, name: r.name.trim() })));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
      setBusy(false);
    }
  }

  const empty = rows.some((r) => !r.name.trim());
  const locked = "flex items-center gap-2 py-3 text-sm text-neutral-500 dark:text-neutral-400";

  return (
    <Modal
      title={t("İlerleme adımlarını düzenle", "Customize progress steps")}
      widthClass="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button onClick={save} disabled={busy || empty} className={btnPrimary}>
            {t("Değişiklikleri kaydet", "Save changes")}
          </button>
        </>
      }
    >
      <p className="mb-3 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
        {t("Adımları iş akışına göre ekle, sil, yeniden adlandır ya da sırala.", "Add, remove, rename or reorder the steps to fit your workflow.")}
        <HelpTip>
          {t(
            "Yeni gelen siparişler New'de durur; adımlara siz taşırsınız. Adımlar yalnızca bu uygulamada tutulur, Etsy'ye gönderilmez ve alıcıya bildirim gitmez. Bir adımı silerseniz içindeki siparişler New'e döner. Alıcıya yalnızca \"Siparişi tamamla\" ile bildirim gider.",
            "New orders stay in New; you move them to the steps. Steps are kept only in this app: nothing is sent to Etsy and buyers are not notified. Deleting a step returns its orders to New. Buyers are notified only when you complete an order.",
          )}
        </HelpTip>
      </p>
      <div className="border-t border-neutral-100 dark:border-neutral-800">
        <p className={locked}>
          <span aria-hidden>🔒</span> <b>New</b> ({t("zorunlu", "required")})
        </p>
      </div>
      <ul className="space-y-2 border-t border-neutral-100 py-3 dark:border-neutral-800">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-center gap-1">
            <div className="flex">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("Yukarı taşı", "Move up")} className={iconBtn}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={t("Aşağı taşı", "Move down")} className={iconBtn}>
                ↓
              </button>
            </div>
            <input
              value={r.name}
              maxLength={40}
              onChange={(e) => setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
              placeholder={t("Adım adı", "Step name")}
              className={inputCls}
            />
            <button type="button" onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} aria-label={t(`${r.name || "Adım"} sil`, `Delete ${r.name || "step"}`)} className={iconBtn}>
              🗑
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-neutral-400">{t("Henüz adım yok.", "No steps yet.")}</li>}
        <li>
          <button
            type="button"
            disabled={rows.length >= MAX_STEPS}
            onClick={() => setRows((cur) => [...cur, { key: `n${Date.now()}`, id: null, name: "" }])}
            className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            + {t("Adım ekle", "Add a step")}
          </button>
        </li>
      </ul>
      <div className="border-t border-neutral-100 dark:border-neutral-800">
        <p className={locked}>
          <span aria-hidden>🔒</span> <b>Completed</b> ({t("zorunlu", "required")})
        </p>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  );
}

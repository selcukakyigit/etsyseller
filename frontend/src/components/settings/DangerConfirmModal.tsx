"use client";

import { useState } from "react";
import { Modal, btnGhost } from "@/components/listing-editor/Modal";

/**
 * Geri alınamaz işlemler için ortak onay penceresi: ne olacağını listeler, hesap şifresini ve "Onaylıyorum" işaretini ister.
 * Şifre sunucuda doğrulanır; yanlışsa hata bu pencerede gösterilir.
 */
export default function DangerConfirmModal({
  title,
  intro,
  effects,
  actionLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  intro: string;
  /** Bu işlemin sonucunda olacaklar (madde madde). */
  effects: string[];
  actionLabel: string;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem başarısız");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      widthClass="max-w-md"
      z={120}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={`${btnGhost} disabled:opacity-40`}>
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !agreed || password.length === 0}
            className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            {busy ? "İşleniyor…" : actionLabel}
          </button>
        </>
      }
    >
      <p className="mb-2 text-sm text-neutral-700 dark:text-neutral-300">{intro}</p>
      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
        {effects.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">Bu işlem geri alınamaz.</p>

      <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Hesap şifren</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        className="mb-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-500 dark:border-neutral-800 dark:bg-neutral-900"
      />
      <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 accent-red-600" />
        Onaylıyorum
      </label>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

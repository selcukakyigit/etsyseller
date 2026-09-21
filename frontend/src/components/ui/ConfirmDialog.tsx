"use client";

import { ReactNode, useCallback, useRef, useState } from "react";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Silme gibi geri alınamaz işlemler için kırmızı buton. */
  destructive?: boolean;
};

/** Standart onay penceresi. Tarayıcının window.confirm()'i yerine bunu kullan. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Onayla",
  cancelLabel = "Vazgeç",
  destructive,
  onConfirm,
  onCancel,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal
      z={100}
      title={title}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={destructive ? btnPrimary.replace("bg-neutral-900", "bg-red-600").replace("hover:bg-neutral-700", "hover:bg-red-700") : btnPrimary}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && <div className="text-sm text-neutral-600 dark:text-neutral-300">{message}</div>}
    </Modal>
  );
}

/**
 * Kullanım:
 *   const [confirm, confirmElement] = useConfirm();
 *   if (await confirm({ title: "Silinsin mi?", destructive: true })) { ... }
 *   return <>...{confirmElement}</>;
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function close(result: boolean) {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }

  const element = opts ? <ConfirmDialog {...opts} onConfirm={() => close(true)} onCancel={() => close(false)} /> : null;
  return [confirm, element];
}

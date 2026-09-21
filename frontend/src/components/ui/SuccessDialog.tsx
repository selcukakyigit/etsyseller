"use client";

import { ReactNode } from "react";
import { Modal, btnPrimary } from "@/components/listing-editor/Modal";

/** Başarılı işlem sonrası "Tebrikler" penceresi. Etsy'ye gerçekten gönderilen adımları listeler. */
export default function SuccessDialog({
  title,
  message,
  updated,
  warnings,
  closeLabel = "Tamam",
  onClose,
}: {
  title?: string;
  message: ReactNode;
  /** Etsy'ye gerçekten bir şey gönderilen adımların adları; boşsa "zaten güncel" denir. */
  updated?: string[];
  /** Yapılamayan ama bilinmesi gerekenler (amber not olarak gösterilir). */
  warnings?: string[];
  closeLabel?: string;
  onClose: () => void;
}) {
  const nothingSent = updated !== undefined && updated.length === 0;
  return (
    <Modal
      z={110}
      widthClass="max-w-md"
      title={title ?? (nothingSent ? "Değişiklik yok" : "Tebrikler! 🎉")}
      footer={
        <>
          <span />
          <button onClick={onClose} autoFocus className={btnPrimary}>
            {closeLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
        <p>{message}</p>
        {updated !== undefined &&
          (updated.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-500">Etsy&apos;de güncellenenler</p>
              <ul className="space-y-1">
                {updated.map((name) => (
                  <li key={name} className="flex items-center gap-2">
                    <span className="text-green-600">✓</span>
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">Etsy&apos;deki listing zaten günceldi; gönderilecek bir fark yoktu.</p>
          ))}
        {warnings && warnings.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="mb-1 font-semibold">Dikkat</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

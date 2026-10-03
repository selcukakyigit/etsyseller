"use client";

import { ReactNode, useEffect, useRef } from "react";
import { CloseIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";

/** Mobilde alttan açılan panel (filtreler, kısa seçimler). Esc ya da arka plana dokunma kapatır; açıkken arkadaki
 * sayfa kaymaz. `footer`: panelin altına yapışan düğmeler (ör. "Sonuçları göster"). */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80]">
      <div onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("Kapat", "Close")}
            className="-mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">{footer}</div>}
      </div>
    </div>
  );
}

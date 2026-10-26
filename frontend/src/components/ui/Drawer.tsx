"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";
import { useScrollLock } from "@/lib/useScrollLock";

/** Mobilde sağdan kayarak açılan tam ekran panel (bir kaydın ayrıntısı: talep, sipariş…). Geniş ekranda kullanılmaz; orada aynı içerik
 * sayfada yerinde durur (bkz. `useIsDesktop`). Esc ya da ✕ kapatır; açıkken arkadaki sayfa kaymaz. İçerik kendi içinde kayar. */
export default function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  // Yalnızca tarayıcıda bağlandıktan sonra portal'a geçilir (SSR'de `document` yok).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  useScrollLock();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ulagg-slide-in absolute inset-y-0 right-0 flex w-full flex-col bg-neutral-50 pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-w-xl dark:bg-neutral-950"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("Kapat", "Close")}
            className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useRef } from "react";
import Logo from "@/components/Logo";
import { CloseIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";
import SidebarNav, { ShellProps } from "./SidebarNav";

/** Mobil menü çekmecesi (lg altı): soldan kayar, kenar çubuğunun aynısını gösterir. Esc, arka plana dokunma ya da bir
 * bağlantıya tıklama kapatır; açıkken arkadaki sayfa kaymaz. */
export default function MobileDrawer({ open, onClose, ...props }: ShellProps & { open: boolean; onClose: () => void }) {
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

  return (
    <div className={`fixed inset-0 z-[70] lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("Menü", "Menu")}
        className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white pb-[env(safe-area-inset-bottom)] shadow-xl transition-transform duration-200 dark:bg-neutral-900 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <Logo height={22} />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("Menüyü kapat", "Close menu")}
            className="-mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <CloseIcon />
          </button>
        </div>
        {open && <SidebarNav {...props} onNavigate={onClose} />}
      </aside>
    </div>
  );
}

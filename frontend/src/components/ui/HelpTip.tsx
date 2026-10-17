"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n-client";

/** Başlık ya da alanın yanında "?" simgesi: uzun açıklamayı ekranda sürekli göstermek yerine tıklayınca (mobilde de çalışır) küçük bir kutuda açar. */
export default function HelpTip({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    // Fare: üstüne gelince açılır, çekilince kapanır. Dokunmatik: yalnızca dokununca (pointerType ayrımı, yoksa dokunuşun ürettiği mouseenter + click kutuyu hemen kapatırdı)
    <span
      ref={ref}
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      className={`relative inline-flex align-middle ${className}`}
    >
      <button
        type="button"
        onClick={(e) => ((e.nativeEvent as PointerEvent).pointerType === "mouse" ? setOpen(true) : setOpen((v) => !v))}
        aria-expanded={open}
        aria-label={t("Açıklama", "Help")}
        title={t("Açıklama", "Help")}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-[11px] font-semibold leading-none text-neutral-500 hover:border-[#D97757] hover:text-[#D97757] dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-[#D97757] dark:hover:text-[#D97757]"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed text-neutral-700 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          {children}
        </span>
      )}
    </span>
  );
}

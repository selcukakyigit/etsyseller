"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { OrderStep } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

/** "İlerlemeyi güncelle" açılır menüsü (Etsy Shop Manager'daki saat simgesi / Update progress): New, kendi adımların ve "Siparişi tamamla".
 * `current`: tek siparişte şu anki adım (null = New); toplu seçimde verilmez. */
export default function StepMenu({
  steps,
  current,
  onMove,
  onComplete,
  children,
  className,
  label,
  align = "right",
}: {
  steps: OrderStep[];
  current?: number | null;
  onMove: (stepId: number | null) => void;
  onComplete: () => void;
  children: ReactNode;
  className?: string;
  label: string;
  align?: "left" | "right";
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const item = (active: boolean) =>
    `block w-full px-4 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 ${
      active ? "font-semibold text-[#C6613F] dark:text-[#E8956F]" : "text-neutral-800 dark:text-neutral-100"
    }`;
  const pick = (stepId: number | null) => {
    setOpen(false);
    onMove(stepId);
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} className={className}>
        {children}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 ${align === "right" ? "right-0" : "left-0"}`}
        >
          <button role="menuitem" onClick={() => pick(null)} className={item(current === null)}>
            New
          </button>
          {steps.map((s) => (
            <button key={s.id} role="menuitem" onClick={() => pick(s.id)} className={item(current === s.id)}>
              {s.name}
            </button>
          ))}
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onComplete();
            }}
            className="mx-3 my-1.5 block rounded-full bg-neutral-900 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          >
            {t("Siparişi tamamla", "Complete order")} ›
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/** Araç çubuklarındaki yuvarlak düğme (arama satırıyla aynı yükseklik). */
export const toolbarBtn =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-neutral-300 px-3 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";
export const menuBox =
  "absolute right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900";
export const menuItem =
  "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800";

/** Dışına tıklanınca kapanan açılır menü. Araç çubuklarında yerel <select> yerine kullanılır: mobilde form alanları
 *  16px'e zorlandığı için (globals.css) diğer düğmelerden büyük ve dağınık görünüyordu. */
export function Popover({ button, label, children, className = toolbarBtn }: { button: ReactNode; label: string; children: (close: () => void) => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} className={className}>
        {button}
      </button>
      {open && children(() => setOpen(false))}
    </div>
  );
}

/** Tek seçimli menü (sıralama, sayfa başına adet…): seçili olanın yanında ✓. */
export function ChoiceMenu<T extends string | number>({
  value,
  options,
  onChange,
  label,
  button,
  width = "w-60",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  button: ReactNode;
  width?: string;
}) {
  return (
    <Popover label={label} button={button}>
      {(close) => (
        <div role="menu" className={`${menuBox} ${width}`}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className={menuItem}
            >
              {o.label}
              {o.value === value && <span className="text-[#D97757]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
    </svg>
  );
}

export function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 ${className}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

"use client";

import { ReactNode } from "react";

export function Modal({
  title,
  children,
  footer,
  z = 50,
  widthClass = "max-w-5xl",
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  z?: number;
  widthClass?: string;
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" style={{ zIndex: z }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[90vh] w-full ${widthClass} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900`}
      >
        <div className="px-6 pt-6 pb-3">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-between border-t border-neutral-100 px-6 py-4 dark:border-neutral-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40 ${
        checked ? "bg-neutral-900 dark:bg-neutral-100" : "bg-neutral-300 dark:bg-neutral-700"
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all dark:bg-neutral-900 ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export const btnGhost = "text-sm font-medium px-3 py-2 text-neutral-700 dark:text-neutral-200 hover:underline";
export const btnPrimary =
  "text-sm font-semibold px-5 py-2.5 rounded-full bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900";

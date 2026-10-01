"use client";

import { useSyncExternalStore } from "react";
import { toast, ToastKind } from "@/lib/toast";

const STYLE: Record<ToastKind, string> = {
  error: "border-red-200 bg-white text-red-700 dark:border-red-900 dark:bg-neutral-900 dark:text-red-300",
  success: "border-emerald-200 bg-white text-emerald-700 dark:border-emerald-900 dark:bg-neutral-900 dark:text-emerald-300",
  info: "border-neutral-200 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200",
};
const DOT: Record<ToastKind, string> = { error: "bg-red-500", success: "bg-emerald-500", info: "bg-neutral-400" };
const EMPTY: never[] = [];

/** Sağ altta üst üste dizilen bildirimler. Kök düzende bir kez bulunur. */
export default function Toaster() {
  const items = useSyncExternalStore(toast.subscribe, toast.getSnapshot, () => EMPTY);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${STYLE[t.kind]}`}
        >
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[t.kind]}`} />
          <p className="min-w-0 flex-1 leading-relaxed">{t.message}</p>
          <button
            type="button"
            onClick={() => toast.dismiss(t.id)}
            aria-label="Kapat"
            className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

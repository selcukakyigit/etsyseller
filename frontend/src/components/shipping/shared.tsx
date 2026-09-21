"use client";

import { ReactNode } from "react";
import { ApiError, api } from "@/lib/api";

export const inputCls =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#F1641E] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
export const labelCls = "mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-200";
export const iconBtn =
  "rounded-md px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-200 dark:hover:bg-neutral-800";
export const outlineBtn =
  "rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800";

/** Yazma isteği Etsy yetkisi yüzünden reddedildiyse (shops_w yok) true. */
export function isPermissionError(e: unknown): boolean {
  if (e instanceof ApiError && e.status === 403) return true;
  const msg = e instanceof Error ? e.message : "";
  return /scope|permission|forbidden|shops_w|yetki/i.test(msg);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Bilinmeyen hata";
}

/** Etsy yazma yetkisi (shops_w) için hesabı yeniden bağlama uyarısı. */
export function ReconnectNotice({ compact, scope = "shops_w" }: { compact?: boolean; scope?: string }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-semibold">Etsy&apos;de yazma yetkisi gerekiyor</p>
      <p className="mt-1 text-xs">
        Bu işlem için Etsy hesabını yeni yetkiyle (<code>{scope}</code>) bir kez yeniden bağlaman gerekiyor. Mevcut mağaza ve verilerin korunur.
      </p>
      {!compact && (
        <a
          href={api.shops.connectUrl()}
          className="mt-3 inline-block rounded-full bg-[#F1641E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d9560f]"
        >
          Etsy&apos;yi yeniden bağla
        </a>
      )}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className="rounded-full px-3 py-1.5 text-sm disabled:opacity-30">
        ←
      </button>
      {Array.from({ length: pages }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPage(i)}
          className={`h-8 w-9 rounded-full text-sm ${i === page ? "border border-neutral-900 dark:border-neutral-100" : "bg-neutral-100 dark:bg-neutral-800"}`}
        >
          {i + 1}
        </button>
      ))}
      <button type="button" disabled={page === pages - 1} onClick={() => onPage(page + 1)} className="rounded-full px-3 py-1.5 text-sm disabled:opacity-30">
        →
      </button>
    </div>
  );
}

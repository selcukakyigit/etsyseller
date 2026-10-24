"use client";

import { ReactNode } from "react";
import { ApiError, api } from "@/lib/api";
import { tNow, useT } from "@/lib/i18n-client";

export const inputCls =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
export const labelCls = "mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-200";
export const iconBtn =
  "rounded-md px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-200 dark:hover:bg-neutral-800";
export const outlineBtn =
  "rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800";

/** Yazma isteği Etsy yetkisi yüzünden reddedildiyse (shops_w yok) true. */
export function isPermissionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  if (/^Demo (shop|mağaza)/.test(msg)) return false; // demo mağaza Etsy'ye hiç yazmaz; yeniden bağlanmak çözüm değil
  if (e instanceof ApiError && e.status === 403) return true;
  return /scope|permission|forbidden|shops_w|yetki/i.test(msg);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : tNow("Bilinmeyen hata", "Unknown error");
}

/** Etsy yazma yetkisi (shops_w) için hesabı yeniden bağlama uyarısı. */
export function ReconnectNotice({ compact, scope = "shops_w" }: { compact?: boolean; scope?: string }) {
  const { t } = useT();
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-semibold">{t("Etsy'de yazma yetkisi gerekiyor", "Etsy write permission needed")}</p>
      <p className="mt-1 text-xs">
        {t("Bu işlem için Etsy hesabını yeni yetkiyle", "This action needs you to reconnect your Etsy account once with the new permission")} (<code>{scope}</code>)
        {t(" bir kez yeniden bağlaman gerekiyor. Mevcut mağaza ve verilerin korunur.", ". Your shop and data are kept.")}
      </p>
      {!compact && (
        <a
          href={api.shops.connectUrl()}
          className="mt-3 inline-block rounded-full bg-[#D97757] px-4 py-2 text-sm font-semibold text-white hover:bg-[#C6613F]"
        >
          {t("Etsy'yi yeniden bağla", "Reconnect Etsy")}
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

"use client";

import Link from "next/link";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { api, DashboardData } from "@/lib/api";
import { T } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";

// Ana sayfa (Ulagg) ve Analiz sayfasının ortak parçaları: özet verisi, sayı kutusu, geçen yıla göre değişim.

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Bugün / gönderilecek / bu ay özeti (istemcinin yerel günüyle). `reload`: sohbetten sonra sayıları tazelemek için. */
export function useDashboardData(shopId: number | undefined) {
  const [data, setData] = useCached<DashboardData>(shopId !== undefined ? `dashboard:${shopId}:${localToday()}` : null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (shopId === undefined) return;
    api.assistant
      .dashboard(shopId, localToday())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [shopId, setData]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, reload };
}

export const card = "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";

/** Etiket + büyük sayı + alt satır. `href` verilirse tıklanınca o sayfaya gider. */
export function StatTile({ label, value, sub, href, className = "" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; href?: string; className?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{sub}</div>}
    </>
  );
  const cls = `${card} block ${className}`;
  return href ? (
    <Link href={href} className={`${cls} transition hover:border-[#D97757] dark:hover:border-[#D97757]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Geçen yılın aynı dönemine göre değişim (▲ %18). */
export function Change({ cur, prev, label, t }: { cur: number; prev: number; label: string; t: T }) {
  if (!prev) return <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{label}: {t("veri yok", "no data")}</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return (
    <span className={`text-[11px] font-medium ${pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
      {pct >= 0 ? "▲" : "▼"} %{Math.abs(pct).toFixed(0)} <span className="font-normal text-neutral-400 dark:text-neutral-500">{label}</span>
    </span>
  );
}

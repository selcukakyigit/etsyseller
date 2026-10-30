"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n-client";

export type BarPoint = { date: string; value: number };

/** Tek seri günlük sütun grafiği (yönetim trendleri). Tek seri olduğu için lejant yok, başlık seriyi adlandırır; imleçle (ya da dokunarak)
 * gün ve değer okunur, ekran okuyucu için aynı veri görünmez bir tabloda durur. Renk marka rengidir, iki temada da okunur. */
export default function MiniBars({ label, points, format }: { label: string; points: BarPoint[]; format: (v: number) => string }) {
  const { locale } = useT();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value));
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const shown = hover === null ? null : points[hover];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</h3>
        <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{format(total)}</p>
      </div>
      <p className="mt-1 h-4 text-xs tabular-nums text-neutral-500 dark:text-neutral-400" aria-live="polite">
        {shown ? `${day(shown.date)}: ${format(shown.value)}` : ""}
      </p>
      <div role="img" aria-label={label} className="mt-1 flex h-24 items-end gap-px border-b border-neutral-200 dark:border-neutral-800" onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => (
          <div key={p.date} className="flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
            <div
              className={`w-full rounded-t-[2px] bg-[#D97757] ${hover === i ? "opacity-100" : hover === null ? "opacity-90" : "opacity-50"}`}
              style={{ height: p.value > 0 && max > 0 ? `${Math.max(3, (p.value / max) * 100)}%` : "0" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-neutral-400 dark:text-neutral-500">
        <span>{points[0] ? day(points[0].date) : ""}</span>
        <span>{points.length ? day(points[points.length - 1].date) : ""}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

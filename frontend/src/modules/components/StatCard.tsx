import { ReactNode } from "react";
import { card, muted } from "../core/ui";

/** Özet kutusu (başlık, büyük değer, isteğe bağlı açıklama). `onClick` verilirse tıklanabilir. */
export default function StatCard({ title, value, hint, onClick, valueClass = "" }: { title: string; value: ReactNode; hint?: string; onClick?: () => void; valueClass?: string }) {
  const body = (
    <>
      <div className={muted}>{title}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClass || "text-neutral-900 dark:text-neutral-100"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</div>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${card} text-left transition hover:border-[#D97757]`}>
      {body}
    </button>
  ) : (
    <div className={card}>{body}</div>
  );
}

"use client";

import { ReactNode } from "react";

/** Talep ekranlarının ortak iki bölmesi (kullanıcı ve yönetici): solda liste, sağda seçilen talep.
 * Dar ekranda yalnızca biri görünür: talep seçiliyse konuşma, değilse liste. Geniş ekranda iki bölme de kendi içinde kayar. */
export default function TicketLayout({ list, detail, placeholder }: { list: ReactNode; detail: ReactNode | null; placeholder: ReactNode }) {
  const pane = "min-w-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <div className={`${pane} ${detail ? "hidden lg:block" : ""}`}>{list}</div>
      <div className={`${pane} ${detail ? "" : "hidden lg:block"}`}>{detail ?? <p className="py-24 text-center text-sm text-neutral-400 dark:text-neutral-500">{placeholder}</p>}</div>
    </div>
  );
}

"use client";

import { useT } from "@/lib/i18n-client";
import type { AdminView } from "@/lib/supportApi";

export type QueueTab = AdminView | "report";

const TABS: { key: QueueTab; label: [string, string] }[] = [
  { key: "open", label: ["Açık", "Open"] },
  { key: "mine", label: ["Bana atanan", "Mine"] },
  { key: "unassigned", label: ["Atanmamış", "Unassigned"] },
  { key: "unread", label: ["Okunmamış", "Unread"] },
  { key: "waiting", label: ["Kullanıcı bekleniyor", "Waiting for user"] },
  { key: "overdue", label: ["Geciken", "Overdue"] },
  { key: "resolved", label: ["Çözülen", "Resolved"] },
  { key: "all", label: ["Tümü", "All"] },
  { key: "report", label: ["Rapor", "Report"] },
];

/** Yönetici kuyruk sekmeleri; her sekmede o görünümdeki talep sayısı yazar (geciken sıfırdan büyükse kırmızı). */
export default function QueueTabs({ current, counts, onChange }: { current: QueueTab; counts: Partial<Record<AdminView, number>> | undefined; onChange: (tab: QueueTab) => void }) {
  const { t } = useT();
  return (
    <nav aria-label={t("Kuyruk", "Queue")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map(({ key, label }) => {
          const n = key === "report" ? undefined : counts?.[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-current={current === key ? "page" : undefined}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                current === key
                  ? "border-[#D97757] text-neutral-900 dark:text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              {t(label[0], label[1])}
              {n !== undefined && (
                <span
                  className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    key === "overdue" && n > 0 ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

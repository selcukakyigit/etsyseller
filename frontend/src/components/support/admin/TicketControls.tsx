"use client";

import { inputClass } from "@/components/admin/ui";
import { priorityLabel } from "@/components/support/meta";
import HelpTip from "@/components/ui/HelpTip";
import { useT } from "@/lib/i18n-client";
import type { AdminTicketDetail, TicketOptions, TicketPatch, TicketPriority } from "@/lib/supportApi";

/** Talebin yönetim denetimleri: kime atandığı, önceliği ve konu etiketleri. Her değişiklik anında kaydedilir ve talebin iş kaydına yazılır. */
export default function TicketControls({ ticket, options, busy, onPatch }: { ticket: AdminTicketDetail; options: TicketOptions; busy: boolean; onPatch: (patch: TicketPatch) => void }) {
  const { t } = useT();
  const toggle = (key: string) => onPatch({ labels: ticket.labels.includes(key) ? ticket.labels.filter((k) => k !== key) : [...ticket.labels, key] });
  const name = (key: string) => {
    const o = options.labels.find((l) => l.key === key);
    return o ? t(o.tr, o.en) : key;
  };
  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Atanan", "Assignee")}</span>
          <select
            value={ticket.assignee?.id ?? ""}
            disabled={busy}
            onChange={(e) => onPatch({ assignee_id: e.target.value ? Number(e.target.value) : null })}
            className={inputClass}
          >
            <option value="">{t("Atanmamış", "Unassigned")}</option>
            {options.staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Öncelik", "Priority")}</span>
          <select value={ticket.priority} disabled={busy} onChange={(e) => onPatch({ priority: e.target.value as TicketPriority })} className={inputClass}>
            {options.priorities.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(t, p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t("Konu etiketleri", "Topic labels")}
          <HelpTip>
            {t(
              "Etiketler raporda hangi konuda en çok talep geldiğini gösterir. Talepteki kelimelere göre önerilenler altı çizili çıkar; dokununca eklenir.",
              "Labels show in the report which topics bring the most requests. Suggestions based on the words in the request appear dashed; tap to add.",
            )}
          </HelpTip>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {options.labels.map((l) => {
            const on = ticket.labels.includes(l.key);
            const suggested = !on && ticket.suggested_labels.includes(l.key);
            return (
              <button
                key={l.key}
                type="button"
                disabled={busy}
                aria-pressed={on}
                onClick={() => toggle(l.key)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                  on
                    ? "border-[#D97757] bg-[#D97757]/10 text-[#B4553A] dark:text-[#E89A7F]"
                    : suggested
                      ? "border-dashed border-[#D97757] text-neutral-700 dark:text-neutral-200"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {name(l.key)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import { Badge, EmptyState, Section, useFormat } from "@/components/admin/ui";
import { AdminBilling } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

export default function EventsSection({ data }: { data: AdminBilling; onChanged: () => void }) {
  const { t } = useT();
  const f = useFormat();
  return (
    <Section title={t("Son webhook olayları", "Recent webhook events")}>
      {data.events.length === 0 ? (
        <EmptyState>{t("Henüz olay gelmedi.", "No events yet.")}</EmptyState>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {data.events.map((e) => (
            <li key={e.id} className="py-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-xs text-neutral-800 dark:text-neutral-200">
                  {e.event_name}
                  {e.lemon_id ? ` #${e.lemon_id}` : ""}
                  {e.workspace_id ? ` · ws ${e.workspace_id}` : ""}
                </p>
                <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>{f.dateTime(e.created_at)}</span>
                  {e.ok ? <Badge tone="good">OK</Badge> : <Badge tone="bad">{t("Hata", "Error")}</Badge>}
                </div>
              </div>
              {e.error && <p className="mt-1 break-words font-mono text-xs text-red-600 dark:text-red-400">{e.error}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
        {t(
          "Hatalı olaylar Lemon tarafından yeniden gönderilir; aynı olay iki kez kredi yüklemez.",
          "Failed events are resent by Lemon; the same event never adds credits twice.",
        )}
      </p>
    </Section>
  );
}

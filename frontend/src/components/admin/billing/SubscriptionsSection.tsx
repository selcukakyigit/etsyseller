"use client";

import { Badge, EmptyState, Section, useFormat } from "@/components/admin/ui";
import { AdminBilling } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

export default function SubscriptionsSection({ data }: { data: AdminBilling; onChanged: () => void }) {
  const { t } = useT();
  const f = useFormat();
  return (
    <Section title={t("Abonelikler", "Subscriptions")}>
      {data.subscriptions.length === 0 ? (
        <EmptyState>{t("Henüz abonelik yok.", "No subscriptions yet.")}</EmptyState>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {data.subscriptions.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{s.owner_email ?? `#${s.workspace_id}`}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{s.product ?? "—"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                {s.renews_at && (
                  <span>
                    {t("Yenilenme", "Renews")}: {f.date(s.renews_at)}
                  </span>
                )}
                {s.ends_at && (
                  <span>
                    {t("Bitiş", "Ends")}: {f.date(s.ends_at)}
                  </span>
                )}
                <Badge tone={s.status === "active" || s.status === "on_trial" ? "good" : s.status === "expired" || s.status === "cancelled" ? "muted" : "warn"}>{s.status}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

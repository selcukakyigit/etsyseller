"use client";

import Link from "next/link";
import { Badge, useFormat } from "@/components/admin/ui";
import { PriorityBadge, RatingBadge, SourceBadge, StatusBadge, WaitBadge, categoryLabel, labelName } from "@/components/support/meta";
import { useT } from "@/lib/i18n-client";
import type { AdminTicketSummary, TicketLabelOption, TicketSummary } from "@/lib/supportApi";

type Props = {
  ticket: TicketSummary | AdminTicketSummary;
  href: string;
  active: boolean;
  /** Yönetici satırı: gönderen e-postası, öncelik, kaynak, etiketler, bekleme süresi ve toplu seçim kutusu. */
  admin?: { labels: TicketLabelOption[]; selected: boolean; onSelect: (checked: boolean) => void };
};

/** Talep listesindeki tek satır (kullanıcı ve yönetici listeleri aynı satırı kullanır). */
export default function TicketRow({ ticket, href, active, admin }: Props) {
  const { t } = useT();
  const f = useFormat();
  const a = admin && "user" in ticket ? ticket : null;
  const unread = a ? a.admin_unread : ticket.user_unread;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border p-2.5 transition ${
        active ? "border-[#D97757] bg-[#D97757]/5" : "border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/50"
      }`}
    >
      {admin && (
        <input
          type="checkbox"
          checked={admin.selected}
          onChange={(e) => admin.onSelect(e.target.checked)}
          aria-label={t(`#${ticket.id} talebini seç`, `Select request #${ticket.id}`)}
          className="mt-1 accent-[#D97757]"
        />
      )}
      <Link href={href} className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {unread && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[#D97757]" aria-label={t("Yeni", "New")} />}
          <span className="truncate">
            #{ticket.id} · {ticket.subject}
          </span>
        </p>
        <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
          {a ? `${a.user.email}${a.assignee ? ` → ${a.assignee.name || a.assignee.email}` : ""}` : categoryLabel(t, ticket.category)} · {f.dateTime(ticket.updated_at)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={ticket.status} admin={!!a} />
          {a && (
            <>
              <Badge tone="muted">{categoryLabel(t, a.category)}</Badge>
              <PriorityBadge priority={a.priority} />
              <SourceBadge source={a.source} />
              <WaitBadge since={a.updated_at} status={a.status} />
              {a.labels.slice(0, 2).map((key) => (
                <Badge key={key} tone="muted">
                  # {labelName(t, admin!.labels, key)}
                </Badge>
              ))}
              {a.labels.length > 2 && <span className="text-[11px] text-neutral-400">+{a.labels.length - 2}</span>}
            </>
          )}
          <RatingBadge rating={ticket.rating} />
        </div>
      </Link>
    </div>
  );
}

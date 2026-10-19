"use client";

import { useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, Button, EmptyState, Section, useFormat } from "@/components/admin/ui";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { adminTicketsApi, ErrorGroup, ErrorGroupStatus } from "@/lib/supportApi";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";

type Filter = "open" | "all";

export default function AdminErrorsPage() {
  return (
    <AdminShell current="/admin/errors">
      <Errors />
    </AdminShell>
  );
}

function Errors() {
  const { t } = useT();
  const [filter, setFilter] = useState<Filter>("open");
  const { data, setData, error, loading } = useApiData(`admin:errors:${filter}`, () => adminTicketsApi.errors(filter));

  async function setStatus(group: ErrorGroup, status: ErrorGroupStatus) {
    try {
      await adminTicketsApi.setErrorStatus(group.id, status);
      if (!data) return;
      setData(filter === "open" && status !== "open" ? data.filter((g) => g.id !== group.id) : data.map((g) => (g.id === group.id ? { ...g, status } : g)));
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    }
  }

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
        filter === value
          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Section
      title={t("Otomatik yakalanan hatalar", "Automatically captured errors")}
      action={
        <div className="flex items-center gap-2">
          {loading && data && <Spinner size={16} />}
          <HelpTip>
            {t(
              "Kullanıcı talep açmasa da tarayıcıdaki beklenmeyen hatalar ve sunucudaki 500 hataları burada toplanır. Aynı hata tek satırdır; sayaç tekrar sayısını gösterir. Çözdüğün bir hata yeniden görülürse otomatik açılır. Kayıtlar 90 gün sonra silinir.",
              "Unexpected browser errors and server 500s are collected here even when the user does not open a request. The same error is one row with a counter. A resolved error reopens automatically if it appears again. Records are deleted after 90 days.",
            )}
          </HelpTip>
          <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
            {filterButton("open", t("Açık", "Open"))}
            {filterButton("all", t("Tümü", "All"))}
          </div>
        </div>
      }
    >
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.length === 0 && <EmptyState>{t("Açık hata yok.", "No open errors.")}</EmptyState>}
      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((g) => (
            <ErrorRow key={g.id} group={g} onStatus={setStatus} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ErrorRow({ group: g, onStatus }: { group: ErrorGroup; onStatus: (g: ErrorGroup, s: ErrorGroupStatus) => void }) {
  const { t } = useT();
  const f = useFormat();
  return (
    <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-neutral-900 dark:text-neutral-100">{g.message}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Badge tone={g.source === "server" ? "bad" : "warn"}>{g.source === "server" ? t("Sunucu", "Server") : t("Tarayıcı", "Browser")}</Badge>
            <Badge tone="muted">×{f.num(g.count)}</Badge>
            {g.status !== "open" && <Badge tone="good">{g.status === "resolved" ? t("Çözüldü", "Resolved") : t("Yok sayıldı", "Ignored")}</Badge>}
            {g.url && <span className="font-mono">{g.url}</span>}
            <span>
              {t("Son", "Last")}: {f.dateTime(g.last_seen)}
            </span>
            {g.tickets > 0 && (
              <Link href="/admin/tickets" className="text-[#D97757] hover:text-[#C6613F]">
                {t(`${g.tickets} talep`, `${g.tickets} requests`)}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 gap-1.5">
          {g.status === "open" ? (
            <>
              <Button tone="primary" onClick={() => onStatus(g, "resolved")}>
                {t("Çözüldü", "Resolved")}
              </Button>
              <Button onClick={() => onStatus(g, "ignored")}>{t("Yok say", "Ignore")}</Button>
            </>
          ) : (
            <Button onClick={() => onStatus(g, "open")}>{t("Yeniden aç", "Reopen")}</Button>
          )}
        </div>
      </div>
      {g.detail && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-neutral-500 dark:text-neutral-400">{t("Ayrıntı / iz", "Detail / trace")}</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-neutral-100 p-2 text-[11px] text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">{g.detail}</pre>
        </details>
      )}
    </li>
  );
}

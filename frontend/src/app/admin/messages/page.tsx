"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, EmptyState, Section, useFormat } from "@/components/admin/ui";
import { useApiData } from "@/lib/useApiData";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { AdminMessage, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

type Filter = "open" | "all";

const TOPICS: Record<string, [string, string]> = {
  support: ["Destek", "Support"],
  etsy: ["Etsy", "Etsy"],
  billing: ["Ödeme", "Billing"],
  privacy: ["Gizlilik", "Privacy"],
  other: ["Diğer", "Other"],
};

export default function AdminMessagesPage() {
  return (
    <AdminShell current="/admin/messages">
      <Messages />
    </AdminShell>
  );
}

function Messages() {
  const { t } = useT();
  const [filter, setFilter] = useState<Filter>("open");
  const { data, setData, error, loading } = useApiData(`admin:messages:${filter}`, () => api.admin.messages(filter));

  function onChanged(updated: AdminMessage) {
    if (!data) return;
    // "Açık" görünümünde ilgilenilen mesaj listeden düşer; "Tümü"nde yerinde güncellenir.
    setData(filter === "open" && updated.handled ? data.filter((m) => m.id !== updated.id) : data.map((m) => (m.id === updated.id ? updated : m)));
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
      title={t("İletişim mesajları", "Contact messages")}
      action={
        <div className="flex items-center gap-2">
          {loading && data && <Spinner size={16} />}
          <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
            {filterButton("open", t("Açık", "Open"))}
            {filterButton("all", t("Tümü", "All"))}
          </div>
        </div>
      }
    >
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.length === 0 && (
        <EmptyState>{filter === "open" ? t("Açık mesaj yok.", "No open messages.") : t("Henüz mesaj yok.", "No messages yet.")}</EmptyState>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((m) => (
            <MessageCard key={m.id} message={m} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function MessageCard({ message: m, onChanged }: { message: AdminMessage; onChanged: (m: AdminMessage) => void }) {
  const { t } = useT();
  const f = useFormat();
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  const topic = TOPICS[m.topic] ?? TOPICS.other;

  async function toggleHandled() {
    setSaving(true);
    try {
      onChanged(await api.admin.setMessageHandled(m.id, !m.handled));
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function openAttachment(id: number) {
    // Açılır pencere engellenmesin diye sekme tıklama anında açılır, adres gelince yönlendirilir.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setOpening(id);
    try {
      const { url } = await api.admin.attachmentUrl(id);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setOpening(null);
    }
  }

  return (
    <li className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {m.name} ·{" "}
            <a href={`mailto:${m.email}`} className="text-[#D97757] hover:text-[#C6613F]">
              {m.email}
            </a>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Badge tone="muted">{t(topic[0], topic[1])}</Badge>
            <Badge tone="muted">{m.lang.toUpperCase()}</Badge>
            <span>{f.dateTime(m.created_at)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggleHandled()}
          disabled={saving}
          className={`flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
            m.handled
              ? "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              : "border-[#D97757] bg-[#D97757] text-white hover:bg-[#C6613F]"
          }`}
        >
          {m.handled ? t("Yeniden aç", "Reopen") : t("İlgilenildi", "Mark handled")}
        </button>
      </div>

      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{m.message}</p>

      {m.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => void openAttachment(a.id)}
              disabled={opening === a.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span className="truncate">{a.filename}</span>
              <span className="text-neutral-400 dark:text-neutral-500">{Math.max(1, Math.round(a.size / 1024))} KB</span>
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

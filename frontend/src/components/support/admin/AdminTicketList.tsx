"use client";

import { FormEvent, useState } from "react";
import { Button, EmptyState, inputClass } from "@/components/admin/ui";
import { CATEGORIES, categoryLabel, priorityLabel } from "@/components/support/meta";
import TicketRow from "@/components/support/TicketRow";
import { Pager } from "@/components/ui/Pager";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { adminTicketsApi, AdminTicketPage, TicketCategory, TicketOptions, TicketPatch, TicketPriority } from "@/lib/supportApi";
import { toast } from "@/lib/toast";

export type ListFilters = { q: string; label: string; priority: string; category: string };

/** Yönetici talep listesi: arama (konu, e-posta ya da #numara), etiket/öncelik/tür süzgeçleri, sayfalama ve toplu işlem (tamamla, ata, öncelik). */
export default function AdminTicketList({
  data,
  error,
  loading,
  options,
  filters,
  activeId,
  onFilters,
  onPage,
  onBulkDone,
}: {
  data: AdminTicketPage | null;
  error: string | null;
  loading: boolean;
  options: TicketOptions;
  filters: ListFilters;
  activeId: number | null;
  onFilters: (f: ListFilters) => void;
  onPage: (page: number) => void;
  onBulkDone: () => void;
}) {
  const { t } = useT();
  const [text, setText] = useState(filters.q);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  function search(e: FormEvent) {
    e.preventDefault();
    onFilters({ ...filters, q: text.trim() });
  }

  function pick(id: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function bulk(changes: TicketPatch) {
    setBusy(true);
    try {
      const { updated } = await adminTicketsApi.bulk([...picked], changes);
      toast.success(t(`${updated} talep güncellendi.`, `${updated} requests updated.`));
      setPicked(new Set());
      onBulkDone();
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items ?? [];
  const select = "!w-auto !py-1.5 text-xs";
  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Konu, e-posta ya da #numara…", "Subject, email or #number…")} className={inputClass} />
        <Button type="submit">{t("Ara", "Search")}</Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <select value={filters.priority} onChange={(e) => onFilters({ ...filters, priority: e.target.value })} aria-label={t("Öncelik", "Priority")} className={`${inputClass} ${select}`}>
          <option value="">{t("Her öncelik", "Any priority")}</option>
          {options.priorities.map((p: TicketPriority) => (
            <option key={p} value={p}>
              {priorityLabel(t, p)}
            </option>
          ))}
        </select>
        <select value={filters.category} onChange={(e) => onFilters({ ...filters, category: e.target.value })} aria-label={t("Tür", "Type")} className={`${inputClass} ${select}`}>
          <option value="">{t("Her tür", "Any type")}</option>
          {(Object.keys(CATEGORIES) as TicketCategory[]).map((c) => (
            <option key={c} value={c}>
              {categoryLabel(t, c)}
            </option>
          ))}
        </select>
        <select value={filters.label} onChange={(e) => onFilters({ ...filters, label: e.target.value })} aria-label={t("Etiket", "Label")} className={`${inputClass} ${select}`}>
          <option value="">{t("Her etiket", "Any label")}</option>
          {options.labels.map((l) => (
            <option key={l.key} value={l.key}>
              {t(l.tr, l.en)}
            </option>
          ))}
        </select>
        {loading && data && <Spinner size={16} />}
        {data && <span className="ml-auto text-xs tabular-nums text-neutral-400">{t(`${data.total} talep`, `${data.total} requests`)}</span>}
      </div>

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#D97757]/40 bg-[#D97757]/5 p-2 text-xs">
          <span className="font-medium text-neutral-700 dark:text-neutral-200">{t(`${picked.size} seçili`, `${picked.size} selected`)}</span>
          <Button busy={busy} onClick={() => void bulk({ status: "resolved" })}>
            {t("Tamamla", "Complete")}
          </Button>
          <select
            disabled={busy}
            value=""
            aria-label={t("Ata", "Assign")}
            onChange={(e) => e.target.value !== "" && void bulk({ assignee_id: e.target.value === "none" ? null : Number(e.target.value) })}
            className={`${inputClass} ${select}`}
          >
            <option value="">{t("Ata…", "Assign…")}</option>
            <option value="none">{t("Atamayı kaldır", "Remove assignee")}</option>
            {options.staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.email}
              </option>
            ))}
          </select>
          <select disabled={busy} value="" aria-label={t("Öncelik", "Priority")} onChange={(e) => e.target.value && void bulk({ priority: e.target.value as TicketPriority })} className={`${inputClass} ${select}`}>
            <option value="">{t("Öncelik…", "Priority…")}</option>
            {options.priorities.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(t, p)}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setPicked(new Set())} className="text-neutral-500 hover:underline dark:text-neutral-400">
            {t("Seçimi kaldır", "Clear selection")}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && items.length === 0 && <EmptyState>{t("Talep yok.", "No requests.")}</EmptyState>}
      <ul className="space-y-1.5">
        {items.map((r) => (
          <li key={r.id}>
            <TicketRow
              ticket={r}
              href={`/admin/tickets?id=${r.id}`}
              active={r.id === activeId}
              admin={{ labels: options.labels, selected: picked.has(r.id), onSelect: (on) => pick(r.id, on) }}
            />
          </li>
        ))}
      </ul>
      {data && <Pager page={data.page} pages={data.pages} onPage={(p) => { setPicked(new Set()); onPage(p); }} />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { AUDIT_ACTIONS } from "@/components/admin/auditActions";
import { EmptyState, ExportButton, Pager, Section, inputClass, useFormat } from "@/components/admin/ui";
import DateRangePicker, { presetOptions } from "@/components/ui/DateRangePicker";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { AdminAuditQuery, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";

const PAGE_SIZE = 50;
const EMPTY: AdminAuditQuery = { q: "", action: "", admin: "", date_from: "", date_to: "", offset: 0 };

export default function AdminAuditPage() {
  return (
    <AdminShell current="/admin/audit">
      <Audit />
    </AdminShell>
  );
}

function Audit() {
  const { t } = useT();
  const f = useFormat();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<AdminAuditQuery>(EMPTY);
  const [period, setPeriod] = useState("all");
  const { data, error, loading } = useApiData(`admin:audit:${JSON.stringify(query)}`, () => api.admin.audit(query));

  // Arama yazma bitince (300 ms) uygulanır; filtre değişince ilk sayfaya dönülür.
  useEffect(() => {
    const id = setTimeout(() => setQuery((q) => (q.q === search.trim() ? q : { ...q, q: search.trim(), offset: 0 })), 300);
    return () => clearTimeout(id);
  }, [search]);

  const update = (patch: Partial<AdminAuditQuery>) => setQuery((q) => ({ ...q, ...patch, offset: "offset" in patch ? patch.offset ?? 0 : 0 }));
  const exportParams = { q: query.q, action: query.action, admin_email: query.admin, date_from: query.date_from, date_to: query.date_to };

  return (
    <Section
      title={t("Yönetici işlem kaydı", "Admin activity log")}
      action={
        <div className="flex items-center gap-2">
          {loading && data && <Spinner size={16} />}
          <ExportButton run={() => api.admin.exportCsv("audit", exportParams)} />
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Yönetici, hedef ya da ayrıntıda ara", "Search admin, target or detail")}
          aria-label={t("Ara", "Search")}
          className={inputClass}
        />
        <select value={query.action} onChange={(e) => update({ action: e.target.value })} aria-label={t("İşlem türü", "Action type")} className={inputClass}>
          <option value="">{t("Tüm işlemler", "All actions")}</option>
          {(data?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {AUDIT_ACTIONS[a] ? t(AUDIT_ACTIONS[a][0], AUDIT_ACTIONS[a][1]) : a}
            </option>
          ))}
        </select>
        <DateRangePicker
          label={t("Tarih", "Date")}
          value={period}
          custom={query.date_from && query.date_to ? { start: query.date_from, end: query.date_to } : null}
          options={[{ id: "all", label: t("Tüm zamanlar", "All time"), range: null }, ...presetOptions(["today", "yesterday", "7d", "30d", "month", "last_month"], t)]}
          onChange={(id, r) => {
            setPeriod(id);
            update({ date_from: r?.start ?? "", date_to: r?.end ?? "" });
          }}
        />
      </div>

      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.items.length === 0 && <EmptyState>{t("Kayıt bulunamadı.", "No entries found.")}</EmptyState>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {data.items.map((a) => {
            const name = AUDIT_ACTIONS[a.action];
            return (
              <li key={a.id} className="py-2">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 text-sm text-neutral-800 dark:text-neutral-200">
                    {name ? t(name[0], name[1]) : a.action}
                    {a.target && <span className="ml-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">{a.target}</span>}
                  </p>
                  <p className="flex-shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                    {a.email} · {f.dateTime(a.created_at)}
                  </p>
                </div>
                {a.detail && <p className="mt-0.5 break-words text-xs text-neutral-500 dark:text-neutral-400">{a.detail}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {data && <Pager offset={query.offset} step={PAGE_SIZE} total={data.total} onChange={(offset) => update({ offset })} />}
    </Section>
  );
}

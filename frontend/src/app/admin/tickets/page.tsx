"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import AdminTicketList, { ListFilters } from "@/components/support/admin/AdminTicketList";
import AdminTicketPane from "@/components/support/admin/AdminTicketPane";
import QueueTabs, { QueueTab } from "@/components/support/admin/QueueTabs";
import ReportPanel from "@/components/support/admin/ReportPanel";
import CannedManager from "@/components/support/CannedManager";
import TicketLayout from "@/components/support/TicketLayout";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { AdminTicketDetail, adminTicketsApi, CannedReply } from "@/lib/supportApi";
import { useApiData } from "@/lib/useApiData";

const NO_FILTERS: ListFilters = { q: "", label: "", priority: "", category: "" };

export default function AdminTicketsPage() {
  return (
    <AdminShell current="/admin/tickets">
      <Suspense fallback={null}>
        <Tickets />
      </Suspense>
    </AdminShell>
  );
}

function Tickets() {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const id = Number(params.get("id")) || null;
  const [tab, setTab] = useState<QueueTab>("open");
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const view = tab === "report" ? "open" : tab;
  const key = `admin:tickets:${view}:${filters.q}:${filters.label}:${filters.priority}:${filters.category}:${page}`;
  const list = useApiData(key, () => adminTicketsApi.list({ view, ...filters, page }));
  const options = useApiData("admin:tickets:options", () => adminTicketsApi.options());
  const canned = useApiData("admin:tickets:canned", () => adminTicketsApi.canned());
  const setCanned = (next: CannedReply[]) => canned.setData(next);

  /** Seçili talep değişince (açılış, yanıt, atama…) satır yerinde güncellenir; sayaçlar ve görünüm üyeliği için liste yeniden istenir. */
  function onChanged(updated: AdminTicketDetail) {
    const data = list.data;
    if (data) list.setData({ ...data, items: data.items.map((r) => (r.id === updated.id ? { ...updated, admin_unread: false } : r)) });
    list.reload();
  }

  function changeTab(next: QueueTab) {
    setTab(next);
    setPage(0);
  }

  if (!options.data) return <BlockSpinner />;
  return (
    <div className="space-y-4">
      <QueueTabs current={tab} counts={list.data?.counts} onChange={changeTab} />
      {tab === "report" ? (
        <ReportPanel labels={options.data.labels} />
      ) : (
        <>
          <TicketLayout
            list={
              <div className="space-y-4">
                <AdminTicketList
                  data={list.data}
                  error={list.error}
                  loading={list.loading}
                  options={options.data}
                  filters={filters}
                  activeId={id}
                  onFilters={(f) => {
                    setFilters(f);
                    setPage(0);
                  }}
                  onPage={setPage}
                  onBulkDone={list.reload}
                />
                <details className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <summary className="cursor-pointer text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Hazır yanıtlar", "Canned replies")}</summary>
                  <div className="mt-3">
                    <CannedManager replies={canned.data ?? []} onChange={setCanned} />
                  </div>
                </details>
              </div>
            }
            detail={id ? <AdminTicketPane key={id} id={id} options={options.data} canned={canned.data ?? []} onChanged={onChanged} onBack={() => router.push("/admin/tickets")} /> : null}
            placeholder={t("Soldan bir talep seç.", "Pick a request on the left.")}
          />
        </>
      )}
    </div>
  );
}

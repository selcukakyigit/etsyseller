"use client";

import { useState } from "react";
import { Badge, EmptyState, ExportButton, Pager, RangeButtons, Section, useFormat } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";

const RANGES = [30, 90, 365] as const;
const STEP = 50;

/** Yönetim > Satış > Siparişler ve iadeler: kim ne aldı. Tutar, Lemon'un bildirdiği tutardır. */
export default function OrdersSection() {
  const { t } = useT();
  const f = useFormat();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [offset, setOffset] = useState(0);
  const { data, error } = useApiData(`admin:orders:${days}:${offset}`, () => api.admin.orders(days, offset));

  return (
    <Section
      title={t("Siparişler ve iadeler", "Orders and refunds")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <RangeButtons
            value={days}
            options={RANGES}
            onChange={(d) => {
              setDays(d);
              setOffset(0);
            }}
          />
          <ExportButton run={() => api.admin.exportCsv("orders", { days })} />
        </div>
      }
    >
      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.items.length === 0 && <EmptyState>{t("Bu aralıkta sipariş yok.", "No orders in this range.")}</EmptyState>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                <th className="pb-2 font-medium">{t("Tarih", "Date")}</th>
                <th className="pb-2 font-medium">{t("Hesap", "Account")}</th>
                <th className="pb-2 font-medium">{t("Paket", "Pack")}</th>
                <th className="pb-2 text-right font-medium">{t("Tutar", "Amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.items.map((o) => (
                <tr key={o.event_id} className="text-neutral-800 dark:text-neutral-200">
                  <td className="whitespace-nowrap py-2 text-xs text-neutral-500 dark:text-neutral-400">{f.dateTime(o.date)}</td>
                  <td className="max-w-[16rem] truncate py-2">
                    {o.owner_email ?? "—"}
                  </td>
                  <td className="py-2">
                    {o.product} {o.kind === "refund" && <Badge tone="warn">{t("İade", "Refund")}</Badge>}
                  </td>
                  <td className={`whitespace-nowrap py-2 text-right tabular-nums ${o.kind === "refund" ? "text-red-600 dark:text-red-400" : ""}`}>
                    {o.kind === "refund" ? "−" : ""}
                    {f.money(o.amount, o.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager offset={offset} step={STEP} total={data.total} onChange={setOffset} />}
    </Section>
  );
}

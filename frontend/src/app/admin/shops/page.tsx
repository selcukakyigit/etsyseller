"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, EmptyState, Pager, Section, inputClass, useFormat } from "@/components/admin/ui";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { AdminShopRow, AdminShopStatus, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";

const PAGE_SIZE = 50;

export default function AdminShopsPage() {
  return (
    <AdminShell current="/admin/shops">
      <Shops />
    </AdminShell>
  );
}

function Shops() {
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AdminShopStatus>("");
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useApiData(`admin:shops:${q}:${status}:${offset}`, () => api.admin.shops(q, status, offset));

  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  return (
    <Section title={t("Mağazalar", "Shops")} action={loading && data ? <Spinner size={16} /> : undefined}>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Mağaza adı ya da sahibin e-postası", "Shop name or owner email")}
          aria-label={t("Ara", "Search")}
          className={inputClass}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as AdminShopStatus);
            setOffset(0);
          }}
          aria-label={t("Durum", "Status")}
          className={inputClass}
        >
          <option value="">{t("Tüm durumlar", "All statuses")}</option>
          <option value="connected">{t("Bağlı", "Connected")}</option>
          <option value="stale">{t("Senkronu 6 saatten eski", "Sync older than 6 h")}</option>
          <option value="never">{t("Hiç senkronlanmamış", "Never synced")}</option>
          <option value="revoked">{t("Erişimi kaldırılmış", "Access revoked")}</option>
          <option value="demo">{t("Demo", "Demo")}</option>
        </select>
      </div>

      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.items.length === 0 && <EmptyState>{t("Mağaza bulunamadı.", "No shops found.")}</EmptyState>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                <th className="pb-2 font-medium">{t("Mağaza", "Shop")}</th>
                <th className="pb-2 font-medium">{t("Sahip", "Owner")}</th>
                <th className="pb-2 font-medium">{t("Durum", "Status")}</th>
                <th className="pb-2 text-right font-medium">{t("İlan", "Listings")}</th>
                <th className="pb-2 font-medium">{t("Son senkron", "Last sync")}</th>
                <th className="pb-2 font-medium">{t("Bağlandı", "Connected")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.items.map((s) => (
                <ShopRow key={s.id} shop={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager offset={offset} step={PAGE_SIZE} total={data.total} onChange={setOffset} />}
    </Section>
  );
}

function ShopRow({ shop: s }: { shop: AdminShopRow }) {
  const { t } = useT();
  const f = useFormat();
  return (
    <tr className="text-neutral-800 dark:text-neutral-200">
      <td className="py-2">
        <p className="font-medium">{s.shop_name}</p>
        <p className="font-mono text-xs text-neutral-400 dark:text-neutral-500">{s.etsy_shop_id}</p>
      </td>
      <td className="max-w-[14rem] truncate py-2">
        <Link href={`/admin/users/${s.owner_id}`} className="text-[#D97757] hover:text-[#C6613F]">
          {s.owner_email ?? `#${s.owner_id}`}
        </Link>
      </td>
      <td className="py-2">
        {s.is_demo ? (
          <Badge tone="muted">{t("Demo", "Demo")}</Badge>
        ) : s.revoked_at ? (
          <Badge tone="bad">{t("Erişim kaldırıldı", "Access revoked")}</Badge>
        ) : s.connected ? (
          <Badge tone="good">{t("Bağlı", "Connected")}</Badge>
        ) : (
          <Badge tone="warn">{t("Bağlı değil", "Not connected")}</Badge>
        )}
      </td>
      <td className="py-2 text-right tabular-nums">{f.num(s.listing_count)}</td>
      <td className="whitespace-nowrap py-2 text-xs">
        {s.listings_synced_at ? f.dateTime(s.listings_synced_at) : "—"} {s.stale && <Badge tone="warn">{t("Eski", "Stale")}</Badge>}
      </td>
      <td className="whitespace-nowrap py-2 text-xs text-neutral-500 dark:text-neutral-400">{f.date(s.connected_at)}</td>
    </tr>
  );
}

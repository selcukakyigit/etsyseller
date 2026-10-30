"use client";

import { ReactNode } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { PageTabs } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import EventsSection from "./EventsSection";
import LemonSection from "./LemonSection";
import OrdersSection from "./OrdersSection";
import ProductsSection from "./ProductsSection";
import RevenueSection from "./RevenueSection";

/** Gelir ve sipariş sekmeleri kendi verisini ister; diğerleri ortak "admin:billing" verisini (paketler, olaylar, Lemon durumu) kullanır. */
const STANDALONE = {
  revenue: { href: "/admin/billing", tr: "Gelir", en: "Revenue", Component: RevenueSection },
  orders: { href: "/admin/billing/orders", tr: "Siparişler ve iadeler", en: "Orders and refunds", Component: OrdersSection },
} as const;

const SECTIONS = {
  products: { href: "/admin/billing/products", tr: "Kredi paketleri", en: "Credit packs", Component: ProductsSection },
  events: { href: "/admin/billing/events", tr: "Son webhook olayları", en: "Recent webhook events", Component: EventsSection },
  lemon: { href: "/admin/billing/lemon", tr: "Lemon Squeezy bağlantısı", en: "Lemon Squeezy connection", Component: LemonSection },
} as const;

export type BillingSection = keyof typeof SECTIONS | keyof typeof STANDALONE;
const TABS = [STANDALONE.revenue, STANDALONE.orders, ...Object.values(SECTIONS)];

/** Yönetim > Satış: her sekme ayrı bir adres. Sekmeler aynı veriyi kullanır (önbellekte ortak), geçişte yeniden
 *  yüklenmez. */
export default function BillingPage({ section }: { section: BillingSection }) {
  if (section === "revenue" || section === "orders") {
    const { href, Component } = STANDALONE[section];
    return <Frame href={href}><Component /></Frame>;
  }
  const { href, Component } = SECTIONS[section];
  return (
    <Frame href={href}>
      <Content Component={Component} />
    </Frame>
  );
}

function Frame({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AdminShell current="/admin/billing">
      <div className="space-y-6">
        <PageTabs tabs={TABS} current={href} />
        {children}
      </div>
    </AdminShell>
  );
}

/** Veri, AdminShell yöneticiliği doğruladıktan sonra bağlanan bu parçada istenir. */
function Content({ Component }: { Component: (typeof SECTIONS)[keyof typeof SECTIONS]["Component"] }) {
  const { data, error, reload } = useApiData("admin:billing", api.admin.billing);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;
  return (
    <>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Component data={data} onChanged={reload} />
    </>
  );
}

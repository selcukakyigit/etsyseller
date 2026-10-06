"use client";

import AdminShell from "@/components/admin/AdminShell";
import { PageTabs } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import EventsSection from "./EventsSection";
import LemonSection from "./LemonSection";
import ProductsSection from "./ProductsSection";
import SubscriptionsSection from "./SubscriptionsSection";

const SECTIONS = {
  subscriptions: { href: "/admin/billing", tr: "Abonelikler", en: "Subscriptions", Component: SubscriptionsSection },
  products: { href: "/admin/billing/products", tr: "Planlar ve kredi paketleri", en: "Plans and credit packs", Component: ProductsSection },
  events: { href: "/admin/billing/events", tr: "Son webhook olayları", en: "Recent webhook events", Component: EventsSection },
  lemon: { href: "/admin/billing/lemon", tr: "Lemon Squeezy bağlantısı", en: "Lemon Squeezy connection", Component: LemonSection },
} as const;

export type BillingSection = keyof typeof SECTIONS;
const TABS = Object.values(SECTIONS);

/** Yönetim > Satış: her sekme ayrı bir adres. Sekmeler aynı veriyi kullanır (önbellekte ortak), geçişte yeniden
 *  yüklenmez. */
export default function BillingPage({ section }: { section: BillingSection }) {
  const { href, Component } = SECTIONS[section];
  return (
    <AdminShell current="/admin/billing">
      <div className="space-y-6">
        <PageTabs tabs={TABS} current={href} />
        <Content Component={Component} />
      </div>
    </AdminShell>
  );
}

/** Veri, AdminShell yöneticiliği doğruladıktan sonra bağlanan bu parçada istenir. */
function Content({ Component }: { Component: (typeof SECTIONS)[BillingSection]["Component"] }) {
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

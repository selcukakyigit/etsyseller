"use client";

import AdminShell from "@/components/admin/AdminShell";
import KeywordExplorer from "./KeywordExplorer";
import OperationsSection from "./OperationsSection";
import OverviewSection from "./OverviewSection";

const SECTIONS = {
  overview: { href: "/admin/research/overview", Component: OverviewSection },
  keywords: { href: "/admin/research/keywords", Component: KeywordExplorer },
  operations: { href: "/admin/research/operations", Component: OperationsSection },
} as const;

export type ResearchSection = keyof typeof SECTIONS;

/** Yönetim > Araştırma'nın alt sayfaları (ortak keyword havuzunun yönetimi). */
export default function ResearchPage({ section }: { section: ResearchSection }) {
  const { href, Component } = SECTIONS[section];
  return (
    <AdminShell current={href}>
      <Component />
    </AdminShell>
  );
}

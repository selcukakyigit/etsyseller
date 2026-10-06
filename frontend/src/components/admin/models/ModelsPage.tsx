"use client";

import AdminShell from "@/components/admin/AdminShell";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import CatalogSection from "./CatalogSection";
import KeysSection from "./KeysSection";
import TasksSection from "./TasksSection";

const SECTIONS = {
  keys: { href: "/admin/models/keys", Component: KeysSection },
  tasks: { href: "/admin/models/tasks", Component: TasksSection },
  catalog: { href: "/admin/models/catalog", Component: CatalogSection },
} as const;

export type ModelsSection = keyof typeof SECTIONS;

/** Yönetim > Modeller'in alt sayfaları aynı katalog verisini kullanır (önbellekte ortak); sayfalar arası geçişte yeniden
 *  yüklenmez. */
export default function ModelsPage({ section }: { section: ModelsSection }) {
  const { href, Component } = SECTIONS[section];
  return (
    <AdminShell current={href}>
      <Content Component={Component} />
    </AdminShell>
  );
}

function Content({ Component }: { Component: (typeof SECTIONS)[ModelsSection]["Component"] }) {
  const { t } = useT();
  const { data, error, reload } = useApiData("admin:catalog", api.admin.catalog);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data.from_db && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t(
            "Katalog tabloları okunamadı; AI şu an .env ayarlarıyla çalışıyor. 0024 veritabanı göçünü uygulayın.",
            "The catalog tables could not be read; AI is running on .env settings. Apply database migration 0024.",
          )}
        </p>
      )}
      <Component data={data} onChanged={reload} />
    </div>
  );
}

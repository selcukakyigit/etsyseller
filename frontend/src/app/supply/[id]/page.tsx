"use client";

import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { pageContainer } from "@/components/layout/pageContainer";
import { PageSpinner } from "@/components/ui/Spinner";
import { useApiData } from "@/lib/useApiData";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import { useT } from "@/lib/i18n-client";
import { useUrlTab } from "@/lib/useUrlTab";
import EntityAvatar from "@/modules/components/EntityAvatar";
import PriceBookTable from "@/modules/components/PriceBookTable";
import ProductMeasures from "@/modules/components/ProductMeasures";
import SharingPanel from "@/modules/components/SharingPanel";
import { isMember } from "@/modules/core/api";
import ModuleShell, { ShellTab } from "@/modules/core/ModuleShell";
import { card, errorText } from "@/modules/core/ui";
import { useUrlParam } from "@/modules/core/useUrlParam";
import { MODULE_PATH, supplyApi } from "@/modules/supply/api";
import DocumentsTab from "@/modules/supply/DocumentsTab";
import JobsTab from "@/modules/supply/JobsTab";
import OverviewTab from "@/modules/supply/OverviewTab";
import PackagesTab from "@/modules/supply/PackagesTab";
import SupplySettings from "@/modules/supply/SupplySettings";
import ReportsTab from "@/modules/supply/ReportsTab";
import { supplyStore } from "@/modules/supply/store";

const TABS = ["overview", "prices", "products", "packages", "jobs", "documents", "reports", "sharing", "settings"] as const;
type Tab = (typeof TABS)[number];

export default function SupplierPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { user, shops, activeShop, setActiveShopId } = useAuthAndShop();
  const { t } = useT();
  const [tab, setTab] = useUrlTab<Tab>("tab", "overview", TABS);
  const [jobParam, setJobParam] = useUrlParam("job");
  const [status, setStatus] = useUrlParam("status");
  const { data: entity, error, reload } = useApiData(`supply-entity:${id}`, () => supplyApi.get(id));
  const access = entity?.access;
  const member = isMember(access);
  const guest = access?.role === "guest";

  const tabs: ShellTab<Tab>[] = [
    { id: "overview", tr: "Genel", en: "Overview" },
    { id: "prices", tr: "Fiyat listesi", en: "Price list" },
    ...(member
      ? [
          { id: "products" as const, tr: "Ürünler", en: "Products" },
          { id: "packages" as const, tr: "Paketler", en: "Packages" },
        ]
      : []),
    { id: "jobs", tr: "İşler", en: "Jobs", count: member ? entity?.summary?.submitted : undefined },
    { id: "documents", tr: "Belgeler", en: "Documents" },
    { id: "reports", tr: "Raporlar", en: "Reports" },
    ...(member
      ? [
          { id: "sharing" as const, tr: "Paylaşım", en: "Sharing" },
          { id: "settings" as const, tr: "Ayarlar", en: "Settings" },
        ]
      : []),
  ];
  const current: Tab = (tab === "sharing" || tab === "products" || tab === "packages" || tab === "settings") && !member ? "overview" : tab;

  function changed() {
    reload();
    void supplyStore.refresh();
  }

  function openJob(jobId: number | null) {
    if (current !== "jobs") setTab("jobs");
    setJobParam(jobId ? String(jobId) : "");
  }

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current={`${MODULE_PATH}/${id}`}>
      {!entity ? (
        error ? (
          <div className={pageContainer("reading")}>
            <div className={card}>
              <p className={errorText}>{error}</p>
            </div>
          </div>
        ) : (
          <PageSpinner />
        )
      ) : (
        <ModuleShell
          backHref={MODULE_PATH}
          backLabel={t("Dış Tedarik", "External suppliers")}
          title={entity.name}
          avatar={<EntityAvatar name={entity.name} src={entity.image ? supplyApi.imageUrl(id, entity.image) : null} size={40} />}
          label={entity.label || undefined}
          roleBadge={guest ? t("seninle paylaşıldı", "shared with you") : entity.archived ? t("arşivde", "archived") : undefined}
          tabs={tabs}
          tab={current}
          prefsKey={`supply:${id}`}
          fixedTabs={["overview", "settings"]}
          onTab={(x) => {
            setTab(x);
            if (x !== "jobs") setJobParam("");
          }}
        >
          {current === "overview" && (
            <OverviewTab
              entity={entity}
              summary={entity.summary}
              access={access}
              onOpenTab={(x) => {
                setTab(x);
                setJobParam("");
              }}
              onOpenJobs={(s) => {
                setStatus(s);
                openJob(null);
              }}
            />
          )}
          {current === "prices" && <PriceBookTable api={supplyApi} entityId={id} currency={entity.currency} access={access} />}
          {current === "products" && member && <ProductMeasures api={supplyApi} entityId={id} />}
          {current === "packages" && member && <PackagesTab entityId={id} currency={entity.currency} />}
          {current === "jobs" && (
            <JobsTab
              entityId={id}
              currency={entity.currency}
              vatRate={entity.vat_rate}
              access={access}
              jobId={jobParam ? Number(jobParam) : null}
              onJob={openJob}
              status={status}
              onStatus={setStatus}
              onChanged={reload}
            />
          )}
          {current === "documents" && <DocumentsTab entityId={id} access={access} onOpenJob={(j) => openJob(j)} />}
          {current === "reports" && <ReportsTab entityId={id} currency={entity.currency} />}
          {current === "sharing" && member && <SharingPanel api={supplyApi} entityId={id} whoTr="Tedarikçiyi" whoEn="the supplier" />}
          {current === "settings" && member && <SupplySettings entity={entity} onChanged={changed} />}
        </ModuleShell>
      )}
    </AppShell>
  );
}

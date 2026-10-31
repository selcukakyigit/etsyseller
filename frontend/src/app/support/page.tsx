"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Button, EmptyState } from "@/components/admin/ui";
import { pageContainer } from "@/components/layout/pageContainer";
import NewTicketModal from "@/components/support/NewTicketModal";
import TicketLayout from "@/components/support/TicketLayout";
import TicketRow from "@/components/support/TicketRow";
import UserTicketPane from "@/components/support/UserTicketPane";
import HelpTip from "@/components/ui/HelpTip";
import { startTour } from "@/components/tour/steps";
import { BlockSpinner, PageSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { TicketDetail, TicketSummary, supportApi } from "@/lib/supportApi";
import { useApiData } from "@/lib/useApiData";
import { useAuthAndShop } from "@/lib/useAuthAndShop";

type Filter = "all" | "open" | "done";

function SupportPageInner() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const id = Number(params.get("id")) || null;
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [filter, setFilter] = useState<Filter>("all");
  const { data, setData, error } = useApiData("support:list", () => supportApi.list());

  /** Seçili talep değişince (açılış, yanıt, tamamlama, puan) listedeki satır da güncellenir. */
  function patchRow(updated: TicketDetail) {
    const row: TicketSummary = { ...updated, user_unread: false };
    setData(data ? (data.some((r) => r.id === row.id) ? data.map((r) => (r.id === row.id ? row : r)) : [row, ...data]) : [row]);
  }

  const shown = (data ?? []).filter((r) => filter === "all" || (filter === "done") === (r.status === "resolved"));
  const chip = (value: Filter, label: string) => (
    <button
      type="button"
      key={value}
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        filter === value ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );

  const list = (
    <div className="space-y-3">
      <div className="flex gap-1">
        {chip("all", t("Hepsi", "All"))}
        {chip("open", t("Açık", "Open"))}
        {chip("done", t("Tamamlanan", "Done"))}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.length === 0 && <EmptyState>{t("Henüz talebin yok.", "You have no requests yet.")}</EmptyState>}
      {data && data.length > 0 && shown.length === 0 && <EmptyState>{t("Bu süzgece uyan talep yok.", "No requests match this filter.")}</EmptyState>}
      <ul className="space-y-1.5">
        {shown.map((r) => (
          <li key={r.id}>
            <TicketRow ticket={r} href={`/support?id=${r.id}`} active={r.id === id} />
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/support">
      <div className={pageContainer("page", "normal", "space-y-5")}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {t("Yardım & Destek", "Help & Support")}
            <HelpTip>
              {t(
                "Bir hata görürsen ya da bir şeyi anlamazsan buradan talep aç; ekran görüntüsünü yapıştırabilirsin. Her talebin bir numarası var (#12); yanıt gelince ya da isteğin tamamlanınca burada ve e-postayla haber verilir. Asistana \"bunu destek ekibine ilet\" diyerek de talep açabilirsin.",
                "If you see a bug or something is unclear, open a request here and paste a screenshot. Every request has a number (#12); you are notified here and by email when we reply or when your request is done. You can also ask the assistant to \"send this to the support team\".",
              )}
            </HelpTip>
          </h1>
          <div className="flex items-center gap-2">
            <Button onClick={startTour}>{t("Ürün turu", "Product tour")}</Button>
            <Button tone="primary" onClick={() => setCreating(true)}>
              {t("Yeni talep", "New request")}
            </Button>
          </div>
        </div>
        {bootError && <p className="text-sm text-red-600 dark:text-red-400">{bootError}</p>}
        {!user ? (
          <PageSpinner />
        ) : (
          <TicketLayout
            list={list}
            detail={id ? <UserTicketPane key={id} id={id} onChanged={patchRow} /> : null}
            detailTitle={t(`Talep #${id}`, `Request #${id}`)}
            onCloseDetail={() => router.push("/support")}
            placeholder={t("Soldan bir talep seç ya da yenisini aç.", "Pick a request on the left or open a new one.")}
          />
        )}
      </div>
      {creating && (
        <NewTicketModal
          shopName={activeShop?.shop_name ?? null}
          prefill={params.get("error") ?? ""}
          onClose={() => {
            setCreating(false);
            if (params.get("new")) router.replace(id ? `/support?id=${id}` : "/support");
          }}
          onCreated={(created) => {
            setCreating(false);
            void supportApi.list().then(setData);
            router.replace(`/support?id=${created}`);
          }}
        />
      )}
    </AppShell>
  );
}

// useSearchParams() üretim derlemesinde Suspense sınırı ister; yoksa sayfa önceden render edilemez ve build düşer.
export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportPageInner />
    </Suspense>
  );
}

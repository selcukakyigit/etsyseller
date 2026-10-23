"use client";

import { useState } from "react";
import { Button, EmptyState } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { DiscoverItem, discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import FilterBar from "./FilterBar";
import KeywordDetailModal from "./KeywordDetailModal";
import KeywordTable from "./KeywordTable";
import { downloadCsv, toCsv } from "./table";
import { useResultsView } from "./useResultsView";

const NO_ITEMS: DiscoverItem[] = [];
const NO_ETSY: Record<string, number | null> = {};

/** Kaydedilen kelimeler: koleksiyonlara göre; ölçümler ortak havuzdan okunur. Aynı süzgeç/sıralama tablosunu kullanır; kelimeler koleksiyondan çıkarılabilir. */
export default function SavedPanel({ shopId, refreshKey, onChanged }: { shopId: number; refreshKey: number; onChanged: () => void }) {
  const { t } = useT();
  const [collection, setCollection] = useState<string | undefined>(undefined);
  const { data, error, reload } = useApiData(`discover:saved:${shopId}:${collection ?? "_first"}:${refreshKey}`, () => discoverApi.saved(shopId, collection));
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<DiscoverItem | null>(null);
  const v = useResultsView(data?.items ?? NO_ITEMS, "", NO_ETSY, false);

  async function remove(terms: string[]) {
    if (!data || terms.length === 0) return;
    setBusy(true);
    try {
      await discoverApi.unsave(shopId, terms, data.collection);
      v.clearSelection();
      reload();
      onChanged();
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;
  if (data.collections.length === 0) {
    return <EmptyState>{t("Henüz kaydedilmiş kelime yok. Araştırma sonuçlarında kelime seçip kaydedebilirsin.", "No saved keywords yet. Select keywords in the research results to save them.")}</EmptyState>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {data.collections.map((c) => {
          const active = c.name === data.collection;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => {
                v.clearSelection();
                setCollection(c.name);
              }}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                active ? "border-[#D97757] bg-[#D97757]/10 font-medium text-neutral-900 dark:text-neutral-100" : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {c.name === "" ? t("Genel", "General") : c.name} <span className="text-xs text-neutral-400">{c.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={() => downloadCsv(`saved-${(data.collection || "general").replace(/\s+/g, "-")}.csv`, toCsv(v.view, NO_ETSY))}>{t("CSV indir", "Download CSV")}</Button>
      </div>

      <FilterBar
        filters={v.filters}
        onChange={v.setFilters}
        groups={v.groups}
        shown={v.view.length}
        total={data.items.length}
        volume={v.volume}
        rowCount={v.rows.length}
        showVariants={v.showVariants}
        onShowVariants={v.setShowVariants}
      />
      <div className="min-h-[12rem]">
        <KeywordTable
          rows={v.rows}
          selected={v.selected}
          onToggle={v.toggle}
          onToggleMany={v.toggleMany}
          sort={v.sort}
          onSort={v.onSort}
          etsy={NO_ETSY}
          showEtsy={false}
          emptyText={data.items.length === 0 ? t("Bu koleksiyon boş.", "This collection is empty.") : t("Süzgeçlere uyan kelime yok.", "No keywords match the filters.")}
          onRemove={(term) => void remove([term])}
          onOpen={setDetail}
        />
      </div>

      {v.selected.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-sm text-neutral-900 dark:text-neutral-100">{t(`${v.selected.size} kelime seçili`, `${v.selected.size} keywords selected`)}</p>
          <Button tone="danger" busy={busy} onClick={() => void remove([...v.selected])}>
            {t("Koleksiyondan çıkar", "Remove from collection")}
          </Button>
        </div>
      )}
      {detail && <KeywordDetailModal shopId={shopId} item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

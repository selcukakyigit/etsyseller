"use client";

import { useState } from "react";
import { Button, EmptyState } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { KeywordRow } from "./shared";

/** Kaydedilen kelimeler: koleksiyonlara göre; talep bandı ortak havuzdan okunur. Kelimeler koleksiyondan çıkarılabilir. */
export default function SavedPanel({ shopId, refreshKey, onChanged }: { shopId: number; refreshKey: number; onChanged: () => void }) {
  const { t } = useT();
  const [collection, setCollection] = useState<string | undefined>(undefined);
  const { data, error, reload } = useApiData(`discover:saved:${shopId}:${collection ?? "_first"}:${refreshKey}`, () => discoverApi.saved(shopId, collection));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!data) return;
    setBusy(true);
    try {
      await discoverApi.unsave(shopId, [...selected], data.collection);
      setSelected(new Set());
      reload();
      onChanged();
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(term: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
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
                setSelected(new Set());
                setCollection(c.name);
              }}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                active
                  ? "border-[#D97757] bg-[#D97757]/10 font-medium text-neutral-900 dark:text-neutral-100"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {c.name === "" ? t("Genel", "General") : c.name} <span className="text-xs text-neutral-400">{c.count}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-[16rem] rounded-xl border border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
        {data.items.length === 0 ? (
          <EmptyState>{t("Bu koleksiyon boş.", "This collection is empty.")}</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.items.map((i) => (
              <KeywordRow key={i.term} item={i} checked={selected.has(i.term)} onToggle={() => toggle(i.term)} />
            ))}
          </ul>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-sm text-neutral-900 dark:text-neutral-100">{t(`${selected.size} kelime seçili`, `${selected.size} keywords selected`)}</p>
          <Button tone="danger" busy={busy} onClick={() => void remove()}>
            {t("Koleksiyondan çıkar", "Remove from collection")}
          </Button>
        </div>
      )}
    </div>
  );
}

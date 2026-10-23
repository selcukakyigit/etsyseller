"use client";

import { useCallback, useMemo, useState } from "react";
import { SavedCollection, discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { useStoredState } from "@/lib/useStoredState";

export const MAX_COLLECTION_NAME = 60;

/** Kelimelerin eklendiği "aktif koleksiyon": mağaza başına tarayıcıda hatırlanır. Seçilmemişse (`active === null`) önce bir koleksiyon oluşturulur; oluşturulan koleksiyon
 * ilk kelime eklenince kalıcı olur (koleksiyon, içindeki kelimelerin adıdır). Satırdaki yeşil + bu koleksiyona tek dokunuşla ekler, ✓'ye dokunmak çıkarır.
 * Üyelik sorgusu sunucudan gelir; dokunuşlar anında görünsün diye yerel bir üst yazım kullanılır, hata olursa geri alınır. */
export function useCollection(shopId: number, collections: SavedCollection[], onChanged: () => void) {
  const { t } = useT();
  const [stored, setStored] = useStoredState<string>(`discover.collection:${shopId}`, "");
  const active = stored.startsWith("c:") ? stored.slice(2) : null;
  const members = useApiData(`discover:members:${shopId}:${active ?? "-"}`, async () => (active === null ? null : (await discoverApi.saved(shopId, active)).items.map((i) => i.term)));
  const [override, setOverride] = useState<Record<string, boolean>>({});

  const names = useMemo(() => {
    const base = collections.map((c) => c.name);
    return active !== null && !base.includes(active) ? [...base, active] : base;
  }, [collections, active]);
  const counts = useMemo(() => Object.fromEntries(collections.map((c) => [c.name, c.count])), [collections]);

  const memberSet = useMemo(() => new Set(members.data ?? []), [members.data]);
  const has = useCallback(
    (term: string) => {
      const o = override[`${active}:${term}`];
      return o !== undefined ? o : memberSet.has(term);
    },
    [override, memberSet, active],
  );

  const choose = useCallback((name: string) => setStored(`c:${name}`), [setStored]);
  const create = useCallback((name: string) => setStored(`c:${name.replace(/\s+/g, " ").trim().slice(0, MAX_COLLECTION_NAME)}`), [setStored]);

  const mark = useCallback((terms: string[], value: boolean | undefined) => {
    setOverride((prev) => {
      const next = { ...prev };
      for (const term of terms) {
        const key = `${active}:${term}`;
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      return next;
    });
  }, [active]);

  const add = useCallback(
    async (terms: string[]) => {
      if (active === null || terms.length === 0) return;
      mark(terms, true);
      try {
        const r = await discoverApi.save(shopId, terms, active);
        if (terms.length > 1) toast.success(r.added > 0 ? t(`${r.added} kelime eklendi.`, `${r.added} keywords added.`) : t("Bu kelimeler zaten koleksiyonda.", "These keywords are already in the collection."));
        onChanged();
        members.reload();
      } catch (e) {
        mark(terms, undefined);
        if (e instanceof Error && e.message) toast.error(e.message);
      }
    },
    [active, shopId, mark, onChanged, members, t],
  );

  const remove = useCallback(
    async (term: string) => {
      if (active === null) return;
      mark([term], false);
      try {
        await discoverApi.unsave(shopId, [term], active);
        onChanged();
        members.reload();
      } catch (e) {
        mark([term], undefined);
        if (e instanceof Error && e.message) toast.error(e.message);
      }
    },
    [active, shopId, mark, onChanged, members],
  );

  return { active, names, counts, has, choose, create, add, remove };
}

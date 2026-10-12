"use client";

import { useEffect, useSyncExternalStore } from "react";
import { tNow } from "@/lib/i18n-client";
import { EntityList } from "./api";
import { errMsg } from "./errors";

export type EntityStoreState = { list: EntityList | null; error: string | null };

/** Bir modülün kayıt listesi için paylaşımlı depo: kenar çubuğu ve modül sayfası aynı veriyi kullanır; kayıt eklenip
 * silinince `refresh()` ikisini birden günceller. Yükleme başarısız olursa `error` dolar (ekran sonsuza dek dönmesin,
 * hata ve "tekrar dene" göstersin); eski liste varsa korunur. */
export function createEntityStore(load: () => Promise<EntityList>) {
  let state: EntityStoreState = { list: null, error: null };
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function set(next: EntityStoreState) {
    state = next;
    listeners.forEach((l) => l());
  }

  function refresh(): Promise<void> {
    inflight = load()
      .then((list) => set({ list, error: null }))
      .catch((e) => set({ list: state.list, error: errMsg(e, tNow("Liste yüklenemedi", "Could not load the list")) }))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  }

  const serverState: EntityStoreState = { list: null, error: null };

  /** `enabled` false iken (ör. kullanıcı henüz gelmedi) yükleme başlamaz. */
  function useState(enabled = true): EntityStoreState {
    const snapshot = useSyncExternalStore(subscribe, () => state, () => serverState);
    useEffect(() => {
      if (enabled && state.list === null && state.error === null && inflight === null) void refresh();
    }, [enabled]);
    return snapshot;
  }

  function clear() {
    set({ list: null, error: null });
  }

  return { useState, refresh, clear };
}

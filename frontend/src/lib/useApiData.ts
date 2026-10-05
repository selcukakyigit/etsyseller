"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tNow } from "@/lib/i18n";
import { useCached } from "@/lib/pageCache";

/** Sayfa verisi: sayfaya dönülünce son veri hemen görünür (useCached), arkada tazelenir. `key` sorguyu da
 * içermeli (ör. arama metni); anahtar değişince yeniden yüklenir. Sırası karışan cevaplarda yalnızca sonuncusu yazılır. */
export function useApiData<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useCached<T>(key, { keepPrevious: true });
  // Son biten isteğin hangi anahtar için olduğu: anahtar değişince eski hata gösterilmez, "yükleniyor" kendiliğinden döner.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const latest = useRef(0);
  const loadRef = useRef(load);
  // Yükleme efektinden önce tanımlı: aynı işlemede önce güncel `load` yazılır, sonra yükleme başlar.
  useEffect(() => {
    loadRef.current = load;
  });

  const fetchNow = useCallback(() => {
    const id = ++latest.current;
    loadRef.current()
      .then((value) => {
        if (id !== latest.current) return;
        setData(value);
        setSettled({ key, error: null });
      })
      .catch((e) => {
        if (id === latest.current) setSettled({ key, error: e instanceof Error ? e.message : tNow("Bilinmeyen hata", "Unknown error") });
      });
  }, [key, setData]);

  useEffect(() => {
    fetchNow();
  }, [fetchNow]);

  const reload = useCallback(() => {
    setSettled(null);
    fetchNow();
  }, [fetchNow]);

  const done = settled?.key === key;
  return { data, setData, error: done ? settled.error : null, loading: !done, reload };
}

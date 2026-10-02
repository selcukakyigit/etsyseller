import { useCallback, useState } from "react";

/** Sayfa verisinin sekme belleğindeki kopyası: bir sayfaya geri dönülünce son veri hemen gösterilir, sayfa
 * yenisini isteyip gelince değiştirir. Anahtar mağaza ve sorguyu içerir; başka mağazanın verisi karışmaz.
 * Sayfa yenilenince ya da çıkışta boşalır (bkz. clearPageCache). */
const cache = new Map<string, unknown>();

export function clearPageCache() {
  cache.clear();
}

/** `useState` gibi çalışır ama değer anahtara bağlıdır: anahtar değişince o anahtarın önbellekteki değeri
 * (yoksa null) döner; set edilen değer hem duruma hem önbelleğe yazılır. Anahtar null ise hiçbir şey tutulmaz.
 * `keepPrevious`: yeni anahtarın verisi yoksa bir öncekini döndürür (ör. sekme/filtre değişirken liste boşalmasın);
 * üçüncü değer, dönen verinin gerçekten bu anahtara ait olup olmadığıdır. */
export function useCached<T>(key: string | null, opts?: { keepPrevious?: boolean }): [T | null, (value: T) => void, boolean] {
  const [state, setState] = useState<{ key: string | null; value: T } | null>(null);
  const own = state && state.key === key ? state.value : key !== null ? ((cache.get(key) as T | undefined) ?? null) : null;
  const value = own ?? (opts?.keepPrevious && state ? state.value : null);
  const set = useCallback(
    (v: T) => {
      if (key !== null) cache.set(key, v);
      setState({ key, value: v });
    },
    [key],
  );
  return [value, set, own !== null];
}

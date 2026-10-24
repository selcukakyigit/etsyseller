import { useCallback, useState } from "react";

/** Sayfa verisinin sekme belleğindeki kopyası: bir sayfaya geri dönülünce son veri hemen gösterilir, sayfa
 * yenisini isteyip gelince değiştirir. Anahtar mağaza ve sorguyu içerir; başka mağazanın verisi karışmaz.
 * Sayfa yenilenince ya da çıkışta boşalır (bkz. clearPageCache). */
const cache = new Map<string, unknown>();

/** Sayfa yenilenince (F5) da son veri görünsün diye bellek kopyası sekme depolamasına (sessionStorage) yansıtılır; sekme kapanınca ya da
 * çıkışta silinir. Depolama kapalı/dolu olabilir: hata sessizce yutulur, bellek kopyası yine çalışır. */
const STORE_PREFIX = "pc:";

function storeGet(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function storeSet(key: string, value: unknown) {
  try {
    sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* depolama dolu ya da kapalı */
  }
}

function cacheGet(key: string): unknown {
  if (cache.has(key)) return cache.get(key);
  const stored = storeGet(key);
  if (stored !== undefined) cache.set(key, stored);
  return stored;
}

function cacheSet(key: string, value: unknown) {
  cache.set(key, value);
  storeSet(key, value);
}

export function clearPageCache() {
  cache.clear();
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(STORE_PREFIX)) sessionStorage.removeItem(k);
  } catch {
    /* yok say */
  }
}

/** Anahtarı çağrı anında verilen okuma/yazma. `useCached`'in `set`i render'daki anahtara bağlıdır; anahtar aynı olay yöneticisinde değişiyorsa
 * (ör. arama gönderilince sorgu değişir) sonucu yeni anahtara yazmak için bunlar kullanılır. */
export function readPageCache<T>(key: string): T | null {
  return (cacheGet(key) as T | undefined) ?? null;
}

export function writePageCache<T>(key: string, value: T): void {
  cacheSet(key, value);
}

/** `useState` gibi çalışır ama değer anahtara bağlıdır: anahtar değişince o anahtarın önbellekteki değeri
 * (yoksa null) döner; set edilen değer hem duruma hem önbelleğe yazılır. Anahtar null ise hiçbir şey tutulmaz.
 * `keepPrevious`: yeni anahtarın verisi yoksa bir öncekini döndürür (ör. sekme/filtre değişirken liste boşalmasın);
 * üçüncü değer, dönen verinin gerçekten bu anahtara ait olup olmadığıdır. */
export function useCached<T>(key: string | null, opts?: { keepPrevious?: boolean }): [T | null, (value: T) => void, boolean] {
  const [state, setState] = useState<{ key: string | null; value: T } | null>(null);
  const own = state && state.key === key ? state.value : key !== null ? ((cacheGet(key) as T | undefined) ?? null) : null;
  const value = own ?? (opts?.keepPrevious && state ? state.value : null);
  const set = useCallback(
    (v: T) => {
      if (key !== null) cacheSet(key, v);
      setState({ key, value: v });
    },
    [key],
  );
  return [value, set, own !== null];
}

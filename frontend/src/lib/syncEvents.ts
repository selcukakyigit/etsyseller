/**
 * Etsy senkronizasyonu (navbar ikonu) bitince sayfaların kendini tazelemesi için küçük bir tarayıcı olayı.
 * Tek bir "senkronize et" düğmesi olduğu için (Topbar), açık olan sayfa senkron bittiğini buradan öğrenir.
 */
const EVENT = "etsy-sync-done";

export function emitSyncDone(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Senkron bitince `cb` çağrılır; döndürülen fonksiyon aboneliği kaldırır. */
export function onSyncDone(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Sıra takibi değişti (arama eklendi/çıkarıldı, ölçüldü): listing sayfasındaki rozet ve "Takipte" sayısı tazelenir. */
const RANKS_EVENT = "ranks-changed";

export function emitRanksChanged(): void {
  window.dispatchEvent(new Event(RANKS_EVENT));
}

export function onRanksChanged(cb: () => void): () => void {
  window.addEventListener(RANKS_EVENT, cb);
  return () => window.removeEventListener(RANKS_EVENT, cb);
}

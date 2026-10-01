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

import type { Shop, User } from "@/lib/api";

/** Sayfalar arası geçişte kullanıcı ve mağaza listesini hatırlar: her sayfa yeniden /me ve /shops beklemesin diye.
 * Yalnızca bu sekmenin belleğinde durur (sayfa yenilenince boşalır); çıkışta temizlenir. */
export const sessionCache: { user: User | null; shops: Shop[] | null } = { user: null, shops: null };

export function clearSessionCache() {
  sessionCache.user = null;
  sessionCache.shops = null;
}

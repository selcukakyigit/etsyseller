import type { Shop, User } from "@/lib/api";
import { clearPageCache } from "@/lib/pageCache";
import { HAS_SHOP_KEY } from "@/lib/useShopState";

/** Sayfalar arası geçişte kullanıcı ve mağaza listesini hatırlar: her sayfa yeniden /me ve /shops beklemesin diye.
 * Yalnızca bu sekmenin belleğinde durur (sayfa yenilenince boşalır); çıkışta temizlenir. */
export const sessionCache: { user: User | null; shops: Shop[] | null } = { user: null, shops: null };

export function clearSessionCache() {
  sessionCache.user = null;
  sessionCache.shops = null;
  clearPageCache();
  try {
    window.localStorage.removeItem(HAS_SHOP_KEY);
  } catch {
    // depolama yoksa silinecek bir şey de yok
  }
}

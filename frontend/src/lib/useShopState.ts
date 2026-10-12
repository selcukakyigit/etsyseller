"use client";

import { useEffect } from "react";
import type { Shop } from "@/lib/api";
import { useStoredState } from "@/lib/useStoredState";

/** Çıkışta silinir (bkz. sessionCache.clearSessionCache): ortak tarayıcıda önceki kullanıcının durumu kalmasın. */
export const HAS_SHOP_KEY = "ulagg:has-shop";

/** Bağlı Etsy mağazası durumu: "yes" / "no" / "unknown" (liste henüz gelmedi ve tarayıcıda hatırlanan bir durum yok). */
export type ShopState = "yes" | "no" | "unknown";

/** Menü ve sayfa gövdesi için "bağlı mağaza var mı". Mağaza listesi gelene kadar tarayıcıda hatırlanan son durum kullanılır; hiç
 * hatırlanan durum yoksa (ilk giriş) "unknown" döner: o sürede mağazaya ait menü öğeleri çizilmez ve mağaza gerektiren sayfa
 * yerine küçük bir spinner görünür. Böylece ne tam menü çizilip sonra küçülür, ne de sayfa çizilip sonra "mağazanı bağla"ya döner.
 * Liste geldiğinde durum güncellenir ve hatırlanır (Etsy bağlanınca menüler kendiliğinden açılır). */
export function useShopState(shops: Shop[] | null | undefined): ShopState {
  const [hint, setHint] = useStoredState<ShopState>("has-shop", "unknown", ["yes", "no", "unknown"]);
  const actual: ShopState | null = shops == null ? null : shops.some((s) => s.connected) ? "yes" : "no";
  useEffect(() => {
    if (actual !== null && actual !== hint) setHint(actual);
  }, [actual, hint, setHint]);
  return actual ?? hint;
}

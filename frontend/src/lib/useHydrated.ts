"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Sunucu çıktısında ve hidrasyon çiziminde false, tarayıcıda hemen sonra true. Tarayıcıda hatırlanan bir duruma
 * (ör. bkz. useShopState) bağlı alanlar, sunucu HTML'i yanlış varsayımla görünüp sonra değişmesin diye bunu bekler. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

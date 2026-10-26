"use client";

import { useSyncExternalStore } from "react";

/** Ekran koşulu (ör. `"(min-width: 1024px)"`) sağlanıyor mu? Sunucuda ve ilk çizimde `false` (önce dar ekran varsayılır); sonra gerçek değere geçer
 * ve pencere boyutu değişince güncellenir. Yalnızca CSS ile çözülemeyen yerlerde kullan (aynı içeriğin masaüstünde yerinde, mobilde çekmecede durması gibi). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Masaüstü düzeni (Tailwind `lg`: 1024px ve üstü). */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

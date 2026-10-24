"use client";

import { useEffect } from "react";

let locks = 0;
let saved = "";

/** Açık bir pencere/çekmece sırasında arkadaki sayfanın kaymasını engeller. Üst üste açılan pencerelerde (ör. önizleme + modal)
 *  sayaçla çalışır: sayfa ancak sonuncusu kapanınca tekrar kayar. */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    if (locks++ === 0) {
      saved = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (--locks === 0) document.body.style.overflow = saved;
    };
  }, [active]);
}

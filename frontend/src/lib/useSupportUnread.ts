"use client";

import { useCallback, useEffect, useState } from "react";
import { supportApi } from "@/lib/supportApi";

const EVENT = "support:unread-changed";

/** Talepler sayfası bir şeyi okundu yaptığında menüdeki rozetin hemen güncellenmesi için. */
export function notifySupportUnreadChanged() {
  window.dispatchEvent(new Event(EVENT));
}

/** Menü rozeti: yanıtlanmış / tamamlanmış ve henüz okunmamış talep sayısı. Sekmeye dönünce ve 2 dakikada bir tazelenir. */
export function useSupportUnread(enabled: boolean): number {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    if (!enabled || document.hidden) return;
    supportApi.unread().then((r) => setCount(r.count)).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 120_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(EVENT, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(EVENT, refresh);
    };
  }, [refresh]);
  return count;
}

"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

const EVERY_MS = 60_000;

/** Sekme görünürken dakikada bir ve sayfa değişince sunucuya "buradayım" der; yönetim panelindeki çevrimiçi listesi
 * buradan beslenir. Sekme arka plandayken sinyal gitmez, öne gelince hemen gider. */
export function usePresence(path: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const send = () => {
      if (document.visibilityState === "visible") void api.auth.ping(window.location.pathname || path);
    };
    send();
    const timer = setInterval(send, EVERY_MS);
    document.addEventListener("visibilitychange", send);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
    };
  }, [path, enabled]);
}

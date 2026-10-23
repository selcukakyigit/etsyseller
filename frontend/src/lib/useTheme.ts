"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const EVENT = "ulagg-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

// localStorage kullanılamıyorsa (gizli pencere, engellenmiş depolama) seçim yalnızca bu oturumda bellekte kalır.
let sessionChoice: Theme | null = null;

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function currentTheme(): Theme {
  return sessionChoice ?? readStoredTheme() ?? (window.matchMedia(DARK_QUERY).matches ? "dark" : "light");
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
}

function subscribe(cb: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  media.addEventListener("change", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
    media.removeEventListener("change", cb);
  };
}

/** Manual light/dark toggle, persisted in localStorage. Defaults to the OS
 * preference on first visit (see the blocking script in layout.tsx, which
 * applies the same choice before paint to avoid a flash). Sunucuda ve hidrasyon çiziminde "light" döner, hemen
 * ardından tarayıcıdaki gerçek değere geçer. */
export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, currentTheme, () => "light");

  // Sınıfı sayfaya uygular (yalnızca DOM; durum ayarlamaz).
  useEffect(() => applyTheme(theme), [theme]);

  const setTheme = useCallback((next: Theme) => {
    sessionChoice = next;
    try {
      window.localStorage.setItem("theme", next);
    } catch {
      // localStorage unavailable (private mode, blocked storage) — theme just
      // won't persist across reloads, no functional impact otherwise.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  return { theme, toggle };
}

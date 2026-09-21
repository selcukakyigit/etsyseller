"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, Shop, User } from "@/lib/api";

const ACTIVE_SHOP_KEY = "activeShopId";

function readStoredShopId(): number | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_SHOP_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** Shared auth/shop bootstrap for every protected page: redirects to /login
 * on 401, then loads the user's shops and picks the active one — the last
 * one explicitly chosen via setActiveShopId (persisted per-browser), or the
 * first connected shop otherwise. */
export function useAuthAndShop() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [activeShopId, setActiveShopIdState] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(() => {
    api.auth
      .me()
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          router.push("/login");
        } else {
          setError(e instanceof Error ? e.message : "Bilinmeyen hata");
        }
      });
  }, [router]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!user) return;
    api.shops
      .list()
      .then(setShops)
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [user]);

  useEffect(() => {
    if (!shops) return;
    const connected = shops.filter((s) => s.connected);
    if (connected.length === 0) {
      setActiveShopIdState(null);
      return;
    }
    const stored = readStoredShopId();
    const isStoredStillConnected = stored !== null && connected.some((s) => s.id === stored);
    setActiveShopIdState(isStoredStillConnected ? stored : connected[0].id);
  }, [shops]);

  const setActiveShopId = useCallback((id: number) => {
    setActiveShopIdState(id);
    try {
      window.localStorage.setItem(ACTIVE_SHOP_KEY, String(id));
    } catch {
      // localStorage unavailable — selection just won't persist across reloads.
    }
  }, []);

  const activeShop = shops?.find((s) => s.id === activeShopId) ?? null;

  return { user, shops, activeShop, setActiveShopId, error, refreshUser: loadUser };
}

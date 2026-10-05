"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, Shop, User } from "@/lib/api";
import { LEGAL_VERSION } from "@/lib/legal";
import { clearSessionCache, sessionCache } from "@/lib/sessionCache";
import { tNow } from "@/lib/i18n";

const ACTIVE_SHOP_KEY = "activeShopId";

function readStoredShopId(): number | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_SHOP_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function pickActiveShopId(shops: Shop[] | null): number | null {
  const connected = (shops ?? []).filter((s) => s.connected);
  if (connected.length === 0) return null;
  const stored = readStoredShopId();
  return stored !== null && connected.some((s) => s.id === stored) ? stored : connected[0].id;
}

/** Shared auth/shop bootstrap for every protected page: redirects to /login
 * on 401, then loads the user's shops and picks the active one — the last
 * one explicitly chosen via setActiveShopId (persisted per-browser), or the
 * first connected shop otherwise.
 *
 * Sayfa geçişlerinde önceki sayfanın kullanıcı/mağaza bilgisi (sessionCache) hemen kullanılır, arka planda tazelenir;
 * /me ve /shops paralel istenir. Eskiden her sayfa ikisini art arda bekliyor, sayfa verisi ancak sonra isteniyordu. */
export function useAuthAndShop() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(() => sessionCache.user);
  const [shops, setShops] = useState<Shop[] | null>(() => sessionCache.shops);
  // Kullanıcının bu sekmede seçtiği mağaza; yoksa (ya da artık bağlı değilse) kayıtlı/ilk bağlı mağaza kullanılır.
  const [chosenShopId, setChosenShopId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadShops = useCallback(() => {
    api.shops
      .list()
      .then((s) => {
        // Arka plan tazelemesi aynı listeyi getirdiyse eski nesneyi koru: activeShop'a bağlı efektler boşuna yeniden çalışmasın.
        if (sessionCache.shops && JSON.stringify(sessionCache.shops) === JSON.stringify(s)) return;
        sessionCache.shops = s;
        setShops(s);
      })
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setError(e instanceof Error ? e.message : tNow("Bilinmeyen hata", "Unknown error"));
      });
  }, []);

  const loadUser = useCallback(() => {
    api.auth
      .me()
      .then(async (u) => {
        if (u.needs_consent) {
          // Kayıt formunda onay kutusu işaretlendiyse ilk girişte sürümle birlikte kaydet; yoksa onay ekranına yönlendir.
          let pending: string | null = null;
          try {
            pending = window.localStorage.getItem("pendingConsent");
          } catch {}
          if (pending === LEGAL_VERSION) {
            try {
              u = await api.auth.consent(LEGAL_VERSION);
              window.localStorage.removeItem("pendingConsent");
            } catch {}
          }
          if (u.needs_consent) {
            router.replace("/accept-terms");
            return;
          }
        }
        // Askıdaki/engelli hesap: diğer uç noktalar 403 döner; bilgi ekranına gidilir.
        if (u.status && u.status !== "active") {
          router.replace("/account-status");
          return;
        }
        if (sessionCache.user && JSON.stringify(sessionCache.user) === JSON.stringify(u)) return;
        sessionCache.user = u;
        setUser(u);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          clearSessionCache();
          router.push("/login");
        } else {
          setError(e instanceof Error ? e.message : tNow("Bilinmeyen hata", "Unknown error"));
        }
      });
  }, [router]);

  useEffect(() => {
    loadUser();
    loadShops();
  }, [loadUser, loadShops]);

  const setActiveShopId = useCallback((id: number) => {
    setChosenShopId(id);
    try {
      window.localStorage.setItem(ACTIVE_SHOP_KEY, String(id));
    } catch {
      // localStorage unavailable — selection just won't persist across reloads.
    }
  }, []);

  const chosenStillConnected = shops?.some((s) => s.id === chosenShopId && s.connected) ?? false;
  const activeShopId = chosenStillConnected ? chosenShopId : pickActiveShopId(shops);
  const activeShop = shops?.find((s) => s.id === activeShopId) ?? null;

  return { user, shops, activeShop, setActiveShopId, error, refreshUser: loadUser };
}

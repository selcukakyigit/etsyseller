"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, Listing, Shop, User } from "@/lib/api";
import ListingRow from "@/components/ListingRow";

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
    if (!user) return;
    api.shops
      .list()
      .then(setShops)
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [user]);

  const activeShop = shops?.find((s) => s.connected) ?? null;

  const loadListings = useCallback(() => {
    if (!activeShop) return;
    api.listings
      .list(activeShop.id)
      .then(setListings)
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [activeShop]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  async function handleLogout() {
    await api.auth.logout();
    router.push("/login");
  }

  return (
    <main className="flex-1 bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Etsy SEO Otomasyon</h1>
            <p className="text-sm text-neutral-400">Listing&apos;lerini çek, AI ile SEO önerisi üret, tek tıkla yayınla</p>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              {activeShop && (
                <span className="text-xs font-medium text-green-600 px-2.5 py-1 rounded-full bg-green-50">
                  {activeShop.shop_name} bağlı
                </span>
              )}
              <span className="text-sm text-neutral-400">{user.email}</span>
              <button
                onClick={handleLogout}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-100 transition"
              >
                Çıkış yap
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {!user && !error && <p className="text-sm text-neutral-400">Yükleniyor…</p>}

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {user && shops === null && !error && <p className="text-sm text-neutral-400">Mağazalar yükleniyor…</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
            <p className="text-neutral-600 mb-4">Devam etmek için Etsy mağazanı bağlaman gerekiyor.</p>
            <a
              href={api.shops.connectUrl()}
              className="inline-block text-sm font-medium px-4 py-2 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition"
            >
              Etsy&apos;ye Bağlan
            </a>
          </div>
        )}

        {activeShop && listings === null && !error && (
          <p className="text-sm text-neutral-400">Listing&apos;ler yükleniyor…</p>
        )}

        {activeShop && listings && (
          <div className="space-y-3">
            {listings.length === 0 && <p className="text-sm text-neutral-400">Aktif listing bulunamadı.</p>}
            {listings.map((listing) => (
              <ListingRow key={listing.listing_id} shopId={activeShop.id} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

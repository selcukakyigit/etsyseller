"use client";

import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";

export default function ShopSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();

  return (
    <SettingsSubpage
      user={user}
      shops={shops}
      activeShop={activeShop}
      onSwitchShop={setActiveShopId}
      title="Mağaza Bağlantısı"
    >
      {bootError && <p className="text-sm text-red-600">{bootError}</p>}

      {user && shops === null && !bootError && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Yükleniyor…</p>
      )}

      {user && shops !== null && shops.length === 0 && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center space-y-4">
          <p className="text-neutral-600 dark:text-neutral-300">Henüz bağlı bir Etsy mağazan yok.</p>
          <a
            href={api.shops.connectUrl()}
            className="inline-block text-sm font-medium px-4 py-2 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition"
          >
            Etsy&apos;ye Bağlan
          </a>
        </section>
      )}

      {user && shops !== null && shops.length > 0 && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          {shops.map((shop) => (
            <div
              key={shop.id}
              className="flex items-center justify-between gap-4 py-3 border-b last:border-b-0 border-neutral-100 dark:border-neutral-800"
            >
              <div>
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {shop.shop_name}
                  {activeShop?.id === shop.id && (
                    <span className="ml-2 text-[10px] font-medium text-[#F1641E] uppercase tracking-wide">Aktif</span>
                  )}
                </p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500">Etsy Shop ID: {shop.etsy_shop_id}</p>
              </div>
              <div className="flex items-center gap-2">
                {shop.connected ? (
                  <>
                    <span className="text-xs font-medium text-green-600 dark:text-green-400 px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-950">
                      Bağlı
                    </span>
                    {activeShop?.id !== shop.id && (
                      <button
                        onClick={() => setActiveShopId(shop.id)}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                      >
                        Aktif Yap
                      </button>
                    )}
                  </>
                ) : (
                  <a
                    href={api.shops.connectUrl()}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition"
                  >
                    Yeniden Bağlan
                  </a>
                )}
              </div>
            </div>
          ))}

          <a
            href={api.shops.connectUrl()}
            className="inline-block text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition"
          >
            + Başka bir mağaza bağla
          </a>
        </section>
      )}
    </SettingsSubpage>
  );
}

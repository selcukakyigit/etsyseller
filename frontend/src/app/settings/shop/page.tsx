"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";

function CurrencyPicker({ shopId, value }: { shopId: number; value: string | null }) {
  const [current, setCurrent] = useState(value);
  const [saving, setSaving] = useState(false);
  // Yalnızca Etsy ödeme hesabından gerçek kur verisi olan (dolayısıyla doğru çevrilebilecek) para birimleri
  // listelenir — başka bir kod seçilirse kur verisi olmadığından çevrilmez, sadece yanlış etiketlenirdi.
  const [options, setOptions] = useState<string[] | null>(null);

  useEffect(() => {
    api.finance
      .availableCurrencies(shopId)
      .then((r) => setOptions(r.currencies))
      .catch(() => setOptions([]));
  }, [shopId]);

  async function onChange(next: string) {
    const code = next === "auto" ? null : next;
    setSaving(true);
    try {
      await api.shops.setCurrency(shopId, code);
      setCurrent(code);
    } catch {
      // sessizce geç — seçici eski değerinde kalır, kullanıcı tekrar deneyebilir
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
      Para birimi
      <select
        value={current ?? "auto"}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving || !options || options.length === 0}
        title={options && options.length === 0 ? "Henüz kur verisi yok (siparişler senkronize olunca dolar)" : undefined}
        className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <option value="auto">Otomatik</option>
        {(options ?? []).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

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
        <div className="min-h-[20px]">
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Yükleniyor…</p>
        </div>
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
              className="flex flex-wrap items-center justify-between gap-3 py-3 border-b last:border-b-0 border-neutral-100 dark:border-neutral-800"
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
              <div className="flex flex-wrap items-center gap-2">
                {shop.connected && <CurrencyPicker shopId={shop.id} value={shop.currency} />}
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
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Para birimi &quot;Otomatik&quot;ken finans raporu siparişlerinde en çok geçen para birimini kullanır; elle
            seçersen (ör. mağazan çok para biriminde satış aldıysa ve yanlış otomatik seçilmişse) o sabitlenir.
          </p>

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

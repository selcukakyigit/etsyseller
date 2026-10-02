"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";
import DangerConfirmModal from "@/components/settings/DangerConfirmModal";
import { useT } from "@/lib/i18n-client";

function CurrencyPicker({ shopId, value }: { shopId: number; value: string | null }) {
  const { t } = useT();
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
      {t("Para birimi", "Currency")}
      <select
        value={current ?? "auto"}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving || !options || options.length === 0}
        title={options && options.length === 0 ? t("Henüz kur verisi yok (siparişler senkronize olunca dolar)", "No exchange rate data yet (fills in after orders sync)") : undefined}
        className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <option value="auto">{t("Otomatik", "Automatic")}</option>
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
  const { t } = useT();
  const [disconnecting, setDisconnecting] = useState<{ id: number; name: string } | null>(null);

  return (
    <SettingsSubpage
      user={user}
      shops={shops}
      activeShop={activeShop}
      onSwitchShop={setActiveShopId}
      title={t("Mağaza Bağlantısı", "Shop connection")}
    >
      {bootError && <p className="text-sm text-red-600">{bootError}</p>}

      {user && shops === null && !bootError && (
        <div className="min-h-[20px]">
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Yükleniyor…", "Loading…")}</p>
        </div>
      )}

      {user && shops !== null && shops.length === 0 && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center space-y-4">
          <p className="text-neutral-600 dark:text-neutral-300">{t("Henüz bağlı bir Etsy mağazan yok.", "You have not connected an Etsy shop yet.")}</p>
          <a
            href={api.shops.connectUrl()}
            className="inline-block text-sm font-medium px-4 py-2 rounded-lg bg-[#D97757] text-white hover:bg-[#C6613F] transition"
          >
            {t("Etsy'ye Bağlan", "Connect Etsy")}
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
                    <span className="ml-2 text-[10px] font-medium text-[#D97757] uppercase tracking-wide">{t("Aktif", "Active")}</span>
                  )}
                </p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500">Etsy Shop ID: {shop.etsy_shop_id}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {shop.connected && <CurrencyPicker shopId={shop.id} value={shop.currency} />}
                {shop.connected ? (
                  <>
                    <span className="text-xs font-medium text-green-600 dark:text-green-400 px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-950">
                      {t("Bağlı", "Connected")}
                    </span>
                    <button
                      onClick={() => setDisconnecting({ id: shop.id, name: shop.shop_name })}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                    >
                      {t("Bağlantıyı kes", "Disconnect")}
                    </button>
                    {activeShop?.id !== shop.id && (
                      <button
                        onClick={() => setActiveShopId(shop.id)}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                      >
                        {t("Aktif Yap", "Make active")}
                      </button>
                    )}
                  </>
                ) : (
                  <a
                    href={api.shops.connectUrl()}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#D97757] text-white hover:bg-[#C6613F] transition"
                  >
                    {t("Yeniden Bağlan", "Reconnect")}
                  </a>
                )}
              </div>
            </div>
          ))}
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            {t(
              "Para birimi \"Otomatik\"ken finans raporu siparişlerinde en çok geçen para birimini kullanır; elle seçersen (ör. mağazan çok para biriminde satış aldıysa ve yanlış otomatik seçilmişse) o sabitlenir.",
              "With currency set to \"Automatic\", the finance report uses the currency that appears most in your orders. If you pick one (for example when your shop sells in several currencies and the automatic choice is wrong), it stays fixed.",
            )}
          </p>

          <a
            href={api.shops.connectUrl()}
            className="inline-block text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition"
          >
            {t("+ Başka bir mağaza bağla", "+ Connect another shop")}
          </a>
        </section>
      )}
      {disconnecting && (
        <DangerConfirmModal
          title={t(`${disconnecting.name} bağlantısını kes`, `Disconnect ${disconnecting.name}`)}
          intro={t("Etsy bağlantısı kesilir ve Etsy'den gelen veriler silinir:", "The Etsy connection is removed and data from Etsy is deleted:")}
          effects={[
            t("Etsy erişim yetkisi bu uygulamadan kaldırılır; senkronizasyon durur", "Etsy access is removed from this app; syncing stops"),
            t(
              "Etsy'den alınan ilan, sipariş, yorum, finans ve istatistik önbelleği ile görsel kopyaları silinir",
              "Cached listings, orders, reviews, finance and stats from Etsy, and image copies, are deleted",
            ),
            t(
              "Kendi girdiğin maliyetler, taslaklar ve sürüm geçmişin kalır; yeniden bağlanınca devam edersin",
              "Costs you entered, drafts and version history stay; you can continue when you reconnect",
            ),
            t(
              "Etsy hesabındaki mağazana dokunulmaz. Uygulama erişimini Etsy'de Hesap Ayarları > Apps and services bölümünden de kaldırabilirsin",
              "Your shop on Etsy is not touched. You can also remove app access on Etsy under Account settings > Apps and services",
            ),
          ]}
          actionLabel={t("Bağlantıyı kes", "Disconnect")}
          onClose={() => setDisconnecting(null)}
          onConfirm={async (email) => {
            await api.shops.disconnect(disconnecting.id, email);
            window.location.href = "/settings/shop";
          }}
        />
      )}
    </SettingsSubpage>
  );
}

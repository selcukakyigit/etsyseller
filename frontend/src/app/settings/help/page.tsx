"use client";

import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";

export default function HelpSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();

  return (
    <SettingsSubpage
      user={user}
      shops={shops}
      activeShop={activeShop}
      onSwitchShop={setActiveShopId}
      title="Yardım & Destek"
    >
      {bootError && <p className="text-sm text-red-600">{bootError}</p>}

      <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Etsy API Onayı</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Mağaza bağlama, listing çekme/düzenleme ve sipariş senkronizasyonu, Etsy&apos;nin uygulama onayı
            geldikten sonra gerçek verilerle tam olarak çalışacak.
          </p>
        </div>

        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Bağlantı Sorunları</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            API Anahtarları sayfasındaki &quot;Bağlantıyı Test Et&quot; butonları, girdiğin anahtarların Etsy,
            OpenAI ve Claude ile gerçekten çalışıp çalışmadığını gösterir.
          </p>
        </div>

        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">İletişim</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Bir sorunla karşılaşırsan, hesabına kayıtlı e-posta adresinden (
            <span className="font-mono">{user?.email}</span>) bize ulaşabilirsin.
          </p>
        </div>
      </section>
    </SettingsSubpage>
  );
}

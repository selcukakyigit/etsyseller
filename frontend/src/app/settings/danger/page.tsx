"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";
import DangerConfirmModal from "@/components/settings/DangerConfirmModal";
import { useT } from "@/lib/i18n-client";

const card = "rounded-xl border p-5 space-y-3 bg-white dark:bg-neutral-900";

/** Tarayıcıda kalan kullanıcı verisini (seçili mağaza, önbelleğe alınmış finans raporları, sipariş kartı ayarları…) siler.
 * Yalnızca tema tercihi korunur. Sıfırlama/silme sonrası eski verinin ekrana sızmaması için. */
function clearBrowserData() {
  try {
    const theme = window.localStorage.getItem("theme");
    window.localStorage.clear();
    if (theme) window.localStorage.setItem("theme", theme);
    window.sessionStorage.clear();
  } catch {
    // depolama kapalıysa yapılacak bir şey yok
  }
}

export default function DangerSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  const [modal, setModal] = useState<"reset" | "delete" | null>(null);

  return (
    <SettingsSubpage user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} title={t("Hesap ve Veriler", "Account and data")}>
      {bootError && <p className="text-sm text-red-600">{bootError}</p>}

      {user && (
        <>
          <section className={`${card} border-amber-300 dark:border-amber-800`}>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Tüm verileri temizle ve sıfırla", "Clear and reset all data")}</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t(
                "Hesabın (e-posta, şifre, profil) kalır ama uygulamadaki tüm veriler silinir; hesap yeni açılmış gibi olur. Etsy'deki mağazana dokunulmaz.",
                "Your account (email, password, profile) stays, but all data in the app is deleted, as if the account were new. Your shop on Etsy is not touched.",
              )}
            </p>
            <button type="button" onClick={() => setModal("reset")} className="rounded-lg border border-amber-500 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40">
              {t("Verileri sıfırla…", "Reset data…")}
            </button>
          </section>

          <section className={`${card} border-red-300 dark:border-red-900`}>
            <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">{t("Üyeliği sil", "Delete account")}</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t("Üyeliğin ve tüm verilerin kalıcı olarak silinir. Etsy'deki mağazana dokunulmaz.", "Your account and all your data are deleted permanently. Your shop on Etsy is not touched.")}
            </p>
            <button type="button" onClick={() => setModal("delete")} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
              {t("Üyeliği sil…", "Delete account…")}
            </button>
          </section>
        </>
      )}

      {modal === "reset" && (
        <DangerConfirmModal
          title={t("Tüm verileri sıfırla", "Reset all data")}
          intro={t("Bu hesaptaki her şey silinip hesap ilk açıldığı haline döner:", "Everything in this account is deleted and it returns to its initial state:")}
          effects={[
            t("Etsy mağaza bağlantıları ve oturum yetkileri kaldırılır", "Etsy shop connections and access tokens are removed"),
            t("İlanlar, siparişler, finans kayıtları, maliyetler ve kargo faturaları silinir", "Listings, orders, finance records, costs and shipping invoices are deleted"),
            t("Taslaklar, yerel fotoğraflar ve asistan sohbetleri silinir", "Drafts, local photos and assistant chats are deleted"),
            t("Hesabın (e-posta, şifre, profil) ve API anahtarları ayarları kalır", "Your account (email, password, profile) and API key settings stay"),
          ]}
          actionLabel={t("Verileri sıfırla", "Reset data")}
          onClose={() => setModal(null)}
          onConfirm={async (email) => {
            await api.account.resetData(email);
            clearBrowserData();
            window.location.href = "/listings";
          }}
        />
      )}
      {modal === "delete" && (
        <DangerConfirmModal
          title={t("Üyeliği sil", "Delete account")}
          intro={t("Üyeliğin ve tüm verilerin tamamen silinir:", "Your account and all your data are deleted completely:")}
          effects={[
            t("Hesabın, profil fotoğrafın ve oturumların silinir", "Your account, profile photo and sessions are deleted"),
            t(
              "Bağlı mağazalar ve onlara ait tüm veriler silinir (ilanlar, siparişler, finans, faturalar, taslaklar, sohbetler)",
              "Connected shops and all their data are deleted (listings, orders, finance, invoices, drafts, chats)",
            ),
            t("Silindikten sonra giriş yapamazsın; yeniden kullanmak için yeni üyelik açman gerekir", "After deletion you cannot sign in; you need a new account to use the app again"),
          ]}
          actionLabel={t("Üyeliği sil", "Delete account")}
          onClose={() => setModal(null)}
          onConfirm={async (email) => {
            await api.account.deleteAccount(email);
            await api.auth.logout();
            clearBrowserData();
            window.location.href = "/login";
          }}
        />
      )}
    </SettingsSubpage>
  );
}

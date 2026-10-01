"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";
import DangerConfirmModal from "@/components/settings/DangerConfirmModal";

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
  const [modal, setModal] = useState<"reset" | "delete" | null>(null);

  return (
    <SettingsSubpage user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} title="Hesap ve Veriler">
      {bootError && <p className="text-sm text-red-600">{bootError}</p>}

      {user && (
        <>
          <section className={`${card} border-amber-300 dark:border-amber-800`}>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Tüm verileri temizle ve sıfırla</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Hesabın (e-posta, şifre, profil) kalır ama uygulamadaki tüm veriler silinir; hesap yeni açılmış gibi olur. Etsy&apos;deki mağazana dokunulmaz.
            </p>
            <button type="button" onClick={() => setModal("reset")} className="rounded-lg border border-amber-500 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40">
              Verileri sıfırla…
            </button>
          </section>

          <section className={`${card} border-red-300 dark:border-red-900`}>
            <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">Üyeliği sil</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Üyeliğin ve tüm verilerin kalıcı olarak silinir. Etsy&apos;deki mağazana dokunulmaz.</p>
            <button type="button" onClick={() => setModal("delete")} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
              Üyeliği sil…
            </button>
          </section>
        </>
      )}

      {modal === "reset" && (
        <DangerConfirmModal
          title="Tüm verileri sıfırla"
          intro="Bu hesaptaki her şey silinip hesap ilk açıldığı haline döner:"
          effects={[
            "Etsy mağaza bağlantıları ve oturum yetkileri kaldırılır",
            "İlanlar, siparişler, finans kayıtları, maliyetler ve kargo faturaları silinir",
            "Taslaklar, yerel fotoğraflar ve asistan sohbetleri silinir",
            "Hesabın (e-posta, şifre, profil) ve API anahtarları ayarları kalır",
          ]}
          actionLabel="Verileri sıfırla"
          onClose={() => setModal(null)}
          onConfirm={async (email) => {
            await api.account.resetData(email);
            clearBrowserData();
            window.location.href = "/";
          }}
        />
      )}
      {modal === "delete" && (
        <DangerConfirmModal
          title="Üyeliği sil"
          intro="Üyeliğin ve tüm verilerin tamamen silinir:"
          effects={[
            "Hesabın, profil fotoğrafın ve oturumların silinir",
            "Bağlı mağazalar ve onlara ait tüm veriler silinir (ilanlar, siparişler, finans, faturalar, taslaklar, sohbetler)",
            "Silindikten sonra giriş yapamazsın; yeniden kullanmak için yeni üyelik açman gerekir",
          ]}
          actionLabel="Üyeliği sil"
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

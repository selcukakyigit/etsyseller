"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";
import { useT } from "@/lib/i18n-client";
import { BlockSpinner } from "@/components/ui/Spinner";

export default function NotificationSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  const [orderEmail, setOrderEmail] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api.account
      .notificationSettings()
      .then((r) => setOrderEmail(r.order_email))
      .catch((e) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const r = await api.account.setNotificationSettings(next);
      setOrderEmail(r.order_email);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Kaydedilemedi", "Could not save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSubpage user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} title={t("Bildirimler", "Notifications")}>
      {(bootError || error) && <p className="text-sm text-red-600 dark:text-red-400">{bootError ?? error}</p>}
      {user && orderEmail === null && !error && <BlockSpinner />}

      {user && orderEmail !== null && (
        <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Yeni siparişte e-posta", "Email on new orders")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {t(
                  "Bir sipariş ödendiğinde alıcı, ürün ve tutarla kısa bir e-posta gönderilir. Etsy de satıcıya satış e-postası gönderdiği için varsayılan olarak kapalıdır. E-postalar şu an seçili dilde gelir.",
                  "When an order is paid you get a short email with the buyer, item and total. Etsy also emails sellers about sales, so this is off by default. Emails arrive in the language selected now.",
                )}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={orderEmail}
              disabled={saving}
              onClick={() => void toggle(!orderEmail)}
              className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${orderEmail ? "bg-[#D97757]" : "bg-neutral-300 dark:bg-neutral-700"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${orderEmail ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            {t(
              "Uygulama içi bildirimler (sağ üstteki zil) her zaman açıktır: yeni, iptal edilen, kargoya verilen ve teslim edilen siparişler orada görünür.",
              "In-app notifications (the bell, top right) are always on: new, canceled, shipped and delivered orders show up there.",
            )}
          </p>
        </section>
      )}
    </SettingsSubpage>
  );
}

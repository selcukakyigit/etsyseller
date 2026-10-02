"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";
import { useT } from "@/lib/i18n-client";

export default function AiSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api.account
      .ai()
      .then((r) => setEnabled(r.enabled))
      .catch((e) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const r = await api.account.setAi(next);
      setEnabled(r.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Kaydedilemedi", "Could not save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSubpage user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} title={t("Yapay Zekâ", "AI")}>
      {(bootError || error) && <p className="text-sm text-red-600">{bootError ?? error}</p>}

      {user && enabled !== null && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Yapay zekâ özellikleri", "AI features")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {t(
                  "Başlık, etiket ve açıklama önerileri, görsel üretimi ve düzenleme, alt metin, fatura okuma ve sohbet asistanı. Kapatırsan içeriğin hiçbir yapay zekâ sağlayıcısına gönderilmez ve bu özellikler çalışmaz. Mağaza verilerin ve diğer özellikler etkilenmez.",
                  "Title, tag and description suggestions, image generation and editing, alt text, invoice reading and the chat assistant. If you turn this off, your content is not sent to any AI provider and these features stop working. Your shop data and other features are not affected.",
                )}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={saving}
              onClick={() => void toggle(!enabled)}
              className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${enabled ? "bg-[#D97757]" : "bg-neutral-300 dark:bg-neutral-700"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </div>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            {t("Şu an", "Currently")}: <b className="text-neutral-600 dark:text-neutral-300">{enabled ? t("Açık", "On") : t("Kapalı", "Off")}</b>.{" "}
            {t("Yapay zekâ çıktıları sen onaylamadan Etsy'ye yazılmaz.", "AI output is never written to Etsy without your approval.")}{" "}
            <Link href="/ai-data" target="_blank" className="underline">
              {t("Hangi veri nereye gider?", "Which data goes where?")}
            </Link>
          </p>
        </section>
      )}
    </SettingsSubpage>
  );
}

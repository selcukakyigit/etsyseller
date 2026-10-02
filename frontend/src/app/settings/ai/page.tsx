"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";

export default function AiSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api.account
      .ai()
      .then((r) => setEnabled(r.enabled))
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [user]);

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const r = await api.account.setAi(next);
      setEnabled(r.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSubpage user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} title="Yapay Zekâ">
      {(bootError || error) && <p className="text-sm text-red-600">{bootError ?? error}</p>}

      {user && enabled !== null && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Yapay zekâ özellikleri</h2>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                Başlık, etiket ve açıklama önerileri, görsel üretimi ve düzenleme, alt metin, fatura okuma ve sohbet asistanı.
                Kapatırsan içeriğin hiçbir yapay zekâ sağlayıcısına gönderilmez ve bu özellikler çalışmaz. Mağaza verilerin ve
                diğer özellikler etkilenmez.
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
            Şu an: <b className="text-neutral-600 dark:text-neutral-300">{enabled ? "Açık" : "Kapalı"}</b>. Yapay zekâ çıktıları sen
            onaylamadan Etsy&apos;ye yazılmaz.{" "}
            <Link href="/ai-data" target="_blank" className="underline">
              Hangi veri nereye gider?
            </Link>
          </p>
        </section>
      )}
    </SettingsSubpage>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n-client";

// Ortalama üretim süreleri (ms). Sağlayıcı gerçek ilerleme vermediği için yüzde, süreye dayalı bir tahmindir: zamanla %90'a
// kadar dolar ve iş bitene kadar orada bekler (listing düzenleyicideki ilerleme çubuğuyla aynı yaklaşım).
const AVERAGE_MS = { image: 25_000, video: 120_000 } as const;

/** Resim/video üretilirken sohbette görünen animasyonlu yer tutucu: süzülen noktalı ızgara, etiket ve tahmini yüzde. */
export default function GeneratingTile({ kind, startedAt }: { kind: "image" | "video"; startedAt: number }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  const pct = Math.round(90 * (1 - Math.exp(-elapsed / AVERAGE_MS[kind])));
  const label = kind === "video" ? t("Video oluşturuluyor", "Generating video") : t("Görsel oluşturuluyor", "Generating image");

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-sm">
        <div className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">{label}</div>
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="ulagg-dots absolute inset-0 text-[#D97757]" aria-hidden />
          <span
            className="absolute bottom-3 right-3 rounded-full bg-neutral-900/80 px-3 py-1 text-xs font-semibold text-white dark:bg-neutral-100/90 dark:text-neutral-900"
            title={t("Tahmini ilerleme", "Estimated progress")}
          >
            %{pct}
          </span>
        </div>
      </div>
    </div>
  );
}

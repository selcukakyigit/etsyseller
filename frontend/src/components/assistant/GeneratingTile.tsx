"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n-client";

/** Resim/video üretilirken sohbette görünen animasyonlu yer tutucu. Sağlayıcı gerçek ilerleme vermediği için yüzde GÖSTERİLMEZ
 * (uydurma sayaç yanıltır); videoda gerçek geçen süre (saniye) yazar. */
export default function GeneratingTile({ kind, startedAt }: { kind: "image" | "video"; startedAt: number }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (kind !== "video") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [kind]);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  const label = kind === "video" ? t("Video oluşturuluyor", "Generating video") : t("Görsel oluşturuluyor", "Generating image");

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-sm">
        <div className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">{label}</div>
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="ulagg-dots absolute inset-0 text-[#D97757]" aria-hidden />
          {kind === "video" && (
            <span className="absolute bottom-3 right-3 rounded-full bg-neutral-900/80 px-3 py-1 text-xs font-semibold text-white dark:bg-neutral-100/90 dark:text-neutral-900">
              {seconds} {t("sn", "s")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

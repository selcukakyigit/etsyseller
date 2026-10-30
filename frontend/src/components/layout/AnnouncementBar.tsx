"use client";

import { useState } from "react";
import { siteApi } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";

const DISMISS_KEY = "ulagg_announcement_dismissed";

const TONES = {
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
} as const;

/** Duyuru bandının görünümü (yönetici önizlemesi de bunu kullanır). `onClose` verilirse kapatma düğmesi çıkar. */
export default function AnnouncementView({ tone, text, onClose }: { tone: keyof typeof TONES; text: string; onClose?: () => void }) {
  const { t } = useT();
  return (
    <div role="status" className={`flex items-start justify-between gap-3 border-b px-4 py-2 text-xs leading-relaxed ${TONES[tone]}`}>
      <p className="min-w-0 whitespace-pre-wrap break-words">{text}</p>
      {onClose && (
        <button type="button" onClick={onClose} aria-label={t("Duyuruyu kapat", "Dismiss announcement")} className="-my-1 flex-shrink-0 rounded p-1 hover:bg-black/5 dark:hover:bg-white/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

function dismissedId(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** Uygulamanın üstündeki duyuru bandı. Kullanıcı kapatınca aynı metin bir daha çıkmaz (metin değişirse yeniden çıkar). */
export function SiteAnnouncementBar() {
  const { locale } = useT();
  const { data } = useApiData("site:announcement", siteApi.announcement);
  const [closed, setClosed] = useState<string | null>(() => dismissedId());
  if (!data || closed === data.id) return null;
  return (
    <AnnouncementView
      tone={data.tone}
      text={locale === "tr" ? data.text_tr : data.text_en}
      onClose={() => {
        setClosed(data.id);
        try {
          localStorage.setItem(DISMISS_KEY, data.id);
        } catch {
          // Depolama kapalıysa (gizli pencere) yalnızca bu oturumda kapalı kalır.
        }
      }}
    />
  );
}

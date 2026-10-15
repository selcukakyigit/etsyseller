"use client";

import { useEffect, useState } from "react";
import { ABOVE_BOTTOM_NAV } from "@/components/layout/constants";
import { COOKIE_NOTICE_KEY } from "@/components/legal/CookieNotice";
import { useT } from "@/lib/i18n-client";

const KEY = "ulagg_install_dismissed";
const SNOOZE_MS = 30 * 24 * 3600 * 1000;

// Chrome/Edge/Android uygulamayı yüklemek için olay verir; iOS Safari vermez (yalnızca Paylaş menüsü), bu yüzden orada
// kısa bir yönerge gösterilir. Sayfanın akışından bağımsız, altta yüzen bir kart (çerez bildirimi gibi); çerez bildirimi
// kapatılana kadar görünmez, zaten yüklü (standalone) açılışta ve kapatıldıktan sonraki 30 gün görünmez.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function hidden(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY));
    return (!!at && Date.now() - at < SNOOZE_MS) || !localStorage.getItem(COOKIE_NOTICE_KEY);
  } catch {
    return true;
  }
}

export default function InstallBanner() {
  const { t } = useT();
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone || hidden()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!event && !ios) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    setEvent(null);
    setIos(false);
  }

  async function install() {
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => undefined);
    setEvent(null);
  }

  return (
    <div className={`pointer-events-none fixed inset-x-3 z-[55] sm:inset-x-4 ${ABOVE_BOTTOM_NAV}`}>
      <div className="pointer-events-auto mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-700 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
        <p className="flex-1 leading-relaxed">
          {event
            ? t("Ulagg'ı ana ekranına ekle: uygulama gibi tek dokunuşla aç.", "Add Ulagg to your home screen and open it like an app.")
            : t("Ulagg'ı ana ekranına eklemek için Safari'de Paylaş düğmesine, sonra \"Ana Ekrana Ekle\"ye dokun.", "To add Ulagg to your home screen, tap Share in Safari, then \"Add to Home Screen\".")}
        </p>
        {event && (
          <button onClick={install} className="shrink-0 rounded-lg bg-[#D97757] px-3 py-1.5 font-medium text-white hover:bg-[#C6613F]">
            {t("Yükle", "Install")}
          </button>
        )}
        <button onClick={dismiss} className="shrink-0 rounded-lg px-2 py-1.5 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
          {t("Kapat", "Close")}
        </button>
      </div>
    </div>
  );
}

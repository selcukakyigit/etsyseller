"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n-client";

const KEY = "ulagg_cookie_notice";

// Şu an yalnızca zorunlu/işlevsel çerez kullanılıyor, bu yüzden bilgilendirme yeterli. Analitik/reklam çerezi
// eklendiğinde bu bileşen aktif "Kabul et / Reddet" seçimine ve kategori ayarlarına çevrilmeli.
export default function CookieNotice() {
  const [show, setShow] = useState(false);
  const lang = useLang();

  useEffect(() => {
    try {
      setShow(!localStorage.getItem(KEY));
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    setShow(false);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-lg sm:flex-row sm:items-center">
        <p className="flex-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
          {lang === "tr"
            ? "Yalnızca giriş ve tema gibi zorunlu/işlevsel çerezleri kullanıyoruz; reklam veya analitik çerezi yok."
            : "We only use essential and functional cookies, such as sign-in and theme. No advertising or analytics cookies."}{" "}
          <Link href="/cookies" className="underline">
            {lang === "tr" ? "Çerez Politikası" : "Cookie Policy"}
          </Link>
        </p>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
        >
          {lang === "tr" ? "Anladım" : "Got it"}
        </button>
      </div>
    </div>
  );
}

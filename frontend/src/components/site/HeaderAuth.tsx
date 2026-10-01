"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Lang } from "@/lib/i18n";

const T = {
  en: { dashboard: "Open dashboard", signin: "Sign in", start: "Get started" },
  tr: { dashboard: "Panele git", signin: "Giriş yap", start: "Başla" },
};

/** Oturum açıksa "Panele git", değilse "Giriş yap / Başla". Oturum istemcide (Supabase) tutulduğu için burada kontrol edilir. */
export default function HeaderAuth({ lang }: { lang: Lang }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const t = T[lang];

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  if (signedIn) {
    return (
      <Link href="/dashboard" className="rounded-full bg-[#1F1B16] px-4 py-2 text-sm font-medium text-white hover:bg-black dark:bg-[#F3EFE9] dark:text-[#1F1B16] dark:hover:bg-white">
        {t.dashboard}
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <Link href="/login" className="hidden text-sm text-neutral-600 sm:inline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white">
        {t.signin}
      </Link>
      <Link
        href="/login?mode=register"
        className="rounded-full bg-[#1F1B16] px-4 py-2 text-sm font-medium text-white hover:bg-black dark:bg-[#F3EFE9] dark:text-[#1F1B16] dark:hover:bg-white"
      >
        {t.start}
      </Link>
    </div>
  );
}

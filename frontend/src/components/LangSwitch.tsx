"use client";

import { useRouter } from "next/navigation";
import { Lang } from "@/lib/i18n";
import { setLang, useLang } from "@/lib/i18n-client";

/** EN | TR seçici. Çerezi yazar, sunucu bileşenlerinin yeniden render edilmesi için sayfayı yeniler. */
export default function LangSwitch({ className = "" }: { className?: string }) {
  const router = useRouter();
  const lang = useLang();

  function choose(next: Lang) {
    if (next === lang) return;
    setLang(next);
    router.refresh();
  }

  const item = (l: Lang, label: string) => (
    <button
      type="button"
      onClick={() => choose(l)}
      aria-pressed={lang === l}
      className={lang === l ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"}
    >
      {label}
    </button>
  );

  return (
    <div className={`flex items-center gap-1.5 text-xs ${className}`} aria-label="Language">
      {item("en", "EN")}
      <span className="text-neutral-300 dark:text-neutral-700">/</span>
      {item("tr", "TR")}
    </div>
  );
}

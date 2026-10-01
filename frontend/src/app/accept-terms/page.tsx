"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import Logo from "@/components/Logo";
import { LEGAL_UPDATED, LEGAL_VERSION, LEGAL_LINKS } from "@/lib/legal";
import { useLang } from "@/lib/i18n-client";
import { AUTH_COPY } from "@/lib/copy-auth";

/** Kayıtta onay kutusu görmemiş kullanıcılar (ör. Google ile ilk giriş) ve metinler güncellenince herkes buradan geçer. */
export default function AcceptTermsPage() {
  const router = useRouter();
  const lang = useLang();
  const t = AUTH_COPY[lang];
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.auth.consent(LEGAL_VERSION);
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaydedilemedi");
      setBusy(false);
    }
  }

  async function decline() {
    await api.auth.logout();
    router.replace("/login");
  }

  return (
    <main className="flex-1 bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-4">
        <Logo height={26} />
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t.acceptTitle}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {t.acceptLead} {LEGAL_UPDATED[lang]}).
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1 text-neutral-700 dark:text-neutral-300">
          {LEGAL_LINKS.filter((l) => l.href !== "/contact").map((l) => (
            <li key={l.href}>
              <Link href={l.href} target="_blank" className="underline">{l.label[lang]}</Link>
            </li>
          ))}
        </ul>
        <label className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          {t.acceptCheck}
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={accept}
            disabled={!agreed || busy}
            className="flex-1 text-sm font-medium px-3 py-2 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {busy ? t.acceptSaving : t.acceptBtn}
          </button>
          <button onClick={decline} disabled={busy} className="text-sm px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300">
            {t.signOut}
          </button>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";
import { useLang } from "@/lib/i18n-client";
import { AUTH_COPY } from "@/lib/copy-auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const t = AUTH_COPY[useLang()];
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // E-postadaki bağlantı oturumu kurar (PASSWORD_RECOVERY); oturum varsa yeni şifre formu açılır.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <main className="flex-1 bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-1"><Logo height={28} /></div>
        <p className="text-sm text-neutral-400 dark:text-neutral-500 mb-6">{t.resetTitle}</p>
        {ready ? (
          <form onSubmit={submit} className="space-y-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordHint}
              autoComplete="new-password"
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
            >
              {loading ? t.wait : t.resetSave}
            </button>
          </form>
        ) : (
          <p className="text-sm text-neutral-500">{t.resetInvalid}</p>
        )}
      </div>
    </main>
  );
}

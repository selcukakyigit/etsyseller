"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { BRAND, ETSY_DISCLAIMER, LEGAL_VERSION } from "@/lib/legal";

type Mode = "login" | "register" | "forgot";

const input =
  "w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]";
const label = "block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1";

function translate(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "E-posta veya şifre hatalı.";
  if (m.includes("email not confirmed")) return "E-posta adresin henüz doğrulanmadı. Gelen kutundaki bağlantıya tıkla.";
  if (m.includes("already registered")) return "Bu e-posta zaten kayıtlı.";
  if (m.includes("password should be")) return "Şifre en az 8 karakter olmalı.";
  if (m.includes("rate limit")) return "Çok fazla deneme yaptın, biraz sonra tekrar dene.";
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Giriş zaten varsa (veya Google dönüşünden sonra oturum kurulduysa) uygulamaya geç.
  useEffect(() => {
    const go = () => {
      router.replace("/");
      router.refresh();
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) go();
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/login` },
        });
        if (error) throw error;
        // Onay kutusu işaretlendi: ilk girişte sürümle birlikte sunucuya kaydedilir (bkz. useAuthAndShop).
        try {
          window.localStorage.setItem("pendingConsent", LEGAL_VERSION);
        } catch {}
        if (!data.session) {
          setInfo("Hesabın oluşturuldu. E-posta adresine bir doğrulama bağlantısı gönderdik; tıkladıktan sonra giriş yapabilirsin.");
          setMode("login");
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setInfo("Bu e-posta kayıtlıysa şifre sıfırlama bağlantısı gönderildi.");
      }
    } catch (err) {
      setError(translate(err instanceof Error ? err.message : "Bilinmeyen hata"));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) setError(translate(error.message));
  }

  const title = mode === "login" ? "Hesabına giriş yap" : mode === "register" ? "Yeni hesap oluştur" : "Şifreni sıfırla";

  return (
    <main className="flex-1 bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">{BRAND}</h1>
        <p className="text-sm text-neutral-400 dark:text-neutral-500 mb-6">{title}</p>

        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6"
        >
          {mode !== "forgot" && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                className="w-full text-sm font-medium px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
              >
                Google ile devam et
              </button>
              <div className="flex items-center gap-3 text-[11px] text-neutral-400">
                <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                veya
                <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
              </div>
            </>
          )}

          <div>
            <label className={label}>E-posta</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
              placeholder="sen@ornek.com"
            />
          </div>

          {mode !== "forgot" && (
            <div>
              <label className={label}>Şifre</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
                placeholder="en az 8 karakter"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
          )}

          {mode === "register" && (
            <label className="flex items-start gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <input
                type="checkbox"
                required
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <Link href="/terms" target="_blank" className="underline">Kullanım Koşulları</Link>&apos;nı ve{" "}
                <Link href="/privacy" target="_blank" className="underline">Gizlilik Politikası</Link>&apos;nı okudum, kabul
                ediyorum. <Link href="/kvkk" target="_blank" className="underline">KVKK Aydınlatma Metni</Link>&apos;ni
                okudum.
              </span>
            </label>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-green-600">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {loading
              ? "Bekleyin…"
              : mode === "login"
                ? "Giriş yap"
                : mode === "register"
                  ? "Hesap oluştur"
                  : "Bağlantı gönder"}
          </button>
        </form>

        <div className="mt-4 flex flex-col items-start gap-1 text-sm text-neutral-500 dark:text-neutral-400">
          {mode === "login" && (
            <button onClick={() => { setMode("forgot"); setError(null); setInfo(null); }} className="hover:text-neutral-800 dark:hover:text-neutral-200 transition">
              Şifremi unuttum
            </button>
          )}
          <button
            onClick={() => { setMode(mode === "register" ? "login" : mode === "login" ? "register" : "login"); setError(null); setInfo(null); }}
            className="hover:text-neutral-800 dark:hover:text-neutral-200 transition"
          >
            {mode === "login" ? "Hesabın yok mu? Kayıt ol" : "Zaten hesabın var mı? Giriş yap"}
          </button>
        </div>

        <p className="mt-8 text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">{ETSY_DISCLAIMER}</p>
      </div>
    </main>
  );
}

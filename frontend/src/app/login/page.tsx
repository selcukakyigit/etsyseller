"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "login") {
        await api.auth.login(email, password);
      } else {
        await api.auth.register(email, password);
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 bg-neutral-50 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-neutral-900 mb-1">Etsy SEO Otomasyon</h1>
        <p className="text-sm text-neutral-400 mb-6">
          {mode === "login" ? "Hesabına giriş yap" : "Yeni hesap oluştur"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6">
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">E-posta</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
              placeholder="sen@ornek.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">Şifre</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
              placeholder="en az 8 karakter"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {loading ? "Bekleyin…" : mode === "login" ? "Giriş yap" : "Hesap oluştur"}
          </button>
        </form>

        <button
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="mt-4 text-sm text-neutral-500 hover:text-neutral-800 transition"
        >
          {mode === "login" ? "Hesabın yok mu? Kayıt ol" : "Zaten hesabın var mı? Giriş yap"}
        </button>
      </div>
    </main>
  );
}

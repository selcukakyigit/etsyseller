"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { BRAND, LEGAL_UPDATED, LEGAL_VERSION } from "@/lib/legal";

/** Kayıtta onay kutusu görmemiş kullanıcılar (ör. Google ile ilk giriş) ve metinler güncellenince herkes buradan geçer. */
export default function AcceptTermsPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.auth.consent(LEGAL_VERSION);
      router.replace("/");
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
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{BRAND} — Koşulları onayla</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Devam etmek için aşağıdaki metinleri (son güncelleme {LEGAL_UPDATED}) okuyup kabul etmen gerekiyor.
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1 text-neutral-700 dark:text-neutral-300">
          <li><Link href="/terms" target="_blank" className="underline">Kullanım Koşulları</Link></li>
          <li><Link href="/privacy" target="_blank" className="underline">Gizlilik Politikası</Link></li>
          <li><Link href="/kvkk" target="_blank" className="underline">KVKK Aydınlatma Metni</Link></li>
          <li><Link href="/ai-data" target="_blank" className="underline">Yapay Zekâ ve Veri İşleme</Link></li>
        </ul>
        <label className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          Yukarıdaki metinleri okudum ve kabul ediyorum.
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={accept}
            disabled={!agreed || busy}
            className="flex-1 text-sm font-medium px-3 py-2 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {busy ? "Kaydediliyor…" : "Kabul et ve devam et"}
          </button>
          <button onClick={decline} disabled={busy} className="text-sm px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300">
            Çıkış
          </button>
        </div>
      </div>
    </main>
  );
}

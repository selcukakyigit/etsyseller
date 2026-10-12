"use client";

import { useState } from "react";
import { Badge, Button, Section, errorText } from "@/components/admin/ui";
import { API_URL, AdminBilling, AdminLemonCheck, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

/** Lemon Squeezy anahtarlarının durumu ve webhook kurulumu. */
export default function LemonSection({ data }: { data: AdminBilling; onChanged: () => void }) {
  const { t } = useT();
  const webhookUrl = `${API_URL}/webhooks/lemonsqueezy`;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<AdminLemonCheck | null>(null);

  async function check() {
    setChecking(true);
    try {
      setResult(await api.admin.lemonCheck());
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setChecking(false);
    }
  }
  const row = (ok: boolean, label: string, fix: string) => (
    <li className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-neutral-800 dark:text-neutral-200">{label}</span>
      {ok ? <Badge tone="good">{t("Hazır", "Ready")}</Badge> : <span className="text-xs text-amber-700 dark:text-amber-300">{fix}</span>}
    </li>
  );
  return (
    <Section title={t("Lemon Squeezy bağlantısı", "Lemon Squeezy connection")}>
      <ul className="space-y-2">
        {row(data.lemon_configured, t("API anahtarı ve mağaza no.", "API key and store ID"), t("Sunucuya LEMONSQUEEZY_API_KEY ve LEMONSQUEEZY_STORE_ID ekleyin", "Add LEMONSQUEEZY_API_KEY and LEMONSQUEEZY_STORE_ID on the server"))}
        {row(data.webhook_configured, t("Webhook sırrı", "Webhook secret"), t("Sunucuya LEMONSQUEEZY_WEBHOOK_SECRET ekleyin", "Add LEMONSQUEEZY_WEBHOOK_SECRET on the server"))}
      </ul>
      <div className="mt-3 space-y-1">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t(
            "Lemon'da Settings > Webhooks: aşağıdaki adres, aynı sır ve şu olaylar: order_created ve order_refunded.",
            "In Lemon, Settings > Webhooks: the URL below, the same secret and these events: order_created and order_refunded.",
          )}
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">{webhookUrl}</code>
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(webhookUrl).then(() => toast.success(t("Kopyalandı", "Copied")));
            }}
          >
            {t("Kopyala", "Copy")}
          </Button>
        </div>
      </div>
      <div className="mt-5 border-t border-neutral-100 pt-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {t("Anahtarı, mağazayı ve her paketin Lemon'daki varyantını doğrular. Hiçbir şeyi değiştirmez.", "Verifies the key, the store and every pack's variant in Lemon. Changes nothing.")}
          </p>
          <Button tone="primary" busy={checking} onClick={() => void check()}>
            {t("Bağlantıyı test et", "Test connection")}
          </Button>
        </div>
        {result && <CheckResult result={result} />}
      </div>
    </Section>
  );
}

const ERRORS: Record<string, [string, string]> = {
  not_configured: ["API anahtarı ya da mağaza no. girilmemiş (sunucu ayarı).", "The API key or store ID is not set (server setting)."],
  bad_key: ["API anahtarı geçersiz ya da süresi dolmuş.", "The API key is invalid or revoked."],
  not_found: ["Mağaza bulunamadı: mağaza no. yanlış olabilir.", "Store not found: the store ID may be wrong."],
  unreachable: ["Lemon'a ulaşılamadı; biraz sonra tekrar dene.", "Could not reach Lemon; try again shortly."],
  api_error: ["Lemon beklenmeyen bir hata döndü.", "Lemon returned an unexpected error."],
};

const PROBLEMS: Record<string, [string, string]> = {
  variant_not_found: ["Bu varyant numarası Lemon'da yok (test ve canlı modun numaraları farklıdır).", "This variant ID does not exist in Lemon (test and live mode IDs differ)."],
  other_store: ["Varyant başka bir mağazaya ait.", "The variant belongs to another store."],
  subscription: ["Varyant abonelik; tek seferlik ödeme olmalı.", "The variant is a subscription; it must be a single payment."],
  not_published: ["Ürün yayında değil (Published yap).", "The product is not published."],
  currency_mismatch: ["Para birimi mağazanınkiyle uyuşmuyor.", "The currency does not match the store's."],
  price_mismatch: ["Fiyat Lemon'daki fiyatla uyuşmuyor (gösterim fiyatını güncelle).", "The price differs from the one in Lemon (update the display price)."],
};

function CheckResult({ result }: { result: AdminLemonCheck }) {
  const { t, locale } = useT();
  const money = (cents: number | null, currency: string | null) => {
    if (cents === null || !currency) return "—";
    try {
      return (cents / 100).toLocaleString(locale, { style: "currency", currency });
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  };
  if (result.error) {
    const e = ERRORS[result.error] ?? ERRORS.api_error;
    return <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{t(e[0], e[1])}</p>;
  }
  return (
    <div className="mt-3 space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
        <Badge tone="good">{t("Bağlandı", "Connected")}</Badge>
        {result.store?.name} · {result.store?.currency}
        {!result.webhook_configured && <Badge tone="warn">{t("Webhook sırrı yok", "No webhook secret")}</Badge>}
      </p>
      {result.products.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Henüz paket eklenmemiş.", "No packs added yet.")}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
          {result.products.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {p.name} <span className="font-mono text-xs font-normal text-neutral-400">{p.variant_id}</span>
                </span>
                {p.problems.length === 0 ? <Badge tone="good">{t("Uyumlu", "OK")}</Badge> : <Badge tone="warn">{t(`${p.problems.length} sorun`, `${p.problems.length} issue(s)`)}</Badge>}
              </div>
              {p.lemon && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {p.lemon.name} · {money(p.lemon.price_cents, result.store?.currency ?? null)} · {p.lemon.product_status}
                  {p.lemon.test_mode ? ` · ${t("test modu", "test mode")}` : ""}
                </p>
              )}
              {p.problems.map((code) => {
                const m = PROBLEMS[code];
                return (
                  <p key={code} className="text-xs text-amber-700 dark:text-amber-300">
                    {m ? t(m[0], m[1]) : code}
                  </p>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

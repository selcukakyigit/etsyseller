"use client";

import { useT } from "@/lib/i18n-client";
import type { ResearchAlert } from "@/lib/researchApi";

/** Genel bakışın üstündeki uyarı şeridi (backend research/alerts.py). Uyarı yoksa hiçbir şey göstermez. */
export default function AlertsStrip({ alerts }: { alerts: ResearchAlert[] }) {
  const { t, locale } = useT();
  const money = (n: number | null) => (n ?? 0).toLocaleString(locale, { style: "currency", currency: "USD" });
  const num = (n: number | null) => (n ?? 0).toLocaleString(locale);

  function text(a: ResearchAlert): string {
    const kind = a.key.startsWith("kind_budget:") ? a.key.split(":")[1] : "";
    const kindName: Record<string, string> = {
      volume: t("Hacim", "Volume"),
      suggest: t("Öneri", "Suggestion"),
      season: t("Mevsimsellik", "Seasonality"),
      trend: t("Trend", "Trend"),
    };
    if (kind) {
      return t(
        `${kindName[kind] ?? kind} bütçesi doldu (${money(a.value)} / ${money(a.limit)}): bu türdeki işler ertelendi, diğer türler sürüyor.`,
        `The ${kindName[kind] ?? kind} budget is used up (${money(a.value)} / ${money(a.limit)}): jobs of this kind are postponed, other kinds continue.`,
      );
    }
    switch (a.key) {
      case "budget_full":
        return t(`Aylık bütçe doldu (${money(a.value)} / ${money(a.limit)}): yeni istek yapılmıyor, eski veri sunuluyor.`, `Monthly budget used up (${money(a.value)} / ${money(a.limit)}): no new requests, old data is served.`);
      case "budget_warn":
        return t(`Aylık bütçenin %${num(a.value)}'i kullanıldı (tavan ${money(a.limit)}).`, `${num(a.value)}% of the monthly budget is used (cap ${money(a.limit)}).`);
      case "breaker":
        return t(`Sağlayıcı art arda hata verdi: yaklaşık ${num(a.value)} dk yeni istek yapılmayacak, işler kuyrukta bekliyor.`, `The provider failed repeatedly: no new requests for about ${num(a.value)} min, jobs wait in the queue.`);
      case "error_rate":
        return t(`Son 24 saatte sağlayıcı çağrılarının %${num(a.value)}'i hatalı.`, `${num(a.value)}% of provider calls failed in the last 24 hours.`);
      case "queue_stuck":
        return t(`Kuyruktaki işler ${num(a.value)} dk'dır bekliyor; yürütücü çalışmıyor olabilir.`, `Queued jobs have waited ${num(a.value)} min; the worker may not be running.`);
      case "dead_jobs":
        return t(`Son 24 saatte ${num(a.value)} iş vazgeçildi (denemeler tükendi).`, `${num(a.value)} job(s) were given up in the last 24 hours (retries exhausted).`);
      case "low_balance":
        return t(`Sağlayıcı bakiyesi düşük: ${money(a.value)} (eşik ${money(a.limit)}).`, `Provider balance is low: ${money(a.value)} (threshold ${money(a.limit)}).`);
      default:
        return a.key;
    }
  }

  if (alerts.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label={t("Uyarılar", "Alerts")}>
      {alerts.map((a) => (
        <li
          key={a.key}
          className={`rounded-lg border px-4 py-3 text-sm ${
            a.level === "bad"
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {text(a)}
        </li>
      ))}
    </ul>
  );
}

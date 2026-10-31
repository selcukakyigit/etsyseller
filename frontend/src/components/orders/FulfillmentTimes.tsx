"use client";

import { useState } from "react";
import type { Fulfillment } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

// Teslim bilgisi yalnızca webhook kurulduktan sonra gelir; daha önce kargolanmış siparişler sonsuza dek "yolda"
// görünmesin diye "yolda" etiketi bu kadar günle sınırlı.
const MAX_IN_TRANSIT_DAYS = 30;

/** Kargo süreleri: "2 günde kargoya verildi · 4 günde teslim edildi (toplam 6 gün)". Kargolanmamışsa hiçbir şey göstermez. */
export default function FulfillmentTimes({ f, className = "" }: { f: Fulfillment; className?: string }) {
  const { t } = useT();
  const [now] = useState(() => Date.now());
  if (!f.shipped_at) return null;

  const days = (n: number) => t(`${n} gün`, n === 1 ? "1 day" : `${n} days`);
  const parts: string[] = [];
  if (f.ship_days !== null) parts.push(t(`${days(f.ship_days)}de kargoya verildi`, `shipped in ${days(f.ship_days)}`));

  let tone = "text-neutral-500 dark:text-neutral-400";
  if (f.delivered_at && f.transit_days !== null) {
    parts.push(t(`${days(f.transit_days)}de teslim edildi`, `delivered in ${days(f.transit_days)}`));
    if (f.total_days !== null) parts.push(t(`toplam ${days(f.total_days)}`, `${days(f.total_days)} total`));
    tone = "text-emerald-700 dark:text-emerald-400";
  } else {
    const inTransit = Math.floor((now - new Date(f.shipped_at).getTime()) / 86_400_000);
    if (inTransit <= MAX_IN_TRANSIT_DAYS) parts.push(t(`${days(inTransit)}dür yolda`, `in transit for ${days(inTransit)}`));
  }
  if (!parts.length) return null;

  return <p className={`text-xs ${tone} ${className}`}>{parts.join(" · ")}</p>;
}

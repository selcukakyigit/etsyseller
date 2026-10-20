"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { onCreditsChanged } from "@/lib/creditEvents";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import { CREDIT_CATEGORIES } from "./UsageBreakdown";

/** Bakiye bu değerin altına inince rakamlar kırmızıya döner (simge hep altın kalır). */
const LOW_BALANCE = 100;

function CoinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5c.6-.8 1.5-1.2 2.5-1.2 1.4 0 2.5.7 2.5 1.8 0 2.4-5 1.2-5 3.7 0 1.1 1.1 1.9 2.5 1.9 1 0 1.9-.4 2.5-1.2" />
    </svg>
  );
}

/** Üst çubuktaki kredi göstergesi: bakiye + tıklayınca bu ayın harcaması (metin / görsel / video / sistem) ve "Kredi al". Kredi sistemi henüz
 * kapalıysa da görünür (menüde bunu söyler). Bakiye, kredi harcayan ya da yükleyen işlemlerden sonra `credits-changed` olayıyla tazelenir. */
export default function CreditBadge() {
  const { t, locale } = useT();
  const { data, reload } = useApiData("billing:summary", api.billing.summary);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => onCreditsChanged(reload), [reload]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!data) return null;
  const total = data.balance;
  const tone = total < LOW_BALANCE ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"; // altın; azalınca kırmızı
  const compact = new Intl.NumberFormat(locale, { notation: total >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(total);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("Kredi bakiyesi", "Credit balance")}
        aria-expanded={open}
        className={`mr-1 flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold tabular-nums transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${tone}`}
      >
        <span className="text-amber-500 dark:text-amber-400">
          <CoinIcon />
        </span>
        {compact}
      </button>
      {open && <CreditMenu total={total} active={data.enabled} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CreditMenu({ total, active, onClose }: { total: number; active: boolean; onClose: () => void }) {
  const { t, locale } = useT();
  const { data } = useApiData("billing:usage:30", () => api.billing.usage(30));
  const fmt = (n: number) => new Intl.NumberFormat(locale).format(n);
  return (
    <div
      style={{ zIndex: 60 }}
      className="fixed inset-x-3 top-[53px] rounded-xl border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-72"
    >
      <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{t("Kredi bakiyesi", "Credit balance")}</p>
      <p className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{fmt(total)}</p>
      {!active && (
        <p className="mt-2 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
          {t("Kredi sistemi henüz aktif değil; harcamalar bakiyenden düşmüyor.", "The credit system is not active yet; usage is not deducted from your balance.")}
        </p>
      )}
      <p className="mt-3 text-xs font-medium text-neutral-400 dark:text-neutral-500">{t("Son 30 gün harcama", "Spent in the last 30 days")}</p>
      <ul className="mt-1.5 space-y-1">
        {CREDIT_CATEGORIES.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {t(c.tr, c.en)}
            </span>
            <span className="tabular-nums text-neutral-900 dark:text-neutral-100">{data ? fmt(data.by_category[c.id]) : "…"}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/settings/billing"
        onClick={onClose}
        className="mt-4 block rounded-lg bg-[#D97757] px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-[#C6613F]"
      >
        {t("Kredi al", "Buy credits")}
      </Link>
      <Link href="/settings/billing" onClick={onClose} className="mt-2 block text-center text-xs text-neutral-500 hover:underline dark:text-neutral-400">
        {t("Kullanım geçmişi", "Usage history")}
      </Link>
    </div>
  );
}

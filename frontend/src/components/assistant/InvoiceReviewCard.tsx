"use client";

import Link from "next/link";
import { useState } from "react";
import { api, InvoiceCandidate } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";

type Row = { receiptId: number | null; checked: boolean; status: "idle" | "saving" | "saved" | "error"; error?: string };

const KIND_EN: Record<string, string> = { nakliye: "shipping", gümrük: "customs", "ek hizmet": "extra service", diğer: "other" };

/** Asistanın okuduğu kargo/gümrük faturası: her gönderi satırı ve eşleştiği sipariş. Hiçbir şey kendiliğinden
 * kaydedilmez; kullanıcı siparişi kontrol edip (gerekirse değiştirip) onaylayınca Kargo faturaları'na yazılır. */
export default function InvoiceReviewCard({ shopId, source, currency, candidates }: { shopId: number; source: string; currency: string; candidates: InvoiceCandidate[] }) {
  const { t, locale } = useT();
  const [rows, setRows] = useState<Row[]>(() =>
    candidates.map((c) => {
      const best = c.matches[0];
      return { receiptId: c.already_saved ? null : (best?.receipt_id ?? null), checked: !c.already_saved && !!best && best.score >= 0.9, status: "idle" };
    }),
  );
  const [busy, setBusy] = useState(false);
  const money = (cur: string, n: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(n);
    } catch {
      return `${n.toFixed(2)} ${cur}`;
    }
  };
  const patch = (i: number, p: Partial<Row>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const ready = rows.map((r, i) => r.checked && r.receiptId !== null && r.status !== "saved" && !candidates[i].already_saved);
  const count = ready.filter(Boolean).length;
  const saved = rows.filter((r) => r.status === "saved").length;

  async function confirmSelected() {
    setBusy(true);
    for (let i = 0; i < rows.length; i++) {
      if (!ready[i]) continue;
      patch(i, { status: "saving", error: undefined });
      try {
        await api.finance.invoices.confirm(shopId, rows[i].receiptId as number, candidates[i]);
        patch(i, { status: "saved", checked: false });
      } catch (e) {
        patch(i, { status: "error", error: e instanceof Error && e.message ? e.message : t("Kaydedilemedi", "Could not save") });
      }
    }
    setBusy(false);
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-amber-300 bg-white dark:border-amber-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="min-w-0 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          {t("Kargo faturası", "Shipping invoice")} · <span className="font-normal text-neutral-500 dark:text-neutral-400">{source}</span>
        </div>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {saved > 0 ? t(`${saved} satır kaydedildi`, `${saved} lines saved`) : t("HENÜZ KAYDEDİLMEDİ · onayını bekliyor", "NOT SAVED YET · waiting for your confirmation")}
        </span>
      </div>

      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {candidates.map((c, i) => {
          const r = rows[i];
          const match = c.matches.find((m) => m.receipt_id === r.receiptId);
          const locked = c.already_saved || r.status === "saved" || r.status === "saving";
          return (
            <li key={i} className="flex gap-3 px-4 py-3 text-xs">
              <input type="checkbox" className="mt-0.5" checked={r.checked} disabled={locked || busy} onChange={(e) => patch(i, { checked: e.target.checked })} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {c.recipient || t("alıcı yok", "no recipient")}
                    {c.recipient_country && <span className="font-normal text-neutral-500"> · {c.recipient_country}</span>}
                  </span>
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {money(c.original_currency, c.original_amount)}
                    {c.original_currency !== currency && <span className="font-normal text-neutral-500"> ≈ {money(currency, c.amount)}</span>}
                  </span>
                </div>
                <div className="text-neutral-500 dark:text-neutral-400">
                  {locale.startsWith("tr") ? c.kind : (KIND_EN[c.kind] ?? c.kind)}
                  {c.tracking_no && ` · ${t("takip", "tracking")} ${c.tracking_no}`}
                  {c.ship_date && ` · ${c.ship_date}`}
                  {c.weight_kg ? ` · ${c.weight_kg} kg` : ""}
                </div>
                {c.check_note && <div className="text-amber-700 dark:text-amber-400">⚠ {c.check_note}</div>}

                {c.already_saved ? (
                  <div className="text-neutral-500 dark:text-neutral-400">✓ {t("Bu satır zaten kayıtlı.", "This line is already saved.")}</div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={match ? String(r.receiptId) : ""}
                      disabled={locked || busy}
                      onChange={(e) => patch(i, { receiptId: e.target.value ? Number(e.target.value) : null, checked: !!e.target.value })}
                      className="max-w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    >
                      <option value="">{c.matches.length ? t("Sipariş seç…", "Choose order…") : t("Eşleşen sipariş yok", "No matching order")}</option>
                      {c.matches.map((m) => (
                        <option key={m.receipt_id} value={m.receipt_id}>
                          #{m.receipt_id} · {m.buyer} · {m.date} · %{Math.round(m.score * 100)}
                          {m.canceled ? ` · ${t("iptal", "canceled")}` : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      inputMode="numeric"
                      disabled={locked || busy}
                      placeholder={t("ya da sipariş no", "or order no.")}
                      value={r.receiptId !== null && !match ? String(r.receiptId) : ""}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "");
                        patch(i, { receiptId: v ? Number(v) : null, checked: !!v });
                      }}
                      className="w-32 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    />
                    {match && <span className="text-neutral-500 dark:text-neutral-400">{match.reason}</span>}
                  </div>
                )}
                {r.status === "saving" && <Spinner size={14} />}
                {r.status === "saved" && <div className="font-medium text-emerald-700 dark:text-emerald-400">✓ {t("Kaydedildi", "Saved")}</div>}
                {r.status === "error" && <div className="text-red-600 dark:text-red-400">{r.error}</div>}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <Link href="/finance?tab=invoices" className="text-xs text-neutral-500 underline hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
          {t("Kargo faturalarına git", "Go to shipping invoices")}
        </Link>
        <button
          type="button"
          disabled={count === 0 || busy}
          onClick={() => void confirmSelected()}
          className="rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C6613F] disabled:opacity-40"
        >
          {busy ? t("Kaydediliyor…", "Saving…") : t(`Seçilenleri onayla (${count})`, `Confirm selected (${count})`)}
        </button>
      </div>
    </div>
  );
}

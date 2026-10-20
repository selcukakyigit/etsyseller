"use client";

import { useState } from "react";
import { InvoiceCandidate } from "@/lib/api";
import { tNow as t } from "@/lib/i18n";

export type Review = { id: number; candidate: InvoiceCandidate; receiptId: number | null };

const input = "rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900";

/** Eşleşme güveni: kesin (yeşil), kontrol et (amber), zayıf (kırmızı, kalın). Sınırlar backend `match_orders` skorlarına göredir. */
export type Band = "strong" | "check" | "weak";
export const STRONG_FROM = 0.9; // yalnızca takip no birebir (1.0); ad eşleşmesi en fazla 0,89 olduğundan hep "kontrol et"
export const CHECK_FROM = 0.6;
export const bandOf = (score: number): Band => (score >= STRONG_FROM ? "strong" : score >= CHECK_FROM ? "check" : "weak");

const BAND_STYLE: Record<Band, string> = {
  strong: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  check: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  weak: "bg-red-100 font-bold text-red-700 dark:bg-red-950 dark:text-red-300",
};
const bandLabel = (b: Band) => ({ strong: t("Kesin", "Sure"), check: t("Kontrol et", "Check"), weak: t("Zayıf eşleşme", "Weak match") })[b];
const reasonText = (reason: string) => (reason === "takip no" ? t("takip no birebir", "tracking number matches") : t("ad ve ülke benzer", "name and country alike"));

/**
 * Onay bekleyen BİR gönderi: aynı gönderinin tüm kalemleri (nakliye, gümrük, KDV…) tek kartta alt alta durur; sipariş eşleşmesi ve
 * onay tek yerden yapılır. Zayıf eşleşmede "Onayla" kilitlidir (yanlış siparişe maliyet yazılmasın); kullanıcı bilerek açabilir.
 */
export default function InvoiceReviewGroup({
  lines,
  money2,
  saving,
  duplicateOf,
  onOrder,
  onVendor,
  onKind,
  onSkipLine,
  onSkipAll,
  onConfirm,
}: {
  lines: Review[];
  money2: Intl.NumberFormat;
  saving: boolean;
  duplicateOf: (r: Review) => { invoice_no: string; invoice_date: string } | null;
  onOrder: (receiptId: number | null) => void;
  onVendor: (vendor: string) => void;
  onKind: (id: number, kind: InvoiceCandidate["kind"]) => void;
  onSkipLine: (id: number) => void;
  onSkipAll: () => void;
  onConfirm: () => void;
}) {
  const [force, setForce] = useState(false); // zayıf eşleşmeyi bilerek kabul et
  const first = lines[0].candidate;
  const receiptId = lines[0].receiptId;
  const match = first.matches.find((m) => m.receipt_id === receiptId);
  const band = match ? bandOf(match.score) : null;
  const weakLocked = band === "weak" && !force;
  const open = lines.filter((l) => !l.candidate.already_saved); // kaydedilecek kalemler
  const dup = lines.map((l) => duplicateOf(l)).find(Boolean) ?? null;
  const total = lines.reduce((sum, l) => sum + l.candidate.amount, 0);
  const border =
    band === "weak" ? "border-red-300 dark:border-red-800" : dup || open.length === 0 || band === "check" ? "border-amber-300 dark:border-amber-800" : "border-neutral-200 dark:border-neutral-800";

  return (
    <div className={`rounded-lg border p-3 text-sm ${border}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="font-semibold">{first.recipient || t("Alıcı yok", "No recipient")}</span>
          {first.recipient_country && <span className="text-neutral-500"> · {first.recipient_country}</span>}
          <div className="text-xs text-neutral-500">
            {first.vendor && `${first.vendor} · `}
            {t("takip", "tracking")} {first.tracking_no || "—"} · {first.ship_date ?? first.invoice_date}
            {first.weight_kg ? ` · ${first.weight_kg} kg` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-semibold">{money2.format(total)}</div>
          {lines.length > 1 && <div className="text-xs text-neutral-500">{t(`${lines.length} kalem`, `${lines.length} lines`)}</div>}
        </div>
      </div>

      <ul className="mt-2 divide-y divide-neutral-100 rounded-md border border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
        {lines.map((l) => {
          const c = l.candidate;
          return (
            <li key={l.id} className={`flex flex-wrap items-center gap-2 px-2 py-1.5 ${c.already_saved ? "opacity-60" : ""}`}>
              <select value={c.kind} disabled={c.already_saved} onChange={(e) => onKind(l.id, e.target.value as InvoiceCandidate["kind"])} className={input}>
                <option value="nakliye">{t("Nakliye", "Freight")}</option>
                <option value="gümrük">{t("Gümrük", "Customs")}</option>
                <option value="ek hizmet">{t("Ek hizmet", "Extra service")}</option>
                <option value="diğer">{t("Diğer", "Other")}</option>
              </select>
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-500" title={c.description}>
                {c.description || c.kind}
              </span>
              {c.already_saved && (
                <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {t("zaten kayıtlı, eklenmez", "already saved, not added")}
                </span>
              )}
              <span className="text-right">
                <span className="font-medium tabular-nums">{money2.format(c.amount)}</span>
                <span className="ml-2 text-[11px] text-neutral-500">
                  {c.original_currency} {c.original_amount.toFixed(2)}
                </span>
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => onSkipLine(l.id)}
                  aria-label={t("Bu kalemi atla", "Skip this line")}
                  title={t("Bu kalemi atla", "Skip this line")}
                  className="rounded-full px-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {open.length === 0 && (
        <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">{t("Bu gönderinin tüm kalemleri zaten kayıtlı — tekrar eklenmez.", "All lines of this shipment are already saved; nothing will be added.")}</div>
      )}
      {lines.some((l) => l.candidate.check_note) && <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">⚠ {lines.find((l) => l.candidate.check_note)?.candidate.check_note}</div>}
      {open.length > 0 && dup && (
        <div className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          ⚠{" "}
          {t(
            `Bu siparişe aynı tutarda bir kalem zaten kayıtlı (${dup.invoice_no} · ${dup.invoice_date}). Aynı faturayı iki kez yüklemiş olabilirsiniz; mükerrerse "Atla" deyin.`,
            `This order already has a line with the same amount (${dup.invoice_no} · ${dup.invoice_date}). You may have uploaded the same invoice twice; if so, choose "Skip".`,
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={first.vendor}
          onChange={(e) => onVendor(e.target.value)}
          maxLength={120}
          aria-label={t("Kargo firması", "Carrier")}
          placeholder={t("Firma (ör. FedEx)", "Carrier (e.g. FedEx)")}
          className={`${input} w-36`}
        />
        {first.matches.length > 0 ? (
          <>
            {band && (
              <span className={`rounded-full px-2.5 py-1 text-xs ${BAND_STYLE[band]}`} title={match ? reasonText(match.reason) : undefined}>
                %{Math.round((match?.score ?? 0) * 100)} · {bandLabel(band)}
              </span>
            )}
            <select value={receiptId ?? ""} onChange={(e) => onOrder(e.target.value ? Number(e.target.value) : null)} className={`${input} max-w-sm`}>
              <option value="">{t("Sipariş seç…", "Choose order…")}</option>
              {first.matches.map((m) => (
                <option key={m.receipt_id} value={m.receipt_id}>
                  %{Math.round(m.score * 100)} ({reasonText(m.reason)}) · {m.buyer} · {m.date} · {m.country}
                  {m.canceled ? t(" · İPTAL", " · CANCELED") : ""}
                </option>
              ))}
            </select>
          </>
        ) : (
          <input
            type="number"
            placeholder={t("Sipariş no (eşleşme yok)", "Order no. (no match)")}
            onChange={(e) => onOrder(e.target.value ? Number(e.target.value) : null)}
            className={`${input} w-48`}
          />
        )}
        <button
          type="button"
          disabled={receiptId === null || open.length === 0 || saving || weakLocked}
          onClick={onConfirm}
          title={weakLocked ? t("Zayıf eşleşme: doğru siparişi seç ya da \"Yine de eşleştir\" de", "Weak match: pick the right order or choose \"Match anyway\"") : undefined}
          className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {open.length > 1 ? t(`Onayla (${open.length} kalem)`, `Confirm (${open.length} lines)`) : t("Onayla", "Confirm")}
        </button>
        <button type="button" onClick={onSkipAll} className="text-sm text-neutral-500 hover:underline">
          {t("Atla", "Skip")}
        </button>
      </div>
      {weakLocked && (
        <div className="mt-1 text-xs text-red-700 dark:text-red-400">
          <b>{t("Zayıf eşleşme:", "Weak match:")}</b> {t("bu sipariş yanlış olabilir.", "this order may be the wrong one.")}{" "}
          <button type="button" onClick={() => setForce(true)} className="underline">
            {t("Yine de eşleştir", "Match anyway")}
          </button>
        </div>
      )}
      {match?.canceled && (
        <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          ⚠{" "}
          {t(
            "Bu sipariş iptal edilmiş: Finans iptal edilen siparişleri saymadığı için bu kargo maliyeti hiçbir raporda görünmez.",
            "This order was canceled: finance ignores canceled orders, so this shipping cost will not appear in any report.",
          )}
        </div>
      )}
      {match && (
        <ul className="mt-1 text-xs text-neutral-500">
          {match.items.map((it, i) => (
            <li key={i} className="line-clamp-1">
              → {it.qty}× {it.title}
              {it.variant_key ? ` [${it.variant_key.slice(0, 40)}]` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

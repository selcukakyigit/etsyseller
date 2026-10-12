"use client";

import { useT } from "@/lib/i18n-client";
import DecimalInput from "../components/DecimalInput";
import { materialLabel } from "../core/materials";
import { input, muted, rowBorder, td, th } from "../core/ui";
import { money, qty as fmtQty } from "../core/units";
import { PlanTarget, SplitMode } from "./api";

export type Draft = { shop_id: number; listing_id: number | null; variant: string; title: string; qty: number; amount: number | null; item_id: number | null };

const sameTarget = (a: Draft, b: Pick<PlanTarget, "shop_id" | "listing_id" | "variant">) => a.shop_id === b.shop_id && a.listing_id === b.listing_id && a.variant === (b.variant ?? "");

/** Dağıtım hedefleri: ürün başına tek satır (ad, malzeme, adet, lazer, malzeme ₺, pay); çok ürün olunca liste kaydırılır, başlık ve
 * toplam satırı yerinde kalır. `shares`: sunucunun hesapladığı paylar (kaydedilmemiş değişiklik varsa boş). */
export default function TargetsTable({
  targets,
  onChange,
  mode,
  shares,
  currency,
  shopNames,
  paintItems,
}: {
  targets: Draft[];
  onChange: (next: Draft[]) => void;
  mode: SplitMode;
  shares: PlanTarget[] | undefined;
  currency: string;
  /** Birden çok mağaza varsa mağaza adları; tek mağazada boş. */
  shopNames: Map<number, string> | null;
  /** m² fiyatlı (boya) dağıtımda seçilebilen boya türleri. */
  paintItems: { id: number; name: string }[] | null;
}) {
  const { t, locale } = useT();
  const rows = targets.map((d) => ({ d, sh: shares?.find((p) => sameTarget(d, p)) }));
  const hasEstimate = rows.some((r) => r.sh?.estimate);
  const sum = (pick: (r: (typeof rows)[number]) => number | null | undefined) => rows.reduce((total, r) => total + (pick(r) ?? 0), 0);
  const patch = (index: number, change: Partial<Draft>) => onChange(targets.map((x, i) => (i === index ? { ...x, ...change } : x)));
  const num = (value: number | null | undefined) => (value == null ? <span className="text-neutral-400">—</span> : money(value, currency, locale));

  return (
    <div className="mb-3 max-h-[28rem] overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900">
          <tr className={rowBorder}>
            <th className={`${th} pl-3`}>{t("Hedef", "Target")}</th>
            <th className={th}>{t("Malzeme", "Material")}</th>
            <th className={th}>{t("Adet", "Qty")}</th>
            {mode === "paint_rate" && <th className={th}>{t("Boya", "Paint")}</th>}
            {mode === "manual" && <th className={th}>{t("Tutar", "Amount")}</th>}
            {hasEstimate && <th className={`${th} text-right`}>{t("Lazer", "Laser")}</th>}
            {hasEstimate && <th className={`${th} text-right`}>{t("Malzeme ₺", "Material")}</th>}
            <th className={`${th} text-right`}>{t("Pay", "Share")}</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, sh }, i) => {
            const name = d.listing_id ? d.title || `#${d.listing_id}` : t("Genel gider", "Overhead");
            const mat = sh?.material;
            const matText = mat ? mat.parts.map((p) => `${p.qty > 1 ? `${p.qty}× ` : ""}${materialLabel(p.type, t) || p.name}${p.thickness ? ` ${p.thickness} mm` : ""}`).join(" + ") : "";
            return (
              <tr key={`${d.shop_id}-${d.listing_id}-${d.variant}`} className={`${rowBorder} odd:bg-neutral-50 dark:odd:bg-neutral-800/40`}>
                <td className={`${td} pl-3`}>
                  <div className="max-w-[18rem] truncate font-medium text-neutral-900 dark:text-neutral-100" title={name}>
                    {name}
                  </div>
                  <div className={`${muted} max-w-[18rem] truncate`} title={d.variant}>
                    {d.variant}
                    {shopNames?.get(d.shop_id) ? `${d.variant ? " · " : ""}${shopNames.get(d.shop_id)}` : ""}
                  </div>
                </td>
                <td className={td}>
                  {mat ? (
                    <div className="max-w-[14rem] text-xs font-medium text-emerald-700 dark:text-emerald-400" title={matText}>
                      <div className="truncate">{matText}</div>
                      {mat.kg > 0 && <div className="text-[11px] font-normal text-neutral-500 dark:text-neutral-400">{fmtQty(mat.kg, locale)} kg</div>}
                    </div>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className={td}>
                  <input
                    value={String(d.qty)}
                    onChange={(e) => patch(i, { qty: Math.max(1, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 1)) })}
                    inputMode="numeric"
                    className={`${input} w-16 py-1`}
                    aria-label={t("Adet", "Qty")}
                  />
                </td>
                {mode === "paint_rate" && (
                  <td className={td}>
                    <select
                      value={String(d.item_id ?? sh?.item_id ?? "")}
                      onChange={(e) => patch(i, { item_id: e.target.value ? Number(e.target.value) : null })}
                      className={`${input} w-36 py-1`}
                      aria-label={t("Boya türü", "Paint type")}
                    >
                      <option value="">{t("Seç…", "Select…")}</option>
                      {(paintItems ?? []).map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                {mode === "manual" && (
                  <td className={td}>
                    <DecimalInput
                      value={d.amount === null ? "" : String(d.amount)}
                      onValue={(text) => patch(i, { amount: text === "" ? null : Number(text.replace(",", ".")) || 0 })}
                      className={`${input} w-28 py-1`}
                      aria-label={t("Tutar", "Amount")}
                    />
                  </td>
                )}
                {hasEstimate && <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{num(sh?.estimate?.laser)}</td>}
                {hasEstimate && <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{num(sh?.estimate?.material)}</td>}
                <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">{num(sh?.share)}</div>
                  {sh?.report && (
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400" title={`1 ${currency} = ${sh.report.rate} ${sh.report.currency}`}>
                      ≈ {money(sh.report.amount, sh.report.currency, locale)}
                    </div>
                  )}
                  {d.listing_id && sh?.unit_share != null && d.qty > 1 && (
                    <div className="text-[11px] text-neutral-400">
                      {money(sh.unit_share, currency, locale)} / {t("adet", "unit")}
                    </div>
                  )}
                </td>
                <td className={`${td} pr-3 text-right`}>
                  <button type="button" onClick={() => onChange(targets.filter((_, idx) => idx !== i))} className="text-sm text-red-600 hover:underline dark:text-red-400" aria-label={t("Kaldır", "Remove")}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        {shares && (
          <tfoot className="sticky bottom-0 bg-white dark:bg-neutral-900">
            <tr className="border-t border-neutral-200 font-semibold dark:border-neutral-700">
              <td className={`${td} pl-3`} colSpan={mode === "manual" || mode === "paint_rate" ? 4 : 3}>
                {t("Toplam", "Total")} ({targets.length})
              </td>
              {hasEstimate && <td className={`${td} text-right tabular-nums`}>{num(sum((r) => r.sh?.estimate?.laser))}</td>}
              {hasEstimate && <td className={`${td} text-right tabular-nums`}>{num(sum((r) => r.sh?.estimate?.material))}</td>}
              <td className={`${td} text-right tabular-nums text-emerald-700 dark:text-emerald-400`}>{num(sum((r) => r.sh?.share))}</td>
              <td className={td} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

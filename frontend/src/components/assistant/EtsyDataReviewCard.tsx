"use client";

import { useState } from "react";
import { api, EtsyDataParsed } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";

/** Asistanın okuduğu Etsy arama verisi: kendiliğinden kaydedilmez; kullanıcı satırları seçip kaydeder. */
export default function EtsyDataReviewCard({ shopId, listingId, data }: { shopId: number; listingId: number | null; data: EtsyDataParsed }) {
  const { t, locale } = useT();
  const [selected, setSelected] = useState<boolean[]>(() => data.rows.map(() => true));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const num = (n: number | null) => (n === null || n === undefined ? "–" : n.toLocaleString(locale));
  const label = {
    marketplace_insights: t("Marketplace Insights", "Marketplace Insights"),
    search_terms: t("Arama terimleri", "Search terms"),
    ads: t("Etsy Ads arama terimleri", "Etsy Ads search queries"),
  }[data.source];
  const count = selected.filter(Boolean).length;

  async function save() {
    setState("saving");
    try {
      const r = await api.insights.saveEtsyData(shopId, {
        listing_id: listingId, source: data.source, period_start: data.period_start, period_end: data.period_end,
        rows: data.rows.filter((_, i) => selected[i]),
      });
      setState("saved");
      setMessage(
        r.tracked.length
          ? t(`${r.saved} satır kaydedildi; sıra takibine eklendi: ${r.tracked.join(", ")}`, `${r.saved} rows saved; added to rank tracking: ${r.tracked.join(", ")}`)
          : t(`${r.saved} satır kaydedildi`, `${r.saved} rows saved`),
      );
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error && e.message ? e.message : t("Kaydedilemedi", "Could not save"));
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-violet-300 bg-white dark:border-violet-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t("Etsy verisi", "Etsy data")} · {label}</span>
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-300">
          {state === "saved" ? t("KAYDEDİLDİ", "SAVED") : t("HENÜZ KAYDEDİLMEDİ", "NOT SAVED YET")}
        </span>
      </div>
      <div className="max-h-64 overflow-auto px-4 py-2">
        <table className="w-full text-xs text-neutral-700 dark:text-neutral-300">
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.keyword} className="border-b border-neutral-50 last:border-0 dark:border-neutral-800/60">
                <td className="w-6 py-1">
                  <input type="checkbox" checked={selected[i]} disabled={state === "saved" || state === "saving"} onChange={(e) => setSelected((s) => s.map((v, j) => (j === i ? e.target.checked : v)))} />
                </td>
                <td className="py-1 font-medium text-neutral-900 dark:text-neutral-100">{r.keyword}</td>
                <td className="py-1">
                  {data.source === "marketplace_insights"
                    ? t(`${num(r.searches)} arama/ay`, `${num(r.searches)} searches/mo`) + (r.competition ? ` · ${r.competition}` : "")
                    : t(`${num(r.views)} görüntülenme · ${num(r.clicks)} tıklama · ${num(r.orders)} sipariş`, `${num(r.views)} views · ${num(r.clicks)} clicks · ${num(r.orders)} orders`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <span className={`text-xs ${state === "error" ? "text-red-600 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400"}`}>
          {state === "saving" ? <Spinner size={14} /> : message}
        </span>
        {state !== "saved" && (
          <button
            type="button"
            disabled={count === 0 || state === "saving"}
            onClick={() => void save()}
            className="rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C6613F] disabled:opacity-40"
          >
            {t(`Seçilenleri kaydet (${count})`, `Save selected (${count})`)}
          </button>
        )}
      </div>
    </div>
  );
}

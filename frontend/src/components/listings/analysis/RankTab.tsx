"use client";

import { useEffect, useState } from "react";
import { emitRanksChanged } from "@/lib/syncEvents";
import { api, ListingRanks, RankKeyword } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { countryName } from "@/lib/countries";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { toast } from "@/lib/toast";

/** Sıra geçmişi: yukarı = daha iyi sıra. İlk `max` sonuçta olmadığı günler en altta. */
function Sparkline({ history, max }: { history: RankKeyword["history"]; max: number }) {
  if (history.length < 2) return null;
  const w = 96;
  const h = 28;
  const y = (p: number | null) => ((p ?? max + 1) - 1) / max * (h - 4) + 2;
  const points = history.map((s, i) => `${(i / (history.length - 1)) * w},${Math.min(h - 2, y(s.position))}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <polyline points={points} fill="none" stroke="#D97757" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function Change({ value }: { value: number | null }) {
  const { t } = useT();
  if (value === null) return <span className="text-neutral-400 dark:text-neutral-500">–</span>;
  if (value === 0) return <span className="text-neutral-500 dark:text-neutral-400">{t("aynı", "same")}</span>;
  return (
    <span className={value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value)}
    </span>
  );
}

/** Sıralama sekmesi: listing'in takip edilen Etsy aramalarındaki sırası, değişimi, rakip sayısı ve fiyat kıyası. */
export default function RankTab({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t, locale } = useT();
  const [data, setData] = useCached<ListingRanks>(`ranks:${shopId}:${listingId}`);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"" | "add" | "measure" | "stop">("");

  useEffect(() => {
    let cancelled = false;
    api.insights
      .ranks(shopId, listingId)
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error && e.message ? e.message : t("Sıralama yüklenemedi", "Could not load rankings"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, listingId, setData]);

  async function run(kind: "add" | "measure" | "stop", fn: () => Promise<ListingRanks>, measureAfter = false) {
    setBusy(kind);
    try {
      let r = await fn();
      setData(r);
      if (measureAfter) {
        setBusy("measure");
        r = await api.insights.measureNow(shopId, listingId);
        setData(r);
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("İşlem yapılamadı", "Could not complete the action"));
    } finally {
      setBusy("");
      emitRanksChanged();
    }
  }

  const add = (keyword: string) => {
    const k = keyword.trim();
    if (!k) return;
    setInput("");
    void run("add", () => api.insights.addKeyword(shopId, listingId, k), true);
  };

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  const full = data.keywords.length >= data.max_keywords;
  const money = (n: number, cur: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur || "USD", maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${n.toFixed(0)} ${cur}`;
    }
  };
  const fmtNum = (n: number) => n.toLocaleString(locale);
  const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "short" });
  const sourceLabel = { auto: t("otomatik", "auto"), user: t("senin", "yours"), etsy_data: t("Etsy verisi", "Etsy data") };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        {t(
          `Listing'in seçilen aramalarda Etsy'de kaçıncı sırada çıktığı her sabah ölçülür (${countryName(data.country, locale)} alıcısı için, oraya gönderilen listing'ler arasında, ilk ${data.max_results} sonuç${data.country_auto ? "; ülke en çok sattığın yere göre otomatik seçildi, Ayarlar > Mağaza'dan değiştirilebilir" : ""}). Sitedeki aramayla birebir aynı değildir ama yükselip düştüğünü güvenilir şekilde gösterir. Listing başına ${data.max_keywords} arama, mağaza başına ${data.max_listings} listing; şu an ${data.tracked_listings}/${data.max_listings} listing takipte.`,
          `Every morning we measure where the listing appears on Etsy for the chosen searches (for a buyer in ${countryName(data.country, locale)}, among listings shipping there, top ${data.max_results} results${data.country_auto ? "; the country was picked automatically from where you sell most and can be changed in Settings > Shop" : ""}). It is not identical to the search on the site, but it reliably shows whether the listing is rising or falling. ${data.max_keywords} searches per listing, ${data.max_listings} listings per shop; ${data.tracked_listings}/${data.max_listings} listings tracked now.`,
        )}
      </p>

      {data.keywords.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                <th className="px-3 py-2 font-medium">{t("Arama", "Search")}</th>
                <th className="px-3 py-2 font-medium">{t("Sıra", "Position")}</th>
                <th className="px-3 py-2 font-medium">{t("7 gün", "7 days")}</th>
                <th className="px-3 py-2 font-medium">{t("30 gün", "30 days")}</th>
                <th className="px-3 py-2 font-medium">{t("Geçmiş", "History")}</th>
                <th className="px-3 py-2 font-medium">{t("Rakip", "Competing")}</th>
                <th className="px-3 py-2 font-medium">{t("Fiyat: sen / ilk 20", "Price: you / top 20")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.keywords.map((k) => (
                <tr key={k.keyword} className="border-b border-neutral-50 last:border-0 dark:border-neutral-800/60">
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">{k.keyword}</div>
                    <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                      {sourceLabel[k.source]}
                      {k.measured && ` · ${fmtDay(k.measured)}`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    {k.measured ? (k.position ?? `${data.max_results}+`) : <span className="text-xs font-normal text-neutral-400">{t("bekliyor", "pending")}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs"><Change value={k.change_7d} /></td>
                  <td className="px-3 py-2 text-xs"><Change value={k.change_30d} /></td>
                  <td className="px-3 py-2"><Sparkline history={k.history} max={data.max_results} /></td>
                  <td className="px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">{k.total_results !== null ? fmtNum(k.total_results) : "–"}</td>
                  <td className="px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
                    {k.own_price !== null && k.top_price_median !== null ? (
                      <span title={k.top_price_low !== null && k.top_price_high !== null ? `${money(k.top_price_low, k.currency)} – ${money(k.top_price_high, k.currency)}` : undefined}>
                        <b className="text-neutral-800 dark:text-neutral-200">{money(k.own_price, k.currency)}</b> / {money(k.top_price_median, k.currency)}
                      </span>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void run("add", () => api.insights.removeKeyword(shopId, listingId, k.keyword))}
                      title={t("Takipten çıkar", "Stop tracking this search")}
                      className="rounded-full px-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!full && (
        <div className="space-y-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add(input);
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={100}
              placeholder={t("Takip edilecek arama, örn. metal farm sign", "Search to track, e.g. metal farm sign")}
              className="min-w-0 min-w-[220px] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              type="submit"
              disabled={!!busy || !input.trim()}
              className="rounded-lg bg-[#D97757] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#C6613F] disabled:opacity-40"
            >
              {t("Takibe al", "Track")}
            </button>
          </form>
          {data.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-neutral-500 dark:text-neutral-400">{t("Öneriler:", "Suggestions:")}</span>
              {data.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!!busy}
                  onClick={() => add(s)}
                  className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-neutral-700 hover:border-[#D97757] hover:text-[#B4553A] disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-[#E89A7F]"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {data.keywords.length > 0 && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run("measure", () => api.insights.measureNow(shopId, listingId))}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t("Şimdi ölç", "Measure now")}
          </button>
        )}
        {busy && (
          <span className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <Spinner size={14} />
            {busy === "measure" ? t("Etsy'de ölçülüyor (yarım dakika sürebilir)…", "Measuring on Etsy (may take half a minute)…") : t("Kaydediliyor…", "Saving…")}
          </span>
        )}
        {data.is_tracked && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run("stop", () => api.insights.stopTracking(shopId, listingId))}
            className="ml-auto text-xs text-neutral-500 underline hover:text-neutral-800 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            {t("Bu listing'in takibini bırak", "Stop tracking this listing")}
          </button>
        )}
      </div>
    </div>
  );
}

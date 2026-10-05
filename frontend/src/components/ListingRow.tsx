"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api, KeywordPoolItem, Listing } from "@/lib/api";
import ListingAnalysisPanel from "@/components/listings/analysis/ListingAnalysisPanel";
import { toast } from "@/lib/toast";
import { PublishJob } from "@/lib/publishJobs";
import PublishBar from "@/components/listings/PublishBar";
import { competitionFill, normalizedScore, poolRanges } from "@/lib/keywordScore";
import { useT } from "@/lib/i18n-client";
import RenewedBadge from "@/components/listings/RenewedBadge";

// Marketplace Insights dönüşüm bandı: [Türkçe, İngilizce]
const CONVERSION: Record<NonNullable<KeywordPoolItem["etsy_conversion"]>, [string, string]> = {
  very_low: ["çok düşük", "very low"],
  low: ["düşük", "low"],
  medium: ["orta", "medium"],
  high: ["yüksek", "high"],
  very_high: ["çok yüksek", "very high"],
};

function ScoredKeywordPills({ items, onTrack }: { items: KeywordPoolItem[]; onTrack?: (keyword: string) => void }) {
  // Normalized against the min/max *within this pool*, not the raw
  // score/sample_size ratio — competitor scores rarely get anywhere near
  // the sample size (13 tags spread across 50 listings), so every tag ends
  // up bunched in the same "low ratio" range and the color barely varies.
  // Comparing tags to each other instead spreads them across the full
  // green-to-red range, which is what's actually useful to look at.
  const ranges = useMemo(() => poolRanges(items), [items]);
  const { t } = useT();

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const normalized = normalizedScore(item, ranges);
        const fill = competitionFill(normalized, item.source);
        return (
          <span
            key={item.tag}
            title={
              item.source === "own"
                ? t(
                    `Senin listing'lerinden: ${(item.from_listings ?? []).join(" · ")}. Bu etiketi taşıyan benzer listing'lerin son 180 günde toplam ${item.units ?? 0} satışı var.${item.in_listing ? " Bu listing'de zaten kullanılıyor." : ""}`,
                    `From your listings: ${(item.from_listings ?? []).join(" · ")}. Similar listings with this tag sold ${item.units ?? 0} units in the last 180 days.${item.in_listing ? " Already used in this listing." : ""}`,
                  )
                : item.source === "etsy"
                  ? t(
                      `Etsy verisi: bu listing'e bu aramayla gelinmiş (${item.etsy_views ?? 0} görüntülenme, ${item.etsy_clicks ?? 0} tıklama, ${item.etsy_orders ?? 0} sipariş).`,
                      `Etsy data: this search brought visits to this listing (${item.etsy_views ?? 0} views, ${item.etsy_clicks ?? 0} clicks, ${item.etsy_orders ?? 0} orders).`,
                    )
                  : item.source === "research"
                    ? t(
                        "Kelime araştırman (Marketplace Insights): bu ürünle ilgili, Etsy'de aranan bir arama. Henüz bu listing'in kelime havuzunda yoktu.",
                        "Your keyword research (Marketplace Insights): a search on Etsy related to this product that was not yet in this listing's keyword pool.",
                      )
                    : t(
                        `Rakip listing'lerden: ilk ${item.sample_size} rakip listing'in ${item.score} tanesi bu etiketi kullanıyor (yüksek = kalabalık/rekabetçi)`,
                        `From competitor listings: ${item.score} of the top ${item.sample_size} competitor listings use this tag (high = crowded/competitive)`,
                      )
            }
            style={{ background: `linear-gradient(to right, ${fill} ${normalized * 100}%, transparent ${normalized * 100}%)` }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300"
          >
            {item.source === "own" && <span className="text-[9px] font-semibold text-[#D97757]">{t("SENİN", "YOURS")}</span>}
            {item.source === "etsy" && <span className="text-[9px] font-semibold text-violet-600 dark:text-violet-400">ETSY</span>}
            {item.source === "research" && <span className="text-[9px] font-semibold text-sky-600 dark:text-sky-400">{t("ARAŞTIRMA", "RESEARCH")}</span>}
            {item.tag}
            <span className="text-neutral-400 dark:text-neutral-500">
              {item.source === "own"
                ? `${item.units ?? 0} ${t("satış", "sales")}`
                : item.source === "etsy"
                  ? t(`${item.etsy_clicks ?? 0} tık · ${item.etsy_orders ?? 0} sip.`, `${item.etsy_clicks ?? 0} clicks · ${item.etsy_orders ?? 0} orders`)
                  : item.source === "research"
                    ? ""
                    : `${item.score}/${item.sample_size}`}
            </span>
            {item.in_listing && <span className="text-emerald-500" title={t("Bu listing'de zaten var", "Already in this listing")}>✓</span>}
            {item.google_score !== undefined && <span className="text-blue-500 dark:text-blue-400">G:{item.google_score}</span>}
            {item.etsy_searches ? (
              <span
                className="text-violet-600 dark:text-violet-400"
                title={[
                  t("Etsy'de arama sayısı (Marketplace Insights)", "Searches on Etsy (Marketplace Insights)"),
                  item.etsy_trend_pct != null ? t(`değişim ${item.etsy_trend_pct > 0 ? "+" : ""}${item.etsy_trend_pct}%`, `change ${item.etsy_trend_pct > 0 ? "+" : ""}${item.etsy_trend_pct}%`) : "",
                  item.etsy_results != null ? t(`${item.etsy_results.toLocaleString()} arama sonucu`, `${item.etsy_results.toLocaleString()} search results`) : "",
                  item.etsy_conversion ? t(`dönüşüm: ${CONVERSION[item.etsy_conversion][0]}`, `conversion: ${CONVERSION[item.etsy_conversion][1]}`) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                E:{item.etsy_searches >= 1000 ? `${(item.etsy_searches / 1000).toFixed(1)}k` : item.etsy_searches}
                {item.etsy_conversion && (
                  <span className={item.etsy_conversion === "very_low" || item.etsy_conversion === "low" ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                    {" "}
                    {t(`dön. ${CONVERSION[item.etsy_conversion][0]}`, `conv. ${CONVERSION[item.etsy_conversion][1]}`)}
                  </span>
                )}
              </span>
            ) : null}
            {onTrack && (
              <button
                type="button"
                onClick={() => onTrack(item.tag)}
                title={t("Bu aramada sıra takibine al", "Track rank for this search")}
                className="ml-0.5 rounded-full px-1 text-neutral-400 hover:bg-[#D97757]/15 hover:text-[#B4553A] dark:hover:text-[#E89A7F]"
              >
                ⌖
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

const pill =
  "whitespace-nowrap text-center text-xs font-medium text-neutral-600 dark:text-neutral-300 px-2.5 py-2 sm:py-1 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition";

export default function ListingRow({
  shopId,
  listing,
  selected,
  onSelectChange,
  onPublish,
  publishing,
  job,
  publishError,
}: {
  shopId: number;
  listing: Listing;
  /** Preview/test escape hatch: pass pre-built history instead of hitting the API. */
  /** Toplu işlem için seçim; verilmezse onay kutusu gösterilmez. */
  selected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  /** Kaydedilmiş yerel sürümü Etsy'de yayınlar; yalnızca yerel değişikliği olan listing'lerde gösterilir. */
  onPublish?: () => void;
  publishing?: boolean;
  job?: PublishJob;
  publishError?: string | null;
}) {
  const { t, locale } = useT();
  const num = (n: number | null | undefined) => new Intl.NumberFormat(locale).format(n ?? 0); // 48561 → 48.561 / 48,561
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keywordPool, setKeywordPool] = useState<KeywordPoolItem[] | null>(null);
  const [keywordPoolLoading, setKeywordPoolLoading] = useState(false);
  const [trendsLoading, setTrendsLoading] = useState(false);

  async function handleToggleKeywordPool() {
    if (keywordPool) {
      setKeywordPool(null);
      return;
    }
    setKeywordPoolLoading(true);
    setError(null);
    try {
      const result = await api.listings.keywordPool(shopId, listing.listing_id);
      setKeywordPool(result.keywords);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
    } finally {
      setKeywordPoolLoading(false);
    }
  }

  async function handleTrack(keyword: string) {
    try {
      await api.insights.addKeyword(shopId, listing.listing_id, keyword);
      toast.success(t(`"${keyword}" sıra takibine eklendi; Analiz > Sıralama'da görünür.`, `"${keyword}" added to rank tracking; see Analysis > Rankings.`));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("Takibe alınamadı", "Could not start tracking"));
    }
  }

  async function handleLoadTrends() {
    setTrendsLoading(true);
    setError(null);
    try {
      const result = await api.listings.keywordTrends(shopId, listing.listing_id);
      const googleScoreByTag = new Map(result.keywords.map((item) => [item.tag, item.google_score]));
      setKeywordPool((prev) =>
        prev
          ? prev.map((item) =>
              googleScoreByTag.has(item.tag) ? { ...item, google_score: googleScoreByTag.get(item.tag) } : item
            )
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
    } finally {
      setTrendsLoading(false);
    }
  }

  return (
    <div
      className={`border rounded-xl bg-white dark:bg-neutral-900 overflow-hidden ${
        selected ? "border-[#D97757]" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      {/* Mobilde iki kat (bilgi üstte, düğmeler altta eşit genişlikte); geniş ekranda tek satır. */}
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          {onSelectChange && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={(e) => onSelectChange(e.target.checked)}
              aria-label={t(`${listing.title} seç`, `Select ${listing.title}`)}
              className="h-4 w-4 flex-shrink-0 accent-[#D97757]"
            />
          )}

          <Link href={`/listings/${listing.listing_id}/edit`} className="flex-shrink-0">
            {listing.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listing.image_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-16 w-16 rounded-lg border border-neutral-100 object-cover dark:border-neutral-800 sm:h-14 sm:w-14"
              />
            ) : (
              <div className="h-16 w-16 rounded-lg bg-neutral-100 dark:bg-neutral-800 sm:h-14 sm:w-14" />
            )}
          </Link>

          <div className="min-w-0 flex-1">
            <Link
              href={`/listings/${listing.listing_id}/edit`}
              title={listing.title}
              className="line-clamp-2 text-sm font-medium leading-snug text-neutral-900 hover:underline dark:text-neutral-100 sm:line-clamp-1 sm:text-base"
            >
              {listing.title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
              {listing.has_local && (
                <span
                  title={t("Kaydedildi ama Etsy'ye henüz yayınlanmadı", "Saved but not yet published to Etsy")}
                  className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  {t("Yayınlanmadı", "Unpublished")}
                </span>
              )}
              {listing.has_draft && (
                <span
                  title={t("Bu listing için kayıtlı bir taslak var (listeyi etkilemez)", "This listing has a saved draft (it does not affect the list)")}
                  className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {t("Taslak", "Draft")}
                </span>
              )}
              <span className="tabular-nums">
                {t(
                  `${num(listing.views)} görüntülenme · ${num(listing.favorites)} favori · ${listing.tags.length} etiket`,
                  `${num(listing.views)} views · ${num(listing.favorites)} favorites · ${listing.tags.length} tags`,
                )}
              </span>
              <RenewedBadge timestamp={listing.renewed_timestamp} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-shrink-0 sm:items-center">
          <button onClick={() => setHistoryOpen((v) => !v)} className={pill}>
            {historyOpen ? t("Analizi gizle", "Hide analysis") : t("Analiz", "Analysis")}
          </button>
          <button onClick={handleToggleKeywordPool} disabled={keywordPoolLoading} className={`${pill} disabled:opacity-50`}>
            {keywordPoolLoading ? t("Yükleniyor…", "Loading…") : keywordPool ? t("Havuzu gizle", "Hide pool") : t("Kelime havuzu", "Keyword pool")}
          </button>
          <Link href={`/listings/${listing.listing_id}/edit`} className={pill}>
            {t("Düzenle", "Edit")}
          </Link>
          {listing.has_local && onPublish && (
            <button
              onClick={onPublish}
              disabled={publishing}
              className="col-span-3 rounded-lg bg-[#D97757] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#C6613F] disabled:opacity-50 sm:col-span-1 sm:py-1.5"
            >
              {publishing ? t("Yayınlanıyor…", "Publishing…") : t("Etsy'de yayınla", "Publish to Etsy")}
            </button>
          )}
        </div>
      </div>

      {(error || publishError) && <p className="px-4 pb-3 text-sm text-red-600">{error ?? publishError}</p>}
      {job && <PublishBar id={listing.listing_id} job={job} />}

      {historyOpen && <ListingAnalysisPanel shopId={shopId} listingId={listing.listing_id} />}

      {keywordPool && (
        <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
              {t(
                "SENİN: bu listing'e benzeyen kendi listing'lerinden gelen etiket; sayı, o etiketi taşıyan listing'lerin son 180 gündeki toplam satışı (✓ = bu listing'de zaten var). Rakip etiketlerde 11/50 = ilk 50 rakip listing'in 11'i kullanıyor (yüksek = kalabalık). ETSY: Etsy verisine göre listing'i gerçekten getiren arama. E: Etsy'de aylık arama (Analiz > Etsy verisi'nden). G: Google Trends ilgisi (0-100, Etsy içi arama hacmi değil). ⌖ ile aramayı sıra takibine alırsın. \"AI Önerisi Üret\" bu havuzdan uygun olanları seçer.",
                "YOURS: a tag from your own listings similar to this one; the number is the total sales of listings with that tag in the last 180 days (✓ = already in this listing). For competitor tags, 11/50 = 11 of the top 50 competitor listings use it (high = crowded). ETSY: a search that actually brought visits, according to Etsy data. E: monthly searches on Etsy (from Analysis > Etsy data). G: Google Trends interest (0-100, not Etsy search volume). ⌖ adds the search to rank tracking. \"Generate AI suggestion\" picks suitable tags from this pool.",
              )}
            </p>
            <button
              onClick={handleLoadTrends}
              disabled={trendsLoading}
              className={`${pill} flex-shrink-0 disabled:opacity-50`}
            >
              {trendsLoading ? t("Google Trend yükleniyor…", "Loading Google Trends…") : t("Google Trend Ekle", "Add Google Trends")}
            </button>
          </div>
          {keywordPool.length > 0 ? (
            <ScoredKeywordPills items={keywordPool} onTrack={listing.listing_id > 0 ? (k) => void handleTrack(k) : undefined} />
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {t("Havuz boş — henüz yeterli performans geçmişi veya kategori verisi yok.", "The pool is empty — not enough performance history or category data yet.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

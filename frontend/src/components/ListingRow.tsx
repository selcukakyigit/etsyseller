"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api, KeywordPoolItem, Listing, ListingHistory } from "@/lib/api";
import ListingHistoryPanel from "@/components/ListingHistoryPanel";

/** Green = favorable, red = unfavorable — same convention every SEO tool
 * uses for a difficulty/competition score. But our score means opposite
 * things depending on where it came from: for a competitor tag, a high
 * score means "most top listings already use this" (saturated → red). For
 * your own tag, a high score means "your own best-growing listings use
 * this" (proven winner → green). So the direction flips by source. */
function competitionFill(normalized: number, source: KeywordPoolItem["source"]): string {
  const favorable = source === "own" ? normalized : 1 - normalized;
  const hue = favorable * 130; // 0 = red, 130 = green
  return `hsla(${hue}, 70%, 45%, 0.3)`;
}

function ScoredKeywordPills({ items }: { items: KeywordPoolItem[] }) {
  // Normalized against the min/max *within this pool*, not the raw
  // score/sample_size ratio — competitor scores rarely get anywhere near
  // the sample size (13 tags spread across 50 listings), so every tag ends
  // up bunched in the same "low ratio" range and the color barely varies.
  // Comparing tags to each other instead spreads them across the full
  // green-to-red range, which is what's actually useful to look at.
  const ranges = useMemo(() => {
    const bySource = new Map<string, { min: number; max: number }>();
    for (const item of items) {
      const range = bySource.get(item.source) ?? { min: Infinity, max: -Infinity };
      range.min = Math.min(range.min, item.score);
      range.max = Math.max(range.max, item.score);
      bySource.set(item.source, range);
    }
    return bySource;
  }, [items]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const range = ranges.get(item.source)!;
        const normalized = range.max > range.min ? (item.score - range.min) / (range.max - range.min) : 1;
        const fill = competitionFill(normalized, item.source);
        return (
          <span
            key={item.tag}
            title={`${item.source === "own" ? "Kendi listing'lerinden" : "Rakip listing'lerden"}: ${item.score}/${item.sample_size} kullanıyor (bu havuzdaki diğer etiketlere göre renklendirildi)`}
            style={{ background: `linear-gradient(to right, ${fill} ${normalized * 100}%, transparent ${normalized * 100}%)` }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300"
          >
            {item.source === "own" && <span className="text-[9px] font-semibold text-[#F1641E]">KENDİ</span>}
            {item.tag}
            <span className="text-neutral-400 dark:text-neutral-500">
              {item.score}/{item.sample_size}
            </span>
            {item.google_score !== undefined && <span className="text-blue-500 dark:text-blue-400">G:{item.google_score}</span>}
          </span>
        );
      })}
    </div>
  );
}

const pill =
  "text-xs font-medium text-neutral-500 dark:text-neutral-400 px-2.5 py-1 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition";

export default function ListingRow({
  shopId,
  listing,
  mockHistory,
  selected,
  onSelectChange,
  onPublish,
  publishing,
  publishError,
}: {
  shopId: number;
  listing: Listing;
  /** Preview/test escape hatch: pass pre-built history instead of hitting the API. */
  mockHistory?: ListingHistory;
  /** Toplu işlem için seçim; verilmezse onay kutusu gösterilmez. */
  selected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  /** Kaydedilmiş yerel sürümü Etsy'de yayınlar; yalnızca yerel değişikliği olan listing'lerde gösterilir. */
  onPublish?: () => void;
  publishing?: boolean;
  publishError?: string | null;
}) {
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
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setKeywordPoolLoading(false);
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
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setTrendsLoading(false);
    }
  }

  return (
    <div
      className={`border rounded-xl bg-white dark:bg-neutral-900 overflow-hidden ${
        selected ? "border-[#F1641E]" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex items-center gap-4 p-4">
        {onSelectChange && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => onSelectChange(e.target.checked)}
            aria-label={`${listing.title} seç`}
            className="h-4 w-4 flex-shrink-0 accent-[#F1641E]"
          />
        )}

        {listing.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.image_url}
            alt=""
            className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-neutral-100 dark:border-neutral-800"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex-shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <p className="font-medium text-neutral-900 dark:text-neutral-100 truncate">{listing.title}</p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
            {listing.views ?? 0} görüntülenme · {listing.favorites ?? 0} favori · {listing.tags.length} etiket
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {listing.has_local && (
            <span
              title="Kaydedildi ama Etsy'ye henüz yayınlanmadı"
              className="text-xs font-medium text-amber-700 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300"
            >
              Yayınlanmadı
            </span>
          )}
          {listing.has_draft && (
            <span
              title="Bu listing için kayıtlı bir taslak var (listeyi etkilemez)"
              className="text-xs font-medium text-neutral-600 px-2.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-300"
            >
              Taslak
            </span>
          )}
          <button onClick={() => setHistoryOpen((v) => !v)} className={pill}>
            {historyOpen ? "Geçmişi gizle" : "Geçmiş"}
          </button>
          <button onClick={handleToggleKeywordPool} disabled={keywordPoolLoading} className={`${pill} disabled:opacity-50`}>
            {keywordPoolLoading ? "Yükleniyor…" : keywordPool ? "Havuzu gizle" : "Kelime Havuzu"}
          </button>
          <Link href={`/listings/${listing.listing_id}/edit`} className={pill}>
            Düzenle
          </Link>
          {listing.has_local && onPublish && (
            <button
              onClick={onPublish}
              disabled={publishing}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition disabled:opacity-50"
            >
              {publishing ? "Yayınlanıyor…" : "Etsy'de yayınla"}
            </button>
          )}
        </div>
      </div>

      {(error || publishError) && <p className="px-4 pb-3 text-sm text-red-600">{error ?? publishError}</p>}

      {historyOpen && <ListingHistoryPanel shopId={shopId} listingId={listing.listing_id} initialHistory={mockHistory} />}

      {keywordPool && (
        <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
              Sayı = kaç rakip/kendi listing&apos;in bu etiketi kullandığı (ör. 11/50). G: Google&apos;daki arama ilgisi (0-100,
              Etsy içi değil) — düzenleme sayfasındaki &quot;AI Önerisi Üret&quot; bu havuzdan uygun olanları seçer.
            </p>
            <button
              onClick={handleLoadTrends}
              disabled={trendsLoading}
              className={`${pill} flex-shrink-0 disabled:opacity-50`}
            >
              {trendsLoading ? "Google Trend yükleniyor…" : "Google Trend Ekle"}
            </button>
          </div>
          {keywordPool.length > 0 ? (
            <ScoredKeywordPills items={keywordPool} />
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Havuz boş — henüz yeterli performans geçmişi veya kategori verisi yok.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

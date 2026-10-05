"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ShopReview, ShopReviewStats } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import { Pager } from "@/components/shipping/shared";
import { useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";
import { PageSpinner } from "@/components/ui/Spinner";

const PAGE_SIZE = 20;
const MONTH_LABEL = (m: string, locale: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(locale, { month: "short" });
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-sm text-amber-500">
      {"★".repeat(rating)}
      <span className="text-neutral-300 dark:text-neutral-700">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function RatingDistribution({
  dist,
  active,
  onSelect,
}: {
  dist: Record<string, number>;
  active: number | null;
  onSelect: (star: number) => void;
}) {
  const max = Math.max(1, ...Object.values(dist));
  return (
    <div className="space-y-1.5">
      {["5", "4", "3", "2", "1"].map((star) => {
        const n = dist[star] ?? 0;
        const isActive = active === Number(star);
        return (
          <button
            key={star}
            type="button"
            onClick={() => onSelect(Number(star))}
            className={`flex w-full items-center gap-2 rounded text-xs ${isActive ? "opacity-100" : "opacity-90 hover:opacity-100"}`}
          >
            <span className={`w-8 shrink-0 text-left ${isActive ? "font-semibold text-[#D97757]" : "text-neutral-500"}`}>{star}★</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className={`h-full rounded-full ${isActive ? "bg-[#D97757]" : "bg-amber-400"}`}
                style={{ width: `${(n / max) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-neutral-400">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function MonthlyTrend({
  monthly,
  active,
  onSelect,
}: {
  monthly: ShopReviewStats["monthly"];
  active: string | null;
  onSelect: (month: string) => void;
}) {
  const max = Math.max(1, ...monthly.map((m) => m.count));
  const { t, locale } = useT();
  return (
    <div className="flex h-24 items-end gap-1.5">
      {monthly.map((m) => {
        const isActive = active === m.month;
        return (
          <button
            key={m.month}
            type="button"
            onClick={() => onSelect(m.month)}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${m.month}: ${m.count} ${t("yorum", "reviews")}`}
          >
            <div
              className={`w-full rounded-t ${isActive ? "bg-[#D97757]" : "bg-[#D97757]/80 hover:bg-[#D97757]"}`}
              style={{ height: `${Math.max(2, (m.count / max) * 72)}px` }}
            />
            <span className={`text-[9px] ${isActive ? "font-semibold text-[#D97757]" : "text-neutral-400"}`}>{MONTH_LABEL(m.month, locale)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ListingStatList({ items }: { items: ShopReviewStats["top_reviewed"] }) {
  const { t } = useT();
  if (items.length === 0) return <p className="text-xs text-neutral-400">{t("Henüz yeterli veri yok.", "Not enough data yet.")}</p>;
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={it.listing_id} className="flex items-center gap-2 text-xs">
          <span className="w-4 shrink-0 text-neutral-400">{i + 1}.</span>
          <a
            href={`https://www.etsy.com/listing/${it.listing_id}`}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-neutral-700 hover:text-[#D97757] hover:underline dark:text-neutral-300"
          >
            {it.title || `Listing #${it.listing_id}`}
          </a>
          <span className="shrink-0 text-neutral-400">
            ⭐ {it.average} · {it.count}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ReviewsPageInner() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t, locale } = useT();
  const shopId = activeShop?.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(0, Number(searchParams.get("page") ?? "1") - 1);
  const ratingFilter = searchParams.get("rating") ? Number(searchParams.get("rating")) : null;
  const monthFilter = searchParams.get("month");

  // Sayfa/filtre değişince URL'e yazılır — geri tuşu, paylaşılabilir bağlantı ve sayfa yenilemede kaybolmama
  // için hepsi query param olarak tutuluyor, ayrı ayrı React state yerine.
  function navigate(patch: { page?: number; rating?: number | null; month?: string | null }) {
    const sp = new URLSearchParams(searchParams.toString());
    if (patch.page !== undefined) sp.set("page", String(patch.page + 1));
    if ("rating" in patch) {
      if (patch.rating) sp.set("rating", String(patch.rating));
      else sp.delete("rating");
    }
    if ("month" in patch) {
      if (patch.month) sp.set("month", patch.month);
      else sp.delete("month");
    }
    router.push(`/reviews?${sp.toString()}`);
  }
  const setPage = (p: number) => navigate({ page: p });
  const toggleRating = (star: number) => navigate({ page: 0, rating: ratingFilter === star ? null : star });
  const toggleMonth = (month: string) => navigate({ page: 0, month: monthFilter === month ? null : month });

  const listKey = shopId !== undefined ? `reviews:${shopId}:${page}:${ratingFilter ?? ""}:${monthFilter ?? ""}` : null;
  const [list, setList] = useCached<{ total: number; average: number | null; reviews: ShopReview[] }>(listKey, { keepPrevious: true });
  const total = list?.total ?? null;
  const average = list?.average ?? null;
  const reviews = list?.reviews ?? null;
  const [stats, setStats] = useCached<ShopReviewStats | null>(shopId !== undefined ? `review-stats:${shopId}` : null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (shopId === undefined) return;
    api.shops
      .reviews(shopId, {
        limit: PAGE_SIZE, offset: page * PAGE_SIZE,
        rating: ratingFilter ?? undefined, month: monthFilter ?? undefined,
      })
      .then((r) => {
        setList({ total: r.total, average: r.average, reviews: r.reviews });
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, page, ratingFilter, monthFilter, setList]);

  useEffect(() => {
    load();
  }, [load]);

  // İstatistikler sayfa değişince yeniden çekilmez — mağaza değişince bir kez.
  useEffect(() => {
    if (shopId === undefined) return;
    api.shops
      .reviewStats(shopId)
      .then(setStats)
      .catch(() => setStats(null));
  }, [shopId, setStats]);

  const pages = total !== null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/reviews">
      <div className="mx-auto max-w-3xl space-y-6 px-4 sm:px-6 py-6 sm:py-8">
        {/* Başlık + üst sayfalama + istatistik kartları: hepsi tek blok olarak sabit — kaydırınca liste
            altından geçer, sayfa değiştirince de bu blok yerinden oynamaz. */}
        {/* Yalnızca geniş ekranda sabit: telefonda kartlar alt alta dizilince blok ekrandan uzun oluyor ve listeyi kapatıyordu. */}
        <div className="-mx-4 bg-neutral-50 px-4 pb-4 dark:bg-neutral-950 sm:-mx-6 sm:px-6 lg:sticky lg:top-[49px] lg:z-10">
          <div className="pt-2">
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("Yorumlar", "Reviews")}</h1>
            {total !== null && average !== null && (
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                ⭐ {average.toFixed(1)} · {total} {t("yorum", "reviews")}
              </p>
            )}
          </div>

          {activeShop && pages > 1 && (
            <div className="mt-2">
              <Pager page={page} pages={pages} onPage={setPage} />
            </div>
          )}

          {stats && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="mb-2 text-xs font-semibold text-neutral-500">{t("Puan dağılımı — tıklayınca filtreler", "Rating breakdown — click to filter")}</p>
                <RatingDistribution dist={stats.rating_distribution} active={ratingFilter} onSelect={toggleRating} />
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="mb-2 text-xs font-semibold text-neutral-500">{t("Aylık yorum sayısı (son 12 ay) — tıklayınca filtreler", "Reviews per month (last 12 months) — click to filter")}</p>
                <MonthlyTrend monthly={stats.monthly} active={monthFilter} onSelect={toggleMonth} />
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="mb-2 text-xs font-semibold text-neutral-500">{t("En çok yorum alan listing'ler", "Most reviewed listings")}</p>
                <ListingStatList items={stats.top_reviewed} />
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="mb-2 text-xs font-semibold text-neutral-500">{t("En sevilen listing'ler (en az 3 yorum)", "Top rated listings (at least 3 reviews)")}</p>
                <ListingStatList items={stats.top_rated} />
              </div>
            </div>
          )}
        </div>

        {(bootError || error) && <p className="text-sm text-red-600">{bootError ?? error}</p>}

        {!activeShop && user && shops !== null && <p className="text-sm text-neutral-500">{t("Önce Etsy mağazanı bağla.", "Connect your Etsy shop first.")}</p>}

        {activeShop && (
          <>
            {(ratingFilter || monthFilter) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-neutral-400">{t("Filtre:", "Filter:")}</span>
                {ratingFilter && (
                  <button
                    type="button"
                    onClick={() => toggleRating(ratingFilter)}
                    className="inline-flex items-center gap-1 rounded-full bg-[#D97757]/10 px-2.5 py-1 font-medium text-[#D97757]"
                  >
                    {ratingFilter}★ <span aria-hidden>×</span>
                  </button>
                )}
                {monthFilter && (
                  <button
                    type="button"
                    onClick={() => toggleMonth(monthFilter)}
                    className="inline-flex items-center gap-1 rounded-full bg-[#D97757]/10 px-2.5 py-1 font-medium text-[#D97757]"
                  >
                    {MONTH_LABEL(monthFilter, locale)} <span aria-hidden>×</span>
                  </button>
                )}
              </div>
            )}

            <div className="space-y-3">
              {reviews === null && <PageSpinner />}
              {reviews && reviews.length === 0 && <p className="text-sm text-neutral-400">{t("Henüz yorum yok.", "No reviews yet.")}</p>}
              {(reviews ?? []).map((r) => (
                <div
                  key={r.transaction_id}
                  className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-center justify-between gap-3">
                    <Stars rating={r.rating} />
                    <span className="text-xs text-neutral-400">{formatDate(r.created_at, locale)}</span>
                  </div>
                  {r.review && <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{r.review}</p>}
                  {r.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt="" className="mt-2 h-20 w-20 rounded-lg object-cover" />
                  )}
                  <a
                    href={`https://www.etsy.com/listing/${r.listing_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs text-neutral-400 hover:text-[#D97757] hover:underline"
                  >
                    Listing #{r.listing_id}
                  </a>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

// useSearchParams() üretim derlemesinde Suspense sınırı ister; yoksa sayfa önceden render edilemez ve build düşer.
export default function ReviewsPage() {
  return (
    <Suspense fallback={null}>
      <ReviewsPageInner />
    </Suspense>
  );
}

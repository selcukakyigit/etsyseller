"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { EtsyAnalysis, discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";

const STRENGTH_STYLE = {
  low: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  medium: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  high: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
} as const;

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800" title={hint}>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{children}</div>
    </div>
  );
}

/** Bir aramanın Etsy'deki ilk 20 sonucunun analizi ("rekabet kalitesi"). Etsy verisidir (Google değil), saklanmaz. Pencere boyutu sabit; ilan listesi kendi içinde kayar. */
export default function EtsyTopModal({ shopId, term, onClose }: { shopId: number; term: string; onClose: () => void }) {
  const { t, locale } = useT();
  const [state, setState] = useState<{ term: string; analysis: EtsyAnalysis | null; limited: boolean; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    discoverApi
      .etsyTop(shopId, term)
      .then((r) => !cancelled && setState({ term, analysis: r.analysis, limited: r.limited, error: null }))
      .catch((e) => !cancelled && setState({ term, analysis: null, limited: false, error: e instanceof Error && e.message ? e.message : t("Analiz alınamadı", "Could not load the analysis") }));
    return () => {
      cancelled = true;
    };
  }, [shopId, term, t]);

  const data = state && state.term === term ? state : null;
  const a = data?.analysis ?? null;
  const money = (n: number | null) => (n === null || !a?.currency ? "—" : n.toLocaleString(locale, { style: "currency", currency: a.currency, maximumFractionDigits: 0 }));
  const strengthLabel = (s: "low" | "medium" | "high") => (s === "low" ? t("Düşük", "Low") : s === "medium" ? t("Orta", "Medium") : t("Yüksek", "High"));

  return (
    <Modal title={t(`Etsy'de “${term}”`, `“${term}” on Etsy`)} widthClass="max-w-3xl" onClose={onClose} closeButton>
      <div className="min-h-[30rem] space-y-4">
        {!data ? (
          <BlockSpinner />
        ) : data.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{data.error}</p>
        ) : data.limited ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {t("Etsy ölçüm hakkın geçici olarak doldu; birkaç dakika sonra dene.", "Your Etsy measurement allowance is used up for now; try again in a few minutes.")}
          </p>
        ) : !a || a.sample === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">{t("Bu arama için Etsy'de sonuç yok. Daha genel bir ifade dene.", "No Etsy results for this search. Try a more general phrase.")}</p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span>{t("Etsy verisi (Google değil). İlk 20 sonuç, Etsy'nin ilgililik sırasıyla.", "Etsy data (not Google). The first 20 results in Etsy's relevance order.")}</span>
              <HelpTip>
                {t(
                  "Kanıtlanmış ilan: 10 ve üzeri favorisi olan ilan sayısı. Etsy'nin ilk sonuçları çok sayıda yeni ve henüz favorisi olmayan ilan içerdiğinden medyan favori işe yaramaz; asıl ayrım, ilk 20'nin kaçının gerçekten tuttuğudur. Rekabet göstergesi bu sayıdan türeyen kaba bir ölçüdür (0-3 düşük, 4-8 orta, 9+ yüksek), kesin ölçü değildir. Yeni giriş payı: son 90 günde açılmış ilan oranı (yüksekse yeni ilanlar da görünür olabiliyor). Veriler saklanmaz, bir saat önbellekte kalır.",
                  "Proven listings: how many have 10+ favorites. Etsy's first results include many new listings without favorites, so the median favorite count is useless; what matters is how many of the first 20 have actually caught on. The competition indicator is a rough measure derived from it (0-3 low, 4-8 medium, 9+ high), not an exact one. New-entry share: share of listings created in the last 90 days (high means new listings can surface). Data is not stored; it is cached for an hour.",
                )}
              </HelpTip>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t("Etsy'de ilan", "Etsy listings")}>{a.total.toLocaleString(locale)}</Stat>
              <Stat label={t("Kanıtlanmış ilan", "Proven listings")} hint={t("10+ favorisi olan, ilk 20 içinde", "10+ favorites, among the first 20")}>
                <span className="flex items-center gap-2">
                  {a.proven}
                  <span className="text-sm font-normal text-neutral-400">/ {a.sample}</span>
                  {a.strength && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STRENGTH_STYLE[a.strength]}`}>{strengthLabel(a.strength)}</span>}
                </span>
              </Stat>
              <Stat label={t("Fiyat bandı", "Price range")} hint={t("İlk 20'nin alt çeyrek – medyan – üst çeyrek fiyatı", "Lower quartile – median – upper quartile of the first 20")}>
                <span className="text-base">
                  {money(a.price.p25)}–{money(a.price.p75)}
                </span>
                <span className="block text-[11px] font-normal text-neutral-400">
                  {t("medyan", "median")} {money(a.price.median)}
                </span>
              </Stat>
              <Stat label={t("Yeni giriş payı", "New-entry share")} hint={t("Son 90 günde açılmış ilanların payı", "Share of listings created in the last 90 days")}>
                {a.new_share === null ? "—" : `%${Math.round(a.new_share * 100)}`}
              </Stat>
            </div>

            {a.top_tags.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("Rakiplerin en sık etiketleri (ilk 20'de kaç ilanda)", "Competitors' most used tags (in how many of the first 20)")}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {a.top_tags.map((tag) => (
                    <span key={tag.tag} className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                      {tag.tag} <span className="text-neutral-400">{tag.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("İlk 20 ilan", "First 20 listings")}</h3>
              <ul className="max-h-80 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {a.listings.map((l, i) => (
                  <li key={l.listing_id ?? i} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-neutral-400">{i + 1}</span>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-neutral-900 hover:underline dark:text-neutral-100" title={l.title}>
                      {l.title}
                    </a>
                    <span className="hidden shrink-0 text-xs tabular-nums text-neutral-500 sm:inline">{l.price === null ? "—" : l.price.toLocaleString(locale, { style: "currency", currency: l.currency ?? a.currency ?? "USD", maximumFractionDigits: 0 })}</span>
                    <span className={`w-14 shrink-0 text-right text-xs tabular-nums ${l.favorites >= 10 ? "font-medium text-green-600 dark:text-green-400" : "text-neutral-400"}`} title={t("Favori", "Favorites")}>
                      ♥ {l.favorites.toLocaleString(locale)}
                    </span>
                    <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-neutral-400 sm:inline" title={t("Toplam görüntülenme · ilanın yaşı", "Total views · listing age")}>
                      {l.views.toLocaleString(locale)} · {l.age_days < 60 ? `${l.age_days}${t("g", "d")}` : `${Math.round(l.age_days / 30)}${t("ay", "mo")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <a href={`https://www.etsy.com/search?q=${encodeURIComponent(term)}`} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-[#C6613F] hover:underline dark:text-[#D97757]">
              {t("Etsy'de aç ↗", "Open on Etsy ↗")}
            </a>
          </>
        )}
      </div>
    </Modal>
  );
}

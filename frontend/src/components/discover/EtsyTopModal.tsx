"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { EtsyAnalysis, discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";

/** İlan listesinin sütunları: sıra, resim, başlık, Etsy bağlantısı, fiyat, favori, görüntülenme, yaş. Başlık satırı ve ilan satırları aynı şablonu kullanır. */
const LIST_COLUMNS = "1.25rem 3.5rem minmax(0,1fr) 1.5rem 3.5rem 4rem 5.5rem 4.5rem";

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
              <span>{t("Etsy verisi (Google değil). Etsy API'sinden 20 ilanlık örnek; sitedeki ilk sayfa değildir.", "Etsy data (not Google). A 20-listing sample from the Etsy API; not the site's first page.")}</span>
              <HelpTip>
                {t(
                  "Etsy'nin API'si yalnızca kendi skor sırasını verir; bu sıra sitedeki 'Most relevant' sıralamasından çok farklıdır (sitede yorumu, satışı ve reklamı olan ilanlar öndedir, API'de yeni ve favorisi az ilanlar öne çıkar). Bu yüzden buradaki 20 ilan alıcının gördüğü ilk sayfa değil, bir örnektir ve rekabet gücü hükmü verilmez. Güvenilir olan: toplam ilan sayısı. Örnekten fiyat bandı, rakip etiketleri ve yeni giriş payı fikir verir. 10+ favorili ilan: örnekte kaç ilanın 10 ve üzeri favorisi var. Gerçek sayfayı görmek için alttaki 'Etsy'de aç' bağlantısını kullan (konumuna ve hesabına göre değişir, reklam içerir). Veriler saklanmaz, bir saat önbellekte kalır.",
                  "Etsy's API only offers its own score order, which differs a lot from the site's 'Most relevant' ranking (on the site, listings with reviews, sales and ads lead; in the API, new listings with few favorites surface). So these 20 listings are a sample, not the first page a buyer sees, and no competition-strength verdict is given. What is reliable: the total listing count. The sample gives an idea of the price range, competitors' tags and the new-entry share. 10+ favorites: how many listings in the sample have 10 or more favorites. To see the real page use the 'Open on Etsy' link below (it varies with your location and account and includes ads). Data is not stored; it is cached for an hour.",
                )}
              </HelpTip>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t("Etsy'de ilan", "Etsy listings")}>{a.total.toLocaleString(locale)}</Stat>
              <Stat label={t("10+ favorili ilan", "10+ favorites")} hint={t("Örnekteki 20 ilandan kaçının 10 ve üzeri favorisi var", "How many of the 20 sampled listings have 10 or more favorites")}>
                <span className="flex items-center gap-2">
                  {a.proven}
                  <span className="text-sm font-normal text-neutral-400">/ {a.sample}</span>
                </span>
              </Stat>
              <Stat label={t("Fiyat bandı (örnek)", "Price range (sample)")} hint={t("Örnekteki 20 ilanın alt çeyrek – medyan – üst çeyrek fiyatı", "Lower quartile – median – upper quartile of the 20 sampled listings")}>
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
                <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("Örnekteki ilanların en sık etiketleri (20 ilanın kaçında)", "Most used tags in the sample (in how many of the 20 listings)")}</h3>
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
              <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("Örnek ilanlar (Etsy API sırası)", "Sample listings (Etsy API order)")}</h3>
              <div className="max-h-80 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
                <div className="min-w-[34rem]">
                  <div
                    className="sticky top-0 z-10 grid items-center gap-x-3 border-b border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
                    style={{ gridTemplateColumns: LIST_COLUMNS }}
                  >
                    <span className="text-right">#</span>
                    <span aria-hidden />
                    <span>{t("İlan", "Listing")}</span>
                    <span aria-hidden />
                    <span className="text-right">{t("Fiyat", "Price")}</span>
                    <span className="text-right" title={t("İlanın aldığı favori sayısı", "Number of favorites the listing has")}>{t("Favori", "Favorites")}</span>
                    <span className="text-right" title={t("İlanın toplam görüntülenme sayısı", "Total views of the listing")}>{t("Görüntülenme", "Views")}</span>
                    <span className="text-right" title={t("İlanın kaç gün/ay önce açıldığı", "How long ago the listing was created")}>{t("İlan yaşı", "Age")}</span>
                  </div>
                  <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {a.listings.map((l, i) => (
                      <li key={l.listing_id ?? i} className="grid items-center gap-x-3 px-3 py-2 text-sm" style={{ gridTemplateColumns: LIST_COLUMNS }}>
                        <span className="text-right text-xs tabular-nums text-neutral-400">{i + 1}</span>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="h-11 w-14 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800" tabIndex={-1} aria-hidden>
                          {l.image && (
                            // eslint-disable-next-line @next/next/no-img-element -- Etsy'nin küçük resmi, olduğu gibi gösterilir (indirilmez, saklanmaz)
                            <img src={l.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                          )}
                        </a>
                        <span className="truncate text-neutral-900 dark:text-neutral-100" title={l.title}>
                          {l.title}
                        </span>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t(`${l.title}: Etsy'de aç`, `${l.title}: open on Etsy`)}
                          title={t("Etsy'de aç", "Open on Etsy")}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                        >
                          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M11 3h6v6M17 3l-8 8M8 5H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4" />
                          </svg>
                        </a>
                        <span className="whitespace-nowrap text-right text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
                          {l.price === null ? "—" : l.price.toLocaleString(locale, { style: "currency", currency: l.currency ?? a.currency ?? "USD", maximumFractionDigits: 0 })}
                        </span>
                        <span className={`whitespace-nowrap text-right text-xs tabular-nums ${l.favorites >= 10 ? "font-medium text-green-600 dark:text-green-400" : "text-neutral-500 dark:text-neutral-400"}`}>
                          {l.favorites.toLocaleString(locale)}
                        </span>
                        <span className="whitespace-nowrap text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{l.views.toLocaleString(locale)}</span>
                        <span className="whitespace-nowrap text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          {l.age_days < 60 ? `${l.age_days} ${t("gün", "days")}` : `${Math.round(l.age_days / 30)} ${t("ay", "mo")}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <a href={`https://www.etsy.com/search?q=${encodeURIComponent(term)}`} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-[#C6613F] hover:underline dark:text-[#D97757]">
              {t("Gerçek sayfayı Etsy'de aç ↗", "Open the real page on Etsy ↗")}
            </a>
          </>
        )}
      </div>
    </Modal>
  );
}

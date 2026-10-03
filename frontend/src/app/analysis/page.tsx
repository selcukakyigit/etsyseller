"use client";

import Link from "next/link";
import { useEffect } from "react";
import { api, ShopProfile } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import AttentionTile from "@/components/dashboard/AttentionTile";
import ChangesTile from "@/components/dashboard/ChangesTile";
import { card, Change, StatTile, useDashboardData } from "@/components/dashboard/stats";
import { useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";
import { PageSpinner } from "@/components/ui/Spinner";

/** Analiz: mağazanın durumu tek yerde (bu ay, mağaza puanı, dikkat isteyen listing'ler, değişikliklerin sonuçları).
 * Ayrıntılar kendi sayfalarında: sayılar Finans'a, puan Yorumlar'a, listing'ler editöre bağlanır. */
export default function AnalysisPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t, locale } = useT();
  const shopId = activeShop?.id;
  const { data, error } = useDashboardData(shopId);
  const [profile, setProfile] = useCached<ShopProfile | null>(shopId !== undefined ? `profile:${shopId}` : null);

  // Mağaza profili yerelden okunur (jobs/shop_profile.py tazeler); sayfa açılışında Etsy'ye istek atılmaz.
  useEffect(() => {
    if (shopId === undefined) return;
    api.shops.profile(shopId).then(setProfile).catch(() => setProfile(null));
  }, [shopId, setProfile]);

  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: data?.currency ?? "USD", maximumFractionDigits: 0 }).format(n);
  const m = data?.month;

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/analysis">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="min-h-[20px]">{!user && !bootError && <PageSpinner />}</div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("Analiz", "Analysis")}</h1>
        {(bootError || error) && <p className="text-sm text-red-600 dark:text-red-400">{bootError ?? error}</p>}

        {shopId !== undefined && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                href="/finance"
                label={`${t("Bu ay satış", "Sales this month")}${m ? ` (${m.label})` : ""}`}
                value={m ? money(m.sales) : "—"}
                sub={m && <Change t={t} cur={m.sales} prev={m.prev_sales} label={t("geçen yıla göre", "vs last year")} />}
              />
              <StatTile
                href="/finance"
                label={m && !m.costs_entered ? t("Brüt kâr", "Gross profit") : t("Net kâr", "Net profit")}
                value={m ? <span className={m.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>{money(m.profit)}</span> : "—"}
                sub={
                  m &&
                  (m.costs_entered ? (
                    <Change t={t} cur={m.profit} prev={m.prev_profit} label={t("geçen yıla göre", "vs last year")} />
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">{t("Ürün maliyetleri girilmemiş", "Product costs not entered")}</span>
                  ))
                }
              />
              <StatTile
                href="/finance"
                label={t("Siparişler", "Orders")}
                value={m ? m.orders : "—"}
                sub={m && t(`Etsy ücretleri ${money(m.fees)}`, `Etsy fees ${money(m.fees)}`)}
              />
              <StatTile
                href="/reviews"
                label={t("Mağaza puanı", "Shop rating")}
                value={
                  <span className="flex items-center gap-2">
                    {activeShop?.icon_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={activeShop.icon_url} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                    )}
                    {profile?.review_average != null ? `★ ${profile.review_average.toFixed(1)}` : "—"}
                  </span>
                }
                sub={
                  profile?.is_vacation ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">{t("Tatil modunda", "Vacation mode")}</span>
                  ) : (
                    t(`${profile?.review_count ?? 0} yorum`, `${profile?.review_count ?? 0} reviews`)
                  )
                }
              />
            </div>

            {/* Yapılacak işler: boşsa kartlar kendini gizler. */}
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <AttentionTile shopId={shopId} className={card} />
              <ChangesTile shopId={shopId} className={card} />
            </div>

            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t("Ayrıntılı satış, kâr ve ücret dökümü için ", "For a detailed breakdown of sales, profit and fees see ")}
              <Link href="/finance" className="font-medium text-[#B4553A] underline-offset-2 hover:underline dark:text-[#E89A7F]">
                {t("Finans", "Finance")}
              </Link>
              {t("; bir listing'in neden düştüğünü Ulagg'a da sorabilirsin.", "; you can also ask Ulagg why a listing is declining.")}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

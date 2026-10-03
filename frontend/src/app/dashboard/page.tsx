"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, DashboardData, ShopProfile } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import ChatPanel from "@/components/assistant/ChatPanel";
import AttentionTile from "@/components/dashboard/AttentionTile";
import ChangesTile from "@/components/dashboard/ChangesTile";
import { T, useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";
import { PageSpinner } from "@/components/ui/Spinner";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const tile = "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";
const strip = "block rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900";
const link = "transition hover:border-[#D97757] dark:hover:border-[#D97757]";
const label = "text-xs font-medium text-neutral-500 dark:text-neutral-400";
const value = "text-xl font-semibold text-neutral-900 dark:text-neutral-100";
const sub = "truncate text-xs text-neutral-500 dark:text-neutral-400";

function Change({ cur, prev, label, t }: { cur: number; prev: number; label: string; t: T }) {
  if (!prev) return <span className="text-[11px] text-neutral-400">{label}: {t("veri yok", "no data")}</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return (
    <span className={`text-[11px] font-medium ${pct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
      {pct >= 0 ? "▲" : "▼"} %{Math.abs(pct).toFixed(0)} <span className="font-normal text-neutral-400">{label}</span>
    </span>
  );
}

export default function DashboardPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t, locale } = useT();
  const shopId = activeShop?.id;
  const [data, setData] = useCached<DashboardData>(shopId !== undefined ? `dashboard:${shopId}:${localToday()}` : null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useCached<ShopProfile | null>(shopId !== undefined ? `profile:${shopId}` : null);

  const load = useCallback(() => {
    if (shopId === undefined) return;
    api.assistant
      .dashboard(shopId, localToday())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [shopId, setData]);

  useEffect(() => {
    load();
  }, [load]);

  // Mağaza profili yerelden okunuyor (jobs/shop_profile.py tazeler) —
  // her dashboard açılışında Etsy'ye istek atmaz.
  useEffect(() => {
    if (shopId === undefined) return;
    api.shops.profile(shopId).then(setProfile).catch(() => setProfile(null));
  }, [shopId, setProfile]);

  const money = (n: number, digits = 0) => new Intl.NumberFormat(locale, { style: "currency", currency: data?.currency ?? "USD", maximumFractionDigits: digits }).format(n);

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/dashboard">
      <div className="mx-auto max-w-[96rem] px-4 py-4 sm:px-6 sm:py-6">
        <div className="min-h-[20px]">
          {!user && !bootError && <PageSpinner />}
        </div>
        {(bootError || error) && <p className="mb-4 text-sm text-red-600">{bootError ?? error}</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-4 text-neutral-600 dark:text-neutral-300">
              {t("Ulagg'ı kullanmak için önce Etsy mağazanı bağlaman gerekiyor.", "Connect your Etsy shop to start using Ulagg.")}
            </p>
            <a href={api.shops.connectUrl()} className="inline-block rounded-lg bg-[#D97757] px-4 py-2 text-sm font-medium text-white hover:bg-[#C6613F]">
              {t("Etsy'ye Bağlan", "Connect Etsy")}
            </a>
          </div>
        )}

        {shopId !== undefined && (
          <div className="space-y-4">
            {/* Sayılar tek şeritte: tıklanınca ilgili sayfaya gider. Mobilde 2×2. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className={strip}>
                <div className={label}>{t("Bugün", "Today")}</div>
                <div className={value}>{data ? money(data.today.sales) : "—"}</div>
                <div className={sub}>{data ? t(`${data.today.orders} sipariş`, `${data.today.orders} orders`) : ""}</div>
              </div>

              <Link href="/orders" className={`${strip} ${link}`}>
                <div className={label}>{t("Gönderilecek", "To ship")}</div>
                <div className={value}>{data ? data.to_ship : "—"}</div>
                {data && data.overdue > 0 ? (
                  <div className="text-xs font-medium text-red-600 dark:text-red-400">{t(`${data.overdue} gecikmiş`, `${data.overdue} overdue`)}</div>
                ) : (
                  <div className={sub}>{t("gecikmiş yok", "none overdue")}</div>
                )}
              </Link>

              <Link href="/finance" className={`${strip} ${link}`}>
                <div className={label}>
                  {t("Bu ay", "This month")} {data ? `(${data.month.label})` : ""}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={value}>{data ? money(data.month.sales) : "—"}</span>
                  {data && <Change t={t} cur={data.month.sales} prev={data.month.prev_sales} label={t("geçen yıla göre", "vs last year")} />}
                </div>
                {data && (
                  <div className={sub} title={data.month.costs_entered ? undefined : t("Ürün maliyetleri girilmediği için bu brüt kârdır.", "Product costs are not entered, so this is gross profit.")}>
                    {data.month.costs_entered ? t("Net kâr", "Net profit") : t("Brüt kâr", "Gross profit")}{" "}
                    <b className={data.month.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>{money(data.month.profit)}</b>
                  </div>
                )}
              </Link>

              <Link href="/reviews" className={`${strip} ${link}`}>
                <div className={label}>{t("Mağaza", "Shop")}</div>
                <div className="flex items-center gap-2">
                  {activeShop?.icon_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activeShop.icon_url} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                  )}
                  <span className={value}>{profile?.review_average != null ? `★ ${profile.review_average.toFixed(1)}` : "—"}</span>
                </div>
                <div className={sub}>
                  {profile?.is_vacation ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">{t("Tatil modunda", "Vacation mode")}</span>
                  ) : (
                    t(`${profile?.review_count ?? 0} yorum`, `${profile?.review_count ?? 0} reviews`)
                  )}
                </div>
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <ChatPanel shopId={shopId} onSent={load} heightClass="h-[70vh] min-h-[28rem] lg:h-[calc(100vh-16rem)]" />

              {/* Sağ sütun yalnızca yapılacak işler; boşsa kartlar kendini gizler. */}
              <aside className="space-y-3">
                <AttentionTile shopId={shopId} className={tile} />
                <ChangesTile shopId={shopId} className={tile} />
                <p className="px-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {t(
                    "Ulagg Etsy'ye kendiliğinden bir şey göndermez. Oluşturduğu listing taslağını açıp kontrol ettikten sonra \"Etsy'de yayınla\" ile sen yayınlarsın.",
                    "Ulagg never sends anything to Etsy by itself. Open the listing draft it creates, check it, then publish it yourself with \"Publish to Etsy\".",
                  )}
                </p>
              </aside>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

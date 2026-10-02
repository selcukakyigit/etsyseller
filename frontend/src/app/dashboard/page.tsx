"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, DashboardData, ShopProfile, ShopReview } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import ChatPanel from "@/components/assistant/ChatPanel";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const tile = "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";

function Change({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  if (!prev) return <span className="text-[11px] text-neutral-400">{label}: veri yok</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return (
    <span className={`text-[11px] font-medium ${pct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
      {pct >= 0 ? "▲" : "▼"} %{Math.abs(pct).toFixed(0)} <span className="font-normal text-neutral-400">{label}</span>
    </span>
  );
}

export default function DashboardPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const shopId = activeShop?.id;
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [reviews, setReviews] = useState<ShopReview[] | null>(null);

  const load = useCallback(() => {
    if (shopId === undefined) return;
    api.assistant
      .dashboard(shopId, localToday())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  // Mağaza profili/yorumları yerelden okunuyor (jobs/shop_profile.py, jobs/reviews.py günlük tazeler) —
  // her dashboard açılışında Etsy'ye istek atmaz.
  useEffect(() => {
    if (shopId === undefined) return;
    api.shops.profile(shopId).then(setProfile).catch(() => setProfile(null));
    api.shops
      .reviews(shopId, { limit: 3 })
      .then((r) => setReviews(r.reviews))
      .catch(() => setReviews([]));
  }, [shopId]);

  const money = (n: number, digits = 0) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: data?.currency ?? "USD", maximumFractionDigits: digits }).format(n);
  const now = new Date();
  const lastYear = String(now.getFullYear() - 1);

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/dashboard">
      <div className="mx-auto max-w-[96rem] px-6 py-6">
        <div className="min-h-[20px]">
          {!user && !bootError && <p className="text-sm text-neutral-400">Yükleniyor…</p>}
        </div>
        {(bootError || error) && <p className="mb-4 text-sm text-red-600">{bootError ?? error}</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-4 text-neutral-600 dark:text-neutral-300">Asistanı kullanmak için önce Etsy mağazanı bağlaman gerekiyor.</p>
            <a href={api.shops.connectUrl()} className="inline-block rounded-lg bg-[#D97757] px-4 py-2 text-sm font-medium text-white hover:bg-[#C6613F]">
              Etsy&apos;ye Bağlan
            </a>
          </div>
        )}

        {shopId !== undefined && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <ChatPanel shopId={shopId} onSent={load} />

            <aside className="space-y-3">
              {(activeShop?.icon_url || profile) && (
                <Link href="/reviews" className={`${tile} block hover:border-[#D97757]`}>
                  <div className="flex items-center gap-2.5">
                    {activeShop?.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={activeShop.icon_url} alt="" className="h-9 w-9 flex-shrink-0 rounded-full object-cover" />
                    ) : (
                      <div className="h-9 w-9 flex-shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{activeShop?.shop_name}</div>
                      {profile?.review_average != null && (
                        <div className="text-xs text-neutral-500">
                          ⭐ {profile.review_average.toFixed(1)} · {profile.review_count ?? 0} yorum
                        </div>
                      )}
                    </div>
                  </div>
                  {profile?.num_favorers != null && (
                    <div className="mt-2 text-xs text-neutral-500">{profile.num_favorers} kişi mağazayı favoriledi</div>
                  )}
                  {profile?.is_vacation && (
                    <div className="mt-1 text-xs font-medium text-amber-600">Mağaza tatil modunda</div>
                  )}
                  {reviews && reviews.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                      {reviews.map((r) => (
                        <div key={r.transaction_id}>
                          <div className="text-xs text-amber-500">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                          {r.review && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-300">{r.review}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </Link>
              )}

              <div className={tile}>
                <div className="text-xs font-medium text-neutral-500">Bugün</div>
                <div className="mt-1 text-2xl font-semibold">{data ? money(data.today.sales) : "—"}</div>
                <div className="text-xs text-neutral-500">{data ? `${data.today.orders} sipariş` : ""}</div>
              </div>

              <Link href="/orders" className={`${tile} block hover:border-[#D97757]`}>
                <div className="text-xs font-medium text-neutral-500">Gönderilecek siparişler</div>
                <div className="mt-1 text-2xl font-semibold">{data ? data.to_ship : "—"}</div>
                {data && data.overdue > 0 ? <div className="text-xs font-medium text-red-600">{data.overdue} tanesi gecikmiş</div> : <div className="text-xs text-neutral-500">gecikmiş yok</div>}
              </Link>

              <Link href="/finance" className={`${tile} block hover:border-[#D97757]`}>
                <div className="text-xs font-medium text-neutral-500">Bu ay ({data?.month.label ?? "…"})</div>
                <div className="mt-1 text-2xl font-semibold">{data ? money(data.month.sales) : "—"}</div>
                {data && <Change cur={data.month.sales} prev={data.month.prev_sales} label={`${lastYear} aynı dönem`} />}
                <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                  <div className="text-xs text-neutral-500">Net kâr</div>
                  <div className={`text-xl font-semibold ${data && data.month.profit < 0 ? "text-red-600" : "text-emerald-600"}`}>{data ? money(data.month.profit) : "—"}</div>
                  {data && <Change cur={data.month.profit} prev={data.month.prev_profit} label={`${lastYear} aynı dönem`} />}
                  {data && !data.month.costs_entered && <div className="mt-1 text-[11px] text-amber-600">Ürün maliyetleri girilmediği için bu brüt kârdır.</div>}
                </div>
                <div className="mt-3 text-xs text-neutral-500">
                  {data ? `${data.month.orders} sipariş · Etsy ücretleri ${money(data.month.fees)}` : ""}
                </div>
              </Link>

              <div className={`${tile} text-xs text-neutral-500`}>
                <b className="text-neutral-700 dark:text-neutral-200">İpucu:</b> Asistan Etsy&apos;ye kendiliğinden bir şey göndermez. Oluşturduğu listing taslağını açıp kontrol ettikten sonra &quot;Etsy&apos;de yayınla&quot; ile sen yayınlarsın.
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

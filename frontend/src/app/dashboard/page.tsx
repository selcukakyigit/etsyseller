"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, DashboardData } from "@/lib/api";
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

  const money = (n: number, digits = 0) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: data?.currency ?? "USD", maximumFractionDigits: digits }).format(n);
  const now = new Date();
  const lastYear = String(now.getFullYear() - 1);

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/dashboard">
      <div className="mx-auto max-w-[96rem] px-6 py-6">
        {!user && !bootError && <p className="text-sm text-neutral-400">Yükleniyor…</p>}
        {(bootError || error) && <p className="mb-4 text-sm text-red-600">{bootError ?? error}</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-4 text-neutral-600 dark:text-neutral-300">Asistanı kullanmak için önce Etsy mağazanı bağlaman gerekiyor.</p>
            <a href={api.shops.connectUrl()} className="inline-block rounded-lg bg-[#F1641E] px-4 py-2 text-sm font-medium text-white hover:bg-[#d9560f]">
              Etsy&apos;ye Bağlan
            </a>
          </div>
        )}

        {shopId !== undefined && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <ChatPanel shopId={shopId} onSent={load} />

            <aside className="space-y-3">
              <div className={tile}>
                <div className="text-xs font-medium text-neutral-500">Bugün</div>
                <div className="mt-1 text-2xl font-semibold">{data ? money(data.today.sales) : "—"}</div>
                <div className="text-xs text-neutral-500">{data ? `${data.today.orders} sipariş` : ""}</div>
              </div>

              <Link href="/orders" className={`${tile} block hover:border-[#F1641E]`}>
                <div className="text-xs font-medium text-neutral-500">Gönderilecek siparişler</div>
                <div className="mt-1 text-2xl font-semibold">{data ? data.to_ship : "—"}</div>
                {data && data.overdue > 0 ? <div className="text-xs font-medium text-red-600">{data.overdue} tanesi gecikmiş</div> : <div className="text-xs text-neutral-500">gecikmiş yok</div>}
              </Link>

              <Link href="/finance" className={`${tile} block hover:border-[#F1641E]`}>
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

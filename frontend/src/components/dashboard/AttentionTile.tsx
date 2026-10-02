"use client";

import Link from "next/link";
import { useEffect } from "react";
import { api, ShopAttention } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { Spinner } from "@/components/ui/Spinner";

/** Dashboard: "Dikkat isteyen listing'ler" — en çok satış kaybeden 5 listing, tek satır teşhisle. Kendi başına yüklenir,
 * sayfanın geri kalanını bekletmez. Düşen listing yoksa görünmez. */
export default function AttentionTile({ shopId, className }: { shopId: number; className: string }) {
  const { t } = useT();
  const [data, setData] = useCached<ShopAttention>(`attention:${shopId}`);

  useEffect(() => {
    let cancelled = false;
    api.insights
      .attention(shopId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch(() => undefined); // yardımcı kart; yüklenemezse Dashboard etkilenmez
    return () => {
      cancelled = true;
    };
  }, [shopId, setData]);

  if (data && data.items.length === 0) return null;
  const season = data?.items.find((i) => i.season.advice === "prepare" || i.season.advice === "in_peak")?.season;

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-xs font-medium text-neutral-500">
        <span>{t("Dikkat isteyen listing'ler", "Listings that need attention")}</span>
        {data && <span>{t(`${data.declining_count} düşüşte`, `${data.declining_count} declining`)}</span>}
      </div>
      {!data ? (
        <div className="flex justify-center py-4">
          <Spinner size={18} />
        </div>
      ) : (
        <>
          {season && <p className="mt-2 rounded-lg bg-[#D97757]/10 px-2 py-1.5 text-[11px] text-[#B4553A] dark:text-[#E89A7F]">{season.text}</p>}
          <ul className="mt-2 space-y-2">
            {data.items.map((i) => (
              <li key={i.listing_id}>
                <Link href={`/listings/${i.listing_id}/edit`} className="group block">
                  <div className="truncate text-sm font-medium text-neutral-900 group-hover:text-[#B4553A] dark:text-neutral-100 dark:group-hover:text-[#E89A7F]">{i.title}</div>
                  <div className="text-xs text-red-600 dark:text-red-400">{i.headline}</div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
            {t("Listing'ler sayfasında \"Düşüşte\" filtresiyle hepsini görebilir, Analiz panelinden ayrıntıya bakabilirsin.", "See them all with the \"Declining\" filter on the Listings page; open Analysis for details.")}
          </p>
        </>
      )}
    </div>
  );
}

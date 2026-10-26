"use client";

import { useEffect, useState } from "react";
import HelpTip from "@/components/ui/HelpTip";
import { useT } from "@/lib/i18n-client";
import { DiscoverAllowance, discoverApi } from "@/lib/discoverApi";

/** Arama kutusunun altında: bu ay kalan YENİ kelime araştırması hakkı. Daha önce araştırılmış kelimeler sınırsızdır ve hak harcamaz.
 * `refreshKey` değişince (yeni arama yapıldı/bitti) sayı yeniden okunur. */
export default function AllowanceNote({ shopId, refreshKey }: { shopId: number; refreshKey: string }) {
  const { t } = useT();
  const [a, setA] = useState<DiscoverAllowance | null>(null);

  useEffect(() => {
    let off = false;
    discoverApi
      .allowance(shopId)
      .then((r) => {
        if (!off) setA(r);
      })
      .catch(() => {}); // gösterge yardımcıdır: okunamazsa sessizce gizlenir
    return () => {
      off = true;
    };
  }, [shopId, refreshKey]);

  if (!a) return null;
  const monthLeft = Math.max(0, a.month_limit - a.month_used);
  const dayDone = monthLeft > 0 && a.remaining === 0;
  const out = a.remaining === 0;
  return (
    <p className={`flex flex-wrap items-center gap-1.5 text-xs ${out ? "text-amber-700 dark:text-amber-400" : "text-neutral-500 dark:text-neutral-400"}`}>
      <span>
        {t(`Bu ay kalan yeni kelime araştırması: ${monthLeft} / ${a.month_limit}`, `New keyword searches left this month: ${monthLeft} / ${a.month_limit}`)}
        {dayDone && ` · ${t("bugünlük bitti, yarın devam", "done for today, continue tomorrow")}`}
      </span>
      <HelpTip>
        {t(
          "Hak yalnızca daha önce araştırılmamış YENİ kelimelerde harcanır. Havuzda hazır olan kelimeleri istediğin kadar arayabilirsin; aynı kelimeyi tekrar aramak da hak harcamaz. Hak her ay yenilenir; tek günde çok araştırma yapılmaması için günlük bir üst sınır da vardır.",
          "The allowance is only used for NEW keywords nobody has researched yet. You can search keywords that are already ready as often as you like, and searching the same keyword again does not use it. It renews every month; there is also a daily ceiling so it cannot all go in one day.",
        )}
      </HelpTip>
    </p>
  );
}

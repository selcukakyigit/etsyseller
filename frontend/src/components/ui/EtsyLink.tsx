"use client";

import { useT } from "@/lib/i18n-client";

/** Etsy API şartı: ürün bilgisi ya da görseli gösterilen yerde Etsy'deki ilana doğrudan bağlantı verilir.
 *  Henüz Etsy'de olmayan (negatif id) listing'de hiçbir şey göstermez. */
export default function EtsyLink({ listingId, long = false, className = "" }: { listingId: number; long?: boolean; className?: string }) {
  const { t } = useT();
  if (!(listingId > 0)) return null;
  return (
    <a
      href={`https://www.etsy.com/listing/${listingId}`}
      target="_blank"
      rel="noreferrer"
      title={t("Etsy'de görüntüle", "View on Etsy")}
      onClick={(e) => e.stopPropagation()}
      className={`whitespace-nowrap text-neutral-400 underline-offset-2 hover:text-[#D97757] hover:underline dark:text-neutral-500 dark:hover:text-[#D97757] ${className}`}
    >
      {long ? t("Etsy'de görüntüle ↗", "View on Etsy ↗") : "Etsy ↗"}
    </a>
  );
}

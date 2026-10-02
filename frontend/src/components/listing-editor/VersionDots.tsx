"use client";

import { useEffect, useState } from "react";
import { api, ImageVersion, ListingImage } from "@/lib/api";

/** Fotoğrafın sürüm geçmişi — orijinal Etsy fotoğrafı + üretilen her AI sürümü, eskiden yeniye küçük
 * noktalar olarak sağ altta. Turuncu = şu an gösterilen sürüm. Hiçbir sürüm silinmediği için (bkz.
 * listings/drafts.py list_versions) her zaman tama geçmiş görünür, geriye/ileriye dönmek serbest. */
export default function VersionDots({
  shopId,
  listingId,
  img,
  refreshToken,
  onSelect,
}: {
  shopId: number;
  listingId: number;
  img: ListingImage;
  /** Yeni bir sürüm üretildiğinde listeyi tazelemek için değiştirilen herhangi bir değer. */
  refreshToken?: unknown;
  onSelect: (version: ImageVersion) => void;
}) {
  const [versions, setVersions] = useState<ImageVersion[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.listings
      .imageVersions(shopId, listingId, img.listing_image_id, img.draft_file_id ?? undefined)
      .then((r) => {
        if (!cancelled) setVersions(r.versions);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, listingId, img.listing_image_id, img.draft_file_id, refreshToken]);

  if (versions.length < 2) return null;

  const isCurrent = (v: ImageVersion) =>
    img.draft_file_id ? v.file_id === img.draft_file_id : v.file_id === null && v.listing_image_id === img.listing_image_id;

  return (
    <div className="pointer-events-none absolute bottom-2 right-2 flex gap-1.5 rounded-full bg-black/40 px-2 py-1.5 backdrop-blur-sm">
      {versions.map((v, i) => (
        <button
          key={v.file_id ?? `orig-${v.listing_image_id}`}
          type="button"
          title={v.created_at ? new Date(v.created_at).toLocaleString("tr-TR") : "Orijinal"}
          onClick={() => !isCurrent(v) && onSelect(v)}
          className={`pointer-events-auto h-2.5 w-2.5 rounded-full transition ${
            isCurrent(v) ? "bg-[#D97757]" : "bg-white/50 hover:bg-white/80"
          }`}
          aria-label={i === 0 ? "Orijinal fotoğraf" : `Sürüm ${i + 1}`}
        />
      ))}
    </div>
  );
}

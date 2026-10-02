"use client";

import { tNow as t } from "@/lib/i18n";

const STATE_LABELS: Record<string, [string, string]> = {
  active: ["Aktif", "Active"],
  inactive: ["Pasif", "Inactive"],
  draft: ["Taslak", "Draft"],
  sold_out: ["Tükenmiş", "Sold out"],
  expired: ["Süresi dolmuş", "Expired"],
  removed: ["Kaldırılmış", "Removed"],
};

const TYPE_LABELS: Record<string, [string, string]> = {
  physical: ["Fiziksel ürün", "Physical item"],
  download: ["Dijital ürün", "Digital item"],
  both: ["Fiziksel + dijital", "Physical + digital"],
};

const date = (ts?: number | null) =>
  ts ? new Date(ts * 1000).toLocaleDateString(t("tr-TR", "en-US"), { day: "numeric", month: "short", year: "numeric" }) : null;

/**
 * Listing'in durumu, türü ve tarihleri (Etsy editörünün başlığındaki "Active · Listed on … · View on Etsy").
 * Durum yalnızca Aktif/Pasif arasında değiştirilebilir (Etsy'nin API'si yalnızca bunlara izin verir).
 */
export default function ListingStatusBar({
  state,
  liveState,
  listingType,
  url,
  listedAt,
  endsAt,
  onStateChange,
  isNew,
}: {
  state?: string | null;
  /** Etsy'deki güncel durum; değiştirilebilir olup olmadığını belirler. */
  liveState?: string | null;
  listingType?: string | null;
  url?: string | null;
  listedAt?: number | null;
  endsAt?: number | null;
  onStateChange: (state: "active" | "inactive" | "draft") => void;
  /** Henüz Etsy'de olmayan yeni listing: Taslak (ücretsiz) ya da Aktif (yayınla) seçilir. */
  isNew?: boolean;
}) {
  const current = state ?? liveState ?? null;
  const editable = liveState === "active" || liveState === "inactive";
  const listed = date(listedAt);
  const ends = date(endsAt);

  if (isNew) {
    const cur = state === "active" ? "active" : "draft";
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
          {t("Yeni listing · henüz Etsy'de yok", "New listing · not on Etsy yet")}
        </span>
        <label className="flex items-center gap-2 text-neutral-700 dark:text-neutral-200">
          {t("Yayınlayınca", "On publish")}
          <select
            value={cur}
            onChange={(e) => onStateChange(e.target.value as "active" | "draft")}
            className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="draft">{t("Etsy'de taslak olarak oluştur (ücretsiz)", "Create as a draft on Etsy (free)")}</option>
            <option value="active">{t("Oluştur ve aktif et (0,20 $ listing ücreti)", "Create and activate ($0.20 listing fee)")}</option>
          </select>
        </label>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      {current && editable ? (
        <label className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
          {t("Durum", "Status")}
          <select
            value={current}
            onChange={(e) => onStateChange(e.target.value as "active" | "inactive")}
            className={`rounded-lg border px-2 py-1 text-sm font-medium outline-none ${
              current === "active"
                ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300"
                : "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            <option value="active">{t("Aktif", "Active")}</option>
            <option value="inactive">{t("Pasif", "Inactive")}</option>
          </select>
        </label>
      ) : (
        current && (
          <span
            title={t("Bu durum Etsy'de değiştirilebilir değil", "This status cannot be changed via Etsy's API")}
            className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            {STATE_LABELS[current] ? t(...STATE_LABELS[current]) : current}
          </span>
        )
      )}

      {listingType && (
        <span className="text-neutral-600 dark:text-neutral-300">{TYPE_LABELS[listingType] ? t(...TYPE_LABELS[listingType]) : listingType}</span>
      )}
      {listed && <span className="text-neutral-500 dark:text-neutral-400">{t("Listelenme", "Listed")}: {listed}</span>}
      {ends && <span className="text-neutral-500 dark:text-neutral-400">{t("Bitiş", "Expires")}: {ends}</span>}

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto font-medium text-neutral-800 underline-offset-2 hover:underline dark:text-neutral-100"
        >
          {t("Etsy'de görüntüle ↗", "View on Etsy ↗")}
        </a>
      )}
    </div>
  );
}

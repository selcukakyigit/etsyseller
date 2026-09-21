"use client";

const STATE_LABELS: Record<string, string> = {
  active: "Aktif",
  inactive: "Pasif",
  draft: "Taslak",
  sold_out: "Tükenmiş",
  expired: "Süresi dolmuş",
  removed: "Kaldırılmış",
};

const TYPE_LABELS: Record<string, string> = {
  physical: "Fiziksel ürün",
  download: "Dijital ürün",
  both: "Fiziksel + dijital",
};

const date = (ts?: number | null) =>
  ts ? new Date(ts * 1000).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }) : null;

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
          Yeni listing · henüz Etsy&apos;de yok
        </span>
        <label className="flex items-center gap-2 text-neutral-700 dark:text-neutral-200">
          Yayınlayınca
          <select
            value={cur}
            onChange={(e) => onStateChange(e.target.value as "active" | "draft")}
            className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="draft">Etsy&apos;de taslak olarak oluştur (ücretsiz)</option>
            <option value="active">Oluştur ve aktif et (0,20 $ listing ücreti)</option>
          </select>
        </label>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      {current && editable ? (
        <label className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
          Durum
          <select
            value={current}
            onChange={(e) => onStateChange(e.target.value as "active" | "inactive")}
            className={`rounded-lg border px-2 py-1 text-sm font-medium outline-none ${
              current === "active"
                ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300"
                : "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            <option value="active">Aktif</option>
            <option value="inactive">Pasif</option>
          </select>
        </label>
      ) : (
        current && (
          <span
            title="Bu durum Etsy'de değiştirilebilir değil"
            className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            {STATE_LABELS[current] ?? current}
          </span>
        )
      )}

      {listingType && (
        <span className="text-neutral-600 dark:text-neutral-300">{TYPE_LABELS[listingType] ?? listingType}</span>
      )}
      {listed && <span className="text-neutral-500 dark:text-neutral-400">Listelenme: {listed}</span>}
      {ends && <span className="text-neutral-500 dark:text-neutral-400">Bitiş: {ends}</span>}

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto font-medium text-neutral-800 underline-offset-2 hover:underline dark:text-neutral-100"
        >
          Etsy&apos;de görüntüle ↗
        </a>
      )}
    </div>
  );
}

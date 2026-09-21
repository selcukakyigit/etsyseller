"use client";

import { useEffect, useState } from "react";
import { api, ListingHistory } from "@/lib/api";
import TrendChart from "@/components/TrendChart";

const STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  applied: "Uygulandı",
  dismissed: "Reddedildi",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ListingHistoryPanel({
  shopId,
  listingId,
  initialHistory,
}: {
  shopId: number;
  listingId: number;
  /** Preview/test escape hatch: skip the network call and render this directly. */
  initialHistory?: ListingHistory;
}) {
  const [history, setHistory] = useState<ListingHistory | null>(initialHistory ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialHistory) return;
    api.listings
      .history(shopId, listingId)
      .then(setHistory)
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [shopId, listingId, initialHistory]);

  if (error) return <p className="text-sm text-red-600 px-4 py-3">{error}</p>;
  if (!history) return <p className="text-sm text-neutral-400 dark:text-neutral-500 px-4 py-3">Geçmiş yükleniyor…</p>;

  const appliedEvents = history.versions
    .filter((v) => v.status === "applied" && v.applied_at)
    .map((v) => ({ date: v.applied_at as string }));

  return (
    <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TrendChart
          label="Görüntülenme"
          color="views"
          data={history.stats.map((s) => ({ date: s.captured_at, value: s.views }))}
          events={appliedEvents}
        />
        <TrendChart
          label="Favori"
          color="favorites"
          data={history.stats.map((s) => ({ date: s.captured_at, value: s.favorites }))}
          events={appliedEvents}
        />
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500 mb-2">Değişiklik geçmişi</p>
        {history.versions.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Henüz bir öneri üretilmedi.</p>
        ) : (
          <ol className="space-y-2">
            {history.versions.map((v) => (
              <li key={v.id} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                    v.status === "applied"
                      ? "bg-green-50 text-green-600"
                      : v.status === "dismissed"
                        ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
                        : "bg-[#F1641E]/10 text-[#c94f16]"
                  }`}
                >
                  {STATUS_LABEL[v.status] ?? v.status}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-neutral-700 dark:text-neutral-300 truncate">{v.suggested_title}</p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    {formatDateTime(v.created_at)}
                    {v.applied_at && ` · uygulandı: ${formatDateTime(v.applied_at)}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

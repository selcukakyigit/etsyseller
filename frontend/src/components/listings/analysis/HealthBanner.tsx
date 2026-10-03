"use client";

import { useEffect, useState } from "react";
import { api, ListingHealth } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n-client";

const STAGE_LABEL: Record<ListingHealth["stage"], [string, string]> = {
  watching: ["İzleniyor", "Watching"],
  flagged: ["Öneri var", "Has suggestion"],
  stable: ["Stabil", "Stable"],
  kill_candidate: ["Durdurmayı değerlendir", "Consider deactivating"],
  killed: ["Durduruldu", "Deactivated"],
};

const STAGE_STYLE: Record<ListingHealth["stage"], string> = {
  watching: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  flagged: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  stable: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  kill_candidate: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  killed: "bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500",
};

// Not metni backend'de Türkçe saklanır (günlük işte hesaplanır, istek dili yoktur); İngilizce arayüzde aşamaya göre bu metin gösterilir.
const EN_NOTE: Record<string, string> = {
  seo: "Search visibility is weak: daily views are far below the shop median (tags, title or category may be the issue).",
  appeal: "It gets views but few favorites (the main photo or the title may not be attractive enough).",
  conversion: "It gets favorites but few sales (description, price or variations may be in the way).",
  stable: "Performance is close to or above the shop median; no need to change anything.",
  kill_candidate: "Performance is still below the shop median after 3 different change cycles. Consider deactivating this listing.",
};

/** Huni sağlığı (bkz. backend listings/health.py): son yayından bu yana en az 21 gün/100 görüntülenme birikmeden sessiz
 * kalır, sonra mağaza medyanına göre zayıf aşamayı söyler; aynı listing 3 yayına rağmen zayıfsa durdurmayı önerir. */
export default function HealthBanner({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t, locale } = useT();
  const [healthState, setHealthState] = useState<ListingHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();

  useEffect(() => {
    let cancelled = false;
    api.listings
      .health(shopId, listingId)
      .then((h) => {
        if (!cancelled) setHealthState(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shopId, listingId]);

  if (!healthState || healthState.stage === "watching") return null;

  const handleKill = async () => {
    const ok = await confirm({
      title: t("Listing'i durdur", "Deactivate listing"),
      message: t(
        "Bu listing Etsy'de inactive yapılacak (satışa kapanır). İstediğin zaman tekrar active edebilirsin. Devam edilsin mi?",
        "This listing will be set to inactive on Etsy (no longer for sale). You can make it active again at any time. Continue?",
      ),
      confirmLabel: t("Durdur", "Deactivate"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      setHealthState(await api.listings.killListing(shopId, listingId));
    } finally {
      setBusy(false);
    }
  };

  const handleKeepWatching = async () => {
    setBusy(true);
    try {
      setHealthState(await api.listings.keepWatching(shopId, listingId));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {confirmElement}
      <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{t("Huni", "Funnel")}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[healthState.stage]}`}>{t(...STAGE_LABEL[healthState.stage])}</span>
          </span>
          {healthState.stage === "kill_candidate" && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleKeepWatching}
                className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                {t("İzlemeye devam et", "Keep watching")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleKill}
                className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t("Listing'i durdur", "Deactivate listing")}
              </button>
            </div>
          )}
        </div>
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          {locale === "tr"
            ? healthState.note
            : EN_NOTE[healthState.stage === "flagged" ? healthState.bottleneck ?? "" : healthState.stage] ?? ""}
        </p>
      </div>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, ChatCard } from "@/lib/api";
import { ImagePlusIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";
import GeneratingTile from "./GeneratingTile";

type VideoJob = Extract<ChatCard, { type: "video_job" }>;

const POLL_MS = 4000;

function IconButton({ label, onClick, primary, children }: { label: string; onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
        primary
          ? "bg-[#D97757] text-white hover:bg-[#C6613F]"
          : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

/** Sohbette üretilen video: iş sürerken ilerleme, bitince oynatıcı. Durum sunucudan sorulur (iş bileti kartta saklıdır), bu yüzden
 * sayfa değişse bile dönünce kaldığı yerden devam eder; kredi video kaydedilirken bir kez düşülür. */
export default function VideoJobCard({ card, shopId, onAsk }: { card: VideoJob; shopId: number; onAsk?: (text: string) => void }) {
  const { t } = useT();
  const [fileId, setFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false); // dosya listing'e taşınmış olabilir (taslak yayınlanınca listing kimliği değişir)
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (fileId || error) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await api.listings.videoStatus(shopId, card.listing_id, card.job);
        if (!alive) return;
        if (res.status === "done") setFileId(res.file_id);
        else timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (alive) setError(e instanceof Error && e.message ? e.message : t("Video üretilemedi", "Could not generate the video"));
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [fileId, error, shopId, card.listing_id, card.job, t]);

  if (gone) return null;
  const src = fileId ? api.listings.draftFileUrl(shopId, card.listing_id, fileId) : "";

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-emerald-300 bg-white dark:border-emerald-800 dark:bg-neutral-900">
      {!fileId && !error && (
        <div className="p-3">
          <GeneratingTile kind="video" startedAt={card.started_at} />
        </div>
      )}
      {error && <div className="px-3 py-4 text-xs text-red-600 dark:text-red-400">{error}</div>}
      {fileId && !unplayable && (
        <video src={src} controls playsInline preload="metadata" onError={() => setUnplayable(true)} className="max-h-96 w-full bg-black" />
      )}
      {fileId && unplayable && (
        <div className="px-3 py-4 text-xs text-neutral-500">{t("Video listing'e taşınmış olabilir; düzenleyiciden bak.", "The video may have moved to the listing; check the editor.")}</div>
      )}
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className="text-neutral-600 dark:text-neutral-300">
          {fileId ? t(`Video hazır · ${card.credits} kredi`, `Video ready · ${card.credits} credits`) : error ? "" : t("Kredi video hazır olunca düşer", "Credits are charged when the video is ready")}
        </span>
      </div>
      {(fileId || error) && onAsk && (
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
          <IconButton
            label={t("Yeniden üret", "Regenerate")}
            onClick={() => onAsk(t(`Videoyu yeniden üret${card.prompt ? `: ${card.prompt}` : ""} (listing id: ${card.listing_id}, ${card.duration} sn)`, `Regenerate the video${card.prompt ? `: ${card.prompt}` : ""} (listing id: ${card.listing_id}, ${card.duration}s)`))}
          >
            <RefreshIcon className="!h-4 !w-4" />
          </IconButton>
          <IconButton label={t("Sil", "Delete")} onClick={() => setGone(true)}>
            <TrashIcon />
          </IconButton>
          {fileId && (
            <IconButton
              primary
              label={t("Listing'e ekle", "Add to listing")}
              onClick={() => onAsk(t(`Videoyu listing'e ekle (video dosya id: ${fileId}, listing id: ${card.listing_id})`, `Add the video to the listing (video file id: ${fileId}, listing id: ${card.listing_id})`))}
            >
              <ImagePlusIcon className="!h-4 !w-4" />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}

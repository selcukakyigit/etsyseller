"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChatCard, MediaState } from "@/lib/api";
import { mediaApi } from "@/lib/mediaApi";
import HelpTip from "@/components/ui/HelpTip";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";

type Media = Extract<ChatCard, { type: "media_job" }>;

const POLL_MS = 3000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Çoklu medya üretimi: MALİYET KARTI (resim/video sayısı, kredi, bakiye) → [Üret] ile onay (üretimi ve kredi harcamasını bu düğme başlatır, model değil) → listing başına ilerleme → sonuç.
 * Üretilenler yalnızca yerel taslağa eklenir; Etsy'ye gitmez. */
export default function MediaJobCard({ card, shopId }: { card: Media; shopId: number }) {
  const { t } = useT();
  const [state, setState] = useState<MediaState>(card);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = state.status === "running";
  const q = state.quote;

  useEffect(() => {
    if (!live || gone) return;
    let stopped = false;
    const tick = () =>
      mediaApi.job(shopId, card.job_id).then(
        (s) => !stopped && setState(s),
        () => !stopped && setGone(true), // sunucu yeniden başlamış ya da iş süresi dolmuş
      );
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [live, gone, shopId, card.job_id]);

  async function act(verb: "start" | "stop") {
    setBusy(true);
    setError("");
    try {
      setState(await (verb === "start" ? mediaApi.start(shopId, card.job_id) : mediaApi.stop(shopId, card.job_id)));
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (verb === "start" && message) setError(message); // ör. bakiye yetersiz: kart yerinde kalır
      else setGone(true);
    } finally {
      setBusy(false);
    }
  }

  const cost = q.credits_enabled ? t(`≈ ${q.credits} kredi`, `≈ ${q.credits} credits`) : t("Kredi sistemi kapalı: ücretsiz", "Credit system is off: free");
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";
  const stateLabel = { queued: t("Sırada", "Queued"), running: t("Üretiliyor", "Generating"), done: t("Tamam", "Done"), failed: t("Olmadı", "Failed"), skipped: t("Atlandı", "Skipped") } as const;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {state.status === "quote" ? t("Medya üretimi: maliyet", "Media generation: cost") : t("Medya üretimi", "Media generation")}
        <HelpTip>
          {t(
            "Resimler listing'in ilk fotoğrafından, her biri farklı bir çekim olarak üretilir; ürünün kendisi değişmez. Video da ilk fotoğraftan üretilir ve birkaç dakika sürebilir. Üretilenler yalnızca yerel taslağa eklenir, Etsy'ye gitmez. Sen [Üret]'e basmadan hiçbir şey üretilmez ve kredi harcanmaz.",
            "Images are generated from the listing's first photo, each as a different shot; the product itself does not change. The video is also made from the first photo and can take a few minutes. Results are only added to the local draft and do not go to Etsy. Nothing is generated and no credits are spent until you press [Generate].",
          )}
        </HelpTip>
        <span className="ml-auto text-[11px] text-neutral-500">{t(`${q.images} resim · ${q.videos} video`, `${q.images} images · ${q.videos} video`)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-neutral-700 dark:text-neutral-300">
        <span className="font-semibold text-neutral-900 dark:text-neutral-100">{cost}</span>
        {q.credits_enabled && q.balance !== null && <span>{t(`Bakiye: ${q.balance}`, `Balance: ${q.balance}`)}</span>}
        {state.variation && <span>{t(`Her ${state.variation} seçeneği için bir görsel; üretilince seçeneğe bağlanır. Yazıları ve ölçüleri kontrol et`, `One image per ${state.variation} option, linked to the option once made. Check the labels and measurements`)}</span>}
        {state.status === "quote" && !q.affordable && <span className="font-medium text-red-600 dark:text-red-400">{t("Bakiye yetmiyor", "Not enough credits")}</span>}
      </div>

      <ul className="max-h-72 divide-y divide-neutral-100 overflow-auto border-t border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
        {state.items.map((i) => (
          <li key={i.listing_id} className="flex items-start gap-3 px-4 py-2.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{i.title ? clip(i.title, 80) : t("(başlıksız taslak)", "(untitled draft)")}</span>
                <Link href={`/listings/${i.listing_id}/edit`} className="text-[#D97757] hover:underline">
                  {t("Aç", "Open")}
                </Link>
              </div>
              <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">
                {state.status === "quote"
                  ? t(`${i.images} resim${i.video ? " + video" : ""} · ${i.credits} kredi`, `${i.images} image(s)${i.video ? " + video" : ""} · ${i.credits} credits`)
                  : t(`${i.images_done}/${i.images} resim${i.video ? ` · video ${i.video_done ? "hazır" : i.state === "running" ? "üretiliyor" : "yok"}` : ""}`, `${i.images_done}/${i.images} image(s)${i.video ? ` · video ${i.video_done ? "ready" : i.state === "running" ? "generating" : "none"}` : ""}`)}
              </p>
              {i.skipped.length > 0 && state.status === "quote" && <p className="mt-0.5 text-amber-700 dark:text-amber-400">{i.skipped.join(" · ")}</p>}
              {i.errors.length > 0 && <p className="mt-0.5 text-red-600 dark:text-red-400">{clip(i.errors.join(" · "), 200)}</p>}
            </div>
            {state.status !== "quote" && (
              <span className={`flex shrink-0 items-center gap-1 ${i.state === "done" ? "text-green-700 dark:text-green-400" : i.state === "failed" ? "text-red-600 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400"}`}>
                {i.state === "running" && <Spinner size={11} />}
                {stateLabel[i.state]}
              </span>
            )}
          </li>
        ))}
      </ul>

      {(state.note || error) && <p className="border-t border-neutral-100 px-4 py-2 text-xs text-amber-700 dark:border-neutral-800 dark:text-amber-400">{error || state.note}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <span className="mr-auto text-xs text-neutral-600 dark:text-neutral-300">
          {gone
            ? t("İş bulunamadı; o ana dek üretilenler taslakta.", "Job not found; what was generated so far is in the drafts.")
            : state.status === "quote"
              ? t("Onaylarsan üretim başlar.", "Production starts when you confirm.")
              : state.status === "running"
                ? t(`Üretiliyor: ${state.images_total} resim, ${state.videos_total} video hazır`, `Generating: ${state.images_total} image(s), ${state.videos_total} video(s) ready`)
                : state.status === "stopped"
                  ? t(`Durduruldu: ${state.images_total} resim, ${state.videos_total} video eklendi`, `Stopped: ${state.images_total} image(s), ${state.videos_total} video(s) added`)
                  : t(`Tamamlandı: ${state.images_total} resim, ${state.videos_total} video taslaklara eklendi`, `Done: ${state.images_total} image(s), ${state.videos_total} video(s) added to the drafts`)}
        </span>
        {!gone && state.status === "quote" && (
          <>
            <button type="button" disabled={busy} onClick={() => void act("stop")} className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800`}>
              {t("Vazgeç", "Cancel")}
            </button>
            <button type="button" disabled={busy || !q.affordable} onClick={() => void act("start")} className={`${btn} bg-[#D97757] text-white hover:bg-[#C6613F]`}>
              {q.credits_enabled ? t(`Üret (${q.credits} kredi)`, `Generate (${q.credits} credits)`) : t("Üret", "Generate")}
            </button>
          </>
        )}
        {!gone && live && (
          <button type="button" disabled={busy} onClick={() => void act("stop")} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950`}>
            {t("Durdur", "Stop")}
          </button>
        )}
      </div>
    </div>
  );
}

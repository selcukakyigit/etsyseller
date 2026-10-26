"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BatchState, ChatCard } from "@/lib/api";
import { batchApi } from "@/lib/batchApi";
import HelpTip from "@/components/ui/HelpTip";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";

type Batch = Extract<ChatCard, { type: "batch_job" }>;

const POLL_MS = 2500;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Birden çok ürünün resminden toplu taslak oluşturma: ürün ürün ilerleme (durdur), bitince her taslağa bağlantı ve eksikler. Taslaklar yereldir, Etsy'ye gitmez. */
export default function BatchJobCard({ card, shopId }: { card: Batch; shopId: number }) {
  const { t } = useT();
  const [state, setState] = useState<BatchState>(card);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = state.status === "running";

  useEffect(() => {
    if (!live || gone) return;
    let stopped = false;
    const tick = () =>
      batchApi.job(shopId, card.job_id).then(
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

  async function stop() {
    setBusy(true);
    try {
      setState(await batchApi.job(shopId, card.job_id, "stop"));
    } catch {
      setGone(true);
    } finally {
      setBusy(false);
    }
  }

  const finished = state.done + state.failed + state.skipped;
  const pct = state.total ? Math.round((finished / state.total) * 100) : 0;
  const stateLabel = {
    queued: t("Sırada", "Queued"),
    running: t("Hazırlanıyor", "Working"),
    done: t("Hazır", "Ready"),
    failed: t("Olmadı", "Failed"),
    skipped: t("Atlandı", "Skipped"),
  } as const;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {t("Toplu taslak oluşturma", "Batch drafts")}
        <HelpTip>
          {t(
            "Her ürün için resimlerinden ayrı bir listing taslağı hazırlanır. Taslaklar yereldir, Etsy'ye hiçbiri gitmez; yayın ayrı ve onaylıdır. Resim ya da video üretilmez, yalnızca yüklediklerin kullanılır. Fiyatı söylenmeyen ürünlerde 'Fiyat gir' eksiği kalır.",
            "A separate listing draft is prepared for each product from its images. Drafts are local and none goes to Etsy; publishing is separate and confirmed. No images or videos are generated, only the ones you uploaded are used. Products without a price keep a 'Set a price' gap.",
          )}
        </HelpTip>
        <span className="ml-auto text-[11px] text-neutral-500">
          {finished}/{state.total}
        </span>
      </div>

      {live && (
        <div className="px-4 pt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div className="h-full bg-[#D97757] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <ul className="max-h-80 divide-y divide-neutral-100 overflow-auto dark:divide-neutral-800">
        {state.items.map((i) => (
          <li key={i.index} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
            <span className="w-5 shrink-0 text-neutral-400 dark:text-neutral-500">{i.index}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{i.title ? clip(i.title, 90) : t(`${i.images} resim`, `${i.images} image(s)`)}</span>
                {i.listing_id && (
                  <Link href={`/listings/${i.listing_id}/edit`} className="text-[#D97757] hover:underline">
                    {t("Aç", "Open")}
                  </Link>
                )}
              </div>
              {i.state === "done" && i.missing.length > 0 && <p className="mt-0.5 text-amber-700 dark:text-amber-400">{i.missing.join(" · ")}</p>}
              {i.state === "done" && i.warnings.length > 0 && <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">{clip(i.warnings.join(" · "), 160)}</p>}
              {i.state === "failed" && <p className="mt-0.5 text-red-600 dark:text-red-400">{i.error}</p>}
            </div>
            <span
              className={`flex shrink-0 items-center gap-1 ${
                i.state === "done" ? "text-green-700 dark:text-green-400" : i.state === "failed" ? "text-red-600 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {i.state === "running" && <Spinner size={11} />}
              {stateLabel[i.state]}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <span className="mr-auto text-xs text-neutral-600 dark:text-neutral-300">
          {gone
            ? t("İş bulunamadı; o ana dek oluşan taslaklar yerelde.", "Job not found; drafts made so far are local.")
            : live
              ? t(`${state.done} hazır, ${state.failed} olmadı · sürüyor`, `${state.done} ready, ${state.failed} failed · running`)
              : state.status === "stopped"
                ? t(`Durduruldu: ${state.done} hazır, ${state.skipped} atlandı`, `Stopped: ${state.done} ready, ${state.skipped} skipped`)
                : t(`Tamamlandı: ${state.done} hazır${state.failed ? `, ${state.failed} olmadı` : ""}`, `Done: ${state.done} ready${state.failed ? `, ${state.failed} failed` : ""}`)}
        </span>
        {!gone && live && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void stop()}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            {t("Durdur", "Stop")}
          </button>
        )}
      </div>
    </div>
  );
}

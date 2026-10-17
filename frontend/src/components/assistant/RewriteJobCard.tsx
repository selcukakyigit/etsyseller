"use client";

import { useEffect, useState } from "react";
import { api, ChatCard, RewriteState } from "@/lib/api";
import HelpTip from "@/components/ui/HelpTip";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import BulkResultCard from "./BulkResultCard";

type Rewrite = Extract<ChatCard, { type: "rewrite_job" }>;

const POLL_MS = 2500;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Toplu yapay zekâ yeniden yazımı: önce 2 örneğin önce/sonrası (onay), sonra arka plan ilerlemesi (durdur), bitince ortak toplu sonuç kartı. */
export default function RewriteJobCard({ card, shopId }: { card: Rewrite; shopId: number }) {
  const { t } = useT();
  const [state, setState] = useState<RewriteState>(card);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = state.status === "preview" || state.status === "running";

  useEffect(() => {
    if (!live || gone) return;
    let stopped = false;
    const tick = () =>
      api.assistant.rewriteJob(shopId, card.job_id).then(
        (s) => !stopped && setState(s),
        () => !stopped && setGone(true), // sunucu yeniden başlamış ya da iş süresi dolmuş
      );
    void tick();
    const id = state.status === "running" ? window.setInterval(tick, POLL_MS) : undefined;
    return () => {
      stopped = true;
      if (id) window.clearInterval(id);
    };
  }, [live, gone, state.status, shopId, card.job_id]);

  async function act(action: "start" | "stop") {
    setBusy(true);
    try {
      setState(await api.assistant.rewriteJob(shopId, card.job_id, action));
    } catch {
      setGone(true);
    } finally {
      setBusy(false);
    }
  }

  const pct = state.total ? Math.round((state.processed / state.total) * 100) : 0;
  const remaining = state.total - state.processed;
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";
  const finished = !live && state.listing_ids.length > 0;

  return (
    <div className="mt-2">
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          {t("Yapay zekâ ile yeniden yazım", "AI rewrite")}
          <HelpTip>
            {t(
              "Önce 2 listing yazılır; beğenirsen kalanı arka planda sırayla yazılır. Hepsi yerel taslak olur, Etsy'ye gitmez. Listing başına yaklaşık 3 kredi harcanır; istediğin an durdurabilirsin.",
              "Two listings are written first; if you like them, the rest is written one by one in the background. Everything stays a local draft and nothing goes to Etsy. About 3 credits per listing; you can stop any time.",
            )}
          </HelpTip>
          <span className="ml-auto text-[11px] text-neutral-500">
            {state.processed}/{state.total}
          </span>
        </div>

        {state.samples.length > 0 && (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {state.samples.map((s) => (
              <li key={s.id} className="space-y-1.5 px-4 py-3 text-xs">
                <div className="text-neutral-400 line-through dark:text-neutral-500">{clip(s.detail.before.title, 140)}</div>
                <div className="font-medium text-neutral-900 dark:text-neutral-100">{clip(s.detail.after.title, 140)}</div>
                <div className="flex flex-wrap gap-1">
                  {s.detail.after.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-neutral-500 dark:text-neutral-400">{clip(s.detail.after.description, 220)}</p>
                {s.warnings.length > 0 && <p className="text-amber-700 dark:text-amber-400">{s.warnings.join(" · ")}</p>}
              </li>
            ))}
          </ul>
        )}

        {state.status === "running" && (
          <div className="px-4 pb-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full bg-[#D97757] transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
          <span className="mr-auto flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
            {state.status === "running" && <Spinner size={12} />}
            {gone
              ? t("İş bulunamadı; o ana dek yazılanlar yerel taslakta.", "Job not found; what was written so far is in local drafts.")
              : state.status === "preview"
                ? t(`Kalan ${remaining} listing · ~${state.estimate.credits} kredi`, `${remaining} left · ~${state.estimate.credits} credits`)
                : state.status === "running"
                  ? t(`Yazılıyor: ${state.processed}/${state.total}`, `Writing: ${state.processed}/${state.total}`)
                  : state.status === "stopped"
                    ? t("Durduruldu", "Stopped")
                    : state.status === "out_of_credits"
                      ? t("Kredi bitti, durdu", "Out of credits, stopped")
                      : t("Tamamlandı", "Done")}
          </span>
          {!gone && state.status === "preview" && (
            <>
              <button type="button" disabled={busy} onClick={() => void act("stop")} className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800`}>
                {t("Vazgeç", "Cancel")}
              </button>
              <button type="button" disabled={busy} onClick={() => void act("start")} className={`${btn} bg-[#D97757] text-white hover:bg-[#C6613F]`}>
                {t("Devam et", "Continue")}
              </button>
            </>
          )}
          {!gone && state.status === "running" && (
            <button type="button" disabled={busy} onClick={() => void act("stop")} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950`}>
              {t("Durdur", "Stop")}
            </button>
          )}
        </div>
      </div>

      {(finished || (!live && state.skipped.length > 0)) && (
        <BulkResultCard
          shopId={shopId}
          card={{ type: "bulk_result", listing_ids: state.listing_ids, inspected: state.processed, changed: state.changed, skipped: state.skipped, samples: [], ops: ["rewrite"] }}
        />
      )}
    </div>
  );
}

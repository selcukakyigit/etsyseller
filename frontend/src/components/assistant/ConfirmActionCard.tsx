"use client";

import { useState } from "react";
import type { ActionState, ChatCard } from "@/lib/api";
import { actionApi } from "@/lib/actionApi";
import HelpTip from "@/components/ui/HelpTip";
import { useT } from "@/lib/i18n-client";

type Confirm = Extract<ChatCard, { type: "confirm_action" }>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Düğmeli onay kartı (şimdilik yeni taslakları silme): silme işini model değil bu düğmeler tetikler; basılana kadar hiçbir şey silinmez. */
export default function ConfirmActionCard({ card, shopId }: { card: Confirm; shopId: number }) {
  const { t } = useT();
  const [state, setState] = useState<ActionState>(card);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const count = state.items.length;

  async function act(verb: "confirm" | "cancel") {
    setBusy(true);
    try {
      setState(await (verb === "confirm" ? actionApi.confirm(shopId, card.action_id) : actionApi.cancel(shopId, card.action_id)));
    } catch {
      setGone(true); // sunucu yeniden başlamış ya da onay süresi dolmuş
    } finally {
      setBusy(false);
    }
  }

  const deleted = state.result.deleted?.length ?? 0;
  const skipped = state.result.skipped?.length ?? 0;
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {t("Taslakları sil", "Delete drafts")}
        <HelpTip>
          {t(
            "Yalnızca henüz Etsy'ye gitmemiş yeni taslaklar silinir ve geri alınamaz. Sil'e basmadan hiçbir şey silinmez. Etsy'de yayındaki listing'ler bu yolla silinemez.",
            "Only new drafts that have not gone to Etsy are deleted, and it cannot be undone. Nothing is deleted until you press Delete. Listings that are live on Etsy cannot be deleted this way.",
          )}
        </HelpTip>
      </div>
      <ul className="max-h-48 divide-y divide-neutral-100 overflow-auto dark:divide-neutral-800">
        {state.items.map((i) => (
          <li key={i.listing_id} className={`px-4 py-2 text-xs ${state.status === "done" ? "text-neutral-400 line-through dark:text-neutral-500" : "text-neutral-800 dark:text-neutral-200"}`}>
            {i.title ? clip(i.title, 100) : t("(başlıksız taslak)", "(untitled draft)")}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <span className="mr-auto text-xs text-neutral-600 dark:text-neutral-300">
          {gone
            ? t("Onay isteği bulunamadı (süresi dolmuş olabilir); asistandan yeniden iste.", "Confirmation not found (it may have expired); ask the assistant again.")
            : state.status === "done"
              ? t(`${deleted} taslak silindi${skipped ? `, ${skipped} atlandı` : ""}.`, `${deleted} draft(s) deleted${skipped ? `, ${skipped} skipped` : ""}.`)
              : state.status === "cancelled"
                ? t("Vazgeçildi; hiçbir şey silinmedi.", "Cancelled; nothing was deleted.")
                : state.status === "expired"
                  ? t("Süresi doldu; hiçbir şey silinmedi.", "Expired; nothing was deleted.")
                  : t(`${count} taslak silinecek.`, `${count} draft(s) will be deleted.`)}
        </span>
        {!gone && state.status === "pending" && (
          <>
            <button type="button" disabled={busy} onClick={() => void act("cancel")} className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800`}>
              {t("Vazgeç", "Cancel")}
            </button>
            <button type="button" disabled={busy} onClick={() => void act("confirm")} className={`${btn} border border-red-300 bg-red-600 text-white hover:bg-red-700 dark:border-red-800`}>
              {t(`Sil (${count})`, `Delete (${count})`)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

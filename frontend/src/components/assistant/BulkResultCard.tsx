"use client";

import Link from "next/link";
import { useState } from "react";
import { api, BulkBrief, ChatCard } from "@/lib/api";
import { startPublish, usePublishJobs } from "@/lib/publishJobs";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import HelpTip from "@/components/ui/HelpTip";
import { useT } from "@/lib/i18n-client";

type Bulk = Extract<ChatCard, { type: "bulk_result" }>;

const range = (r: [number, number] | null | undefined, fmt: (n: number) => string) => (r ? (r[0] === r[1] ? fmt(r[0]) : `${fmt(r[0])}–${fmt(r[1])}`) : "—");

/** Toplu işlemin sonucu: değişenler yerel taslak olarak durur; kullanıcı hepsini Etsy'de yayınlar, hepsinden vazgeçer ya da Listing'ler sayfasında tek tek bakar. */
export default function BulkResultCard({ card, shopId }: { card: Bulk; shopId: number }) {
  const { t, locale } = useT();
  const [confirm, confirmElement] = useConfirm();
  const jobs = usePublishJobs();
  const [started, setStarted] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [busy, setBusy] = useState(false);
  const num = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });

  const states = card.listing_ids.map((id) => jobs.get(id)?.phase);
  const done = states.filter((p) => p === "done").length;
  const failed = states.filter((p) => p === "error").length;
  const publishing = started && done + failed < card.listing_ids.length;

  async function publishAll() {
    const ok = await confirm({
      title: t(`${card.changed} listing Etsy'de yayınlansın mı?`, `Publish ${card.changed} listings on Etsy?`),
      message: t("Değişiklikler canlıya yansır. Listing'ler sırayla, arka planda yayınlanır; bu sırada başka işe devam edebilirsin.", "The changes go live. Listings are published one by one in the background; you can keep working."),
      confirmLabel: t("Yayınla", "Publish"),
    });
    if (!ok) return;
    setStarted(true);
    for (const id of card.listing_ids) void startPublish(shopId, id); // yayın sırası ortaktır (lib/publishJobs): sırayla çalışır
  }

  async function discardAll() {
    const ok = await confirm({
      title: t("Değişikliklerden vazgeçilsin mi?", "Discard these changes?"),
      message: t(`${card.changed} listing'in yerel değişikliği atılır; Etsy'deki hâlleri aynen kalır.`, `The local changes of ${card.changed} listings are discarded; they stay as they are on Etsy.`),
      confirmLabel: t("Vazgeç", "Discard"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      for (const id of card.listing_ids) await api.listings.discardLocal(shopId, id).catch(() => undefined);
      setDiscarded(true);
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";
  const row = (b: BulkBrief | undefined, a: BulkBrief | undefined) => {
    if (!b || !a) return "";
    const parts: string[] = [];
    if (JSON.stringify(b.price) !== JSON.stringify(a.price)) parts.push(`${range(b.price, num)} → ${range(a.price, num)}`);
    if (JSON.stringify(b.quantity) !== JSON.stringify(a.quantity)) parts.push(t("stok", "stock") + ` ${range(b.quantity, num)} → ${range(a.quantity, num)}`);
    if (b.title !== a.title) parts.push(a.title);
    if (b.tags !== a.tags) parts.push(t(`${b.tags} → ${a.tags} etiket`, `${b.tags} → ${a.tags} tags`));
    return parts.join(" · ");
  };

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {t("Toplu değişiklik", "Bulk change")}
        <HelpTip>
          {t(
            "Değişiklikler yalnızca yerel taslak olarak yazıldı, Etsy'ye henüz gitmedi. Çok sayıda listing'i aynı anda yayınlamak, sistemin her değişikliğin etkisini ayrı ölçmesini zorlaştırır.",
            "The changes were written as local drafts only and have not gone to Etsy yet. Publishing many listings at once makes it harder to measure the effect of each change separately.",
          )}
        </HelpTip>
      </div>

      <div className="grid grid-cols-3 gap-px bg-neutral-100 dark:bg-neutral-800">
        {[
          [t("İncelenen", "Checked"), card.inspected],
          [t("Değişen", "Changed"), card.changed],
          [t("Atlanan", "Skipped"), card.inspected - card.changed],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white px-4 py-3 dark:bg-neutral-900">
            <div className="text-[11px] text-neutral-500">{label}</div>
            <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{(value as number).toLocaleString(locale)}</div>
          </div>
        ))}
      </div>

      {card.samples.length > 0 && (
        <ul className="divide-y divide-neutral-100 px-4 text-xs dark:divide-neutral-800">
          {card.samples.map((s) => (
            <li key={s.id} className="py-2">
              <div className="truncate font-medium text-neutral-800 dark:text-neutral-100">{s.title}</div>
              <div className="text-neutral-500 dark:text-neutral-400">{row(s.before, s.after)}</div>
            </li>
          ))}
        </ul>
      )}

      {card.skipped.length > 0 && (
        <p className="px-4 pb-1 pt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          {t("Atlananlar", "Skipped")}: {card.skipped.map((s) => `${s.reason} (${s.count})`).join(" · ")}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        {publishing || started ? (
          <span className="mr-auto text-xs text-neutral-600 dark:text-neutral-300">
            {t(`Yayınlanıyor: ${done + failed}/${card.listing_ids.length}`, `Publishing: ${done + failed}/${card.listing_ids.length}`)}
            {failed > 0 && <span className="ml-2 text-red-600 dark:text-red-400">{t(`${failed} hata`, `${failed} failed`)}</span>}
          </span>
        ) : discarded ? (
          <span className="mr-auto text-xs text-neutral-600 dark:text-neutral-300">{t("Değişikliklerden vazgeçildi", "Changes discarded")}</span>
        ) : null}
        <Link href="/listings" className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800`}>
          {t("Listing'lerde gör", "View in Listings")}
        </Link>
        {card.changed > 0 && !started && !discarded && (
          <>
            <button type="button" disabled={busy} onClick={() => void discardAll()} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950`}>
              {t("Vazgeç", "Discard")}
            </button>
            <button type="button" disabled={busy} onClick={() => void publishAll()} className={`${btn} bg-[#D97757] text-white hover:bg-[#C6613F]`}>
              {t("Etsy'de yayınla", "Publish on Etsy")}
            </button>
          </>
        )}
      </div>
      {confirmElement}
    </div>
  );
}

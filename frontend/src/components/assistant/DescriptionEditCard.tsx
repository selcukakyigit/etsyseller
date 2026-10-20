"use client";

import { useState } from "react";
import { api, BulkBrief, ChatCard } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import HelpTip from "@/components/ui/HelpTip";
import { useT } from "@/lib/i18n-client";
import BulkResultCard from "./BulkResultCard";

type DescriptionEdit = Extract<ChatCard, { type: "description_edit" }>;
type BulkCard = Extract<ChatCard, { type: "bulk_result" }>;

/**
 * Açıklama aramasının bulduğu satır: her yazılış biçimi düzenlenebilir bir kutuda durur; "Hepsinde değiştir" bu listing'lerin hepsine
 * yerel taslak olarak uygular (Etsy'ye gitmez). Sonuç, "Etsy'de yayınla / Vazgeç" düğmeli toplu sonuç kartı olarak aynı yerde görünür.
 */
export default function DescriptionEditCard({ card, shopId }: { card: DescriptionEdit; shopId: number }) {
  const { t, locale } = useT();
  const [confirm, confirmElement] = useConfirm();
  const [texts, setTexts] = useState(card.variants.map((v) => v.line));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkCard | null>(null);

  const edited = card.variants.map((v, i) => texts[i] !== v.line);
  const anyEdited = edited.some(Boolean);

  async function save() {
    if (texts.some((text, i) => edited[i] && text.trim() === "")) {
      const ok = await confirm({
        title: t("Satır silinsin mi?", "Delete the line?"),
        message: t("Kutuyu boş bıraktın: bu satır tüm bu listing'lerin açıklamasından silinecek.", "You left a box empty: that line will be removed from the description of all these listings."),
        confirmLabel: t("Sil", "Delete"),
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const changedIds = new Set<number>();
      const skipped = new Map<string, number>();
      const samples: BulkCard["samples"] = [];
      for (let i = 0; i < card.variants.length; i++) {
        if (!edited[i]) continue;
        const results = await api.listings.bulkStage(shopId, card.listing_ids, { description: { mode: "find_replace", find: card.variants[i].line, replace: texts[i] } });
        for (const r of results) {
          if (r.ok && r.changed) {
            changedIds.add(r.id);
            if (samples.length < 5 && r.before && r.after) samples.push({ id: r.id, title: r.title ?? "", before: r.before as BulkBrief, after: r.after as BulkBrief, ...(r.description ? { description: r.description } : {}) });
          } else if (!r.ok && r.error) skipped.set(r.error, (skipped.get(r.error) ?? 0) + 1);
        }
      }
      setResult({
        type: "bulk_result", listing_ids: [...changedIds], inspected: card.total, changed: changedIds.size,
        skipped: [...skipped].map(([reason, count]) => ({ reason, count })), samples, ops: ["description"],
      });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("Kaydedilemedi", "Could not save"));
    } finally {
      setBusy(false);
    }
  }

  if (result) return <BulkResultCard card={result} shopId={shopId} />;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {t(`Açıklamayı düzenle · ${card.total.toLocaleString(locale)} listing`, `Edit the description · ${card.total.toLocaleString(locale)} listings`)}
        <HelpTip>
          {t(
            "Kutudaki metni düzenleyip “Hepsinde değiştir”e basınca bu satır, bulunan tüm listing'lerin açıklamasında yenisiyle değişir. Yalnızca yerel taslak yazılır, Etsy'ye henüz gitmez; sonuç kartında hepsini yayınlayabilir ya da vazgeçebilirsin. Eşleşme birebirdir.",
            "When you edit the text and press “Replace in all”, this line is replaced in the description of every listing found. Only local drafts are written, nothing goes to Etsy yet; the result card lets you publish them all or discard. Matching is exact.",
          )}
        </HelpTip>
      </div>

      <div className="space-y-3 p-4">
        {card.variants.map((v, i) => (
          <div key={i}>
            <div className="mb-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
              {t(`${v.count.toLocaleString(locale)} listing'de bu yazılış`, `${v.count.toLocaleString(locale)} listings have this wording`)}
              {edited[i] && <span className="ml-2 text-[#D97757]">{t("düzenlendi", "edited")}</span>}
            </div>
            <textarea
              value={texts[i]}
              onChange={(e) => setTexts((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              rows={Math.min(8, Math.max(3, Math.ceil(texts[i].length / 80)))}
              disabled={busy}
              spellCheck={false} // listing metni çoğu zaman başka dilde; tarayıcının kırmızı çizgileri yalnızca gürültü yapar
              className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </div>
        ))}
        {card.others > 0 && (
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {t(`${card.others.toLocaleString(locale)} listing'de satır başka yazılışta; bunlara dokunulmaz.`, `${card.others.toLocaleString(locale)} listings have the line in another wording; they are left untouched.`)}
          </p>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={() => setTexts(card.variants.map((v) => v.line))}
          disabled={busy || !anyEdited}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t("Sıfırla", "Reset")}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !anyEdited}
          className="rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#C6613F] disabled:opacity-50"
        >
          {busy ? t("Uygulanıyor…", "Applying…") : t(`Hepsinde değiştir (${card.total.toLocaleString(locale)})`, `Replace in all (${card.total.toLocaleString(locale)})`)}
        </button>
      </div>
      {confirmElement}
    </div>
  );
}

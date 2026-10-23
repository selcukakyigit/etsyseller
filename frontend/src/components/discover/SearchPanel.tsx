"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { DiscoverSearch, SavedCollection, discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";
import { toast } from "@/lib/toast";
import SaveBar from "./SaveBar";
import { KeywordRow, useRefusedText } from "./shared";

const POLL_MS = 4000;
const MAX_POLLS = 30; // ~2 dakika: ilk araştırma genellikle 1–2 dakikada gelir

/** Tohum kelimeyi araştırır. Sonuç havuzda yoksa iş kuyruğa girer; sayfa hazır olana kadar kendiliğinden yoklar. Ham arama sayısı gösterilmez. */
export default function SearchPanel({ shopId, collections, onSaved }: { shopId: number; collections: SavedCollection[]; onSaved: () => void }) {
  const { t } = useT();
  const refusedText = useRefusedText();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useCached<DiscoverSearch>(query ? `discover:${shopId}:${query}` : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [polls, setPolls] = useState(0);

  const load = useCallback(
    async (q: string) => {
      try {
        setResult(await discoverApi.search(shopId, q));
        setError(null);
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : t("Arama yapılamadı", "Search failed"));
      }
    },
    [shopId, setResult, t],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setPolls(0);
    setSelected(new Set());
    setQuery(q);
    setLoading(true);
    await load(q);
    setLoading(false);
  }

  // Sonuç hazırlanıyorsa (ya da yenileniyorsa) aynı aramayı belli aralıkla yeniden sorar; hazır olunca durur.
  const waiting = result !== null && (result.status === "pending" || result.stale);
  useEffect(() => {
    if (!query || !waiting || polls >= MAX_POLLS) return;
    const id = window.setTimeout(() => {
      setPolls((n) => n + 1);
      void load(query);
    }, POLL_MS);
    return () => window.clearTimeout(id);
  }, [query, waiting, polls, load]);

  function toggle(term: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  }

  async function save(collection: string) {
    if (!result) return;
    setSaving(true);
    try {
      const terms = [...selected];
      const r = await discoverApi.save(shopId, terms, collection);
      toast.success(r.added > 0 ? t(`${r.added} kelime kaydedildi.`, `${r.added} keywords saved.`) : t("Bu kelimeler zaten kayıtlı.", "These keywords are already saved."));
      const mark = <T extends { term: string; saved: boolean }>(i: T): T => (terms.includes(i.term) ? { ...i, saved: true } : i);
      setResult({ ...result, seed_item: result.seed_item ? mark(result.seed_item) : null, items: result.items.map(mark) });
      setSelected(new Set());
      onSaved();
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const gaveUp = waiting && polls >= MAX_POLLS;

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void submit(e)} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={120}
          placeholder={t("Bir ürün ya da kelime yaz (ör. metal farm sign)", "Type a product or keyword (e.g. metal farm sign)")}
          aria-label={t("Aranacak kelime", "Keyword to research")}
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
        />
        <Button type="submit" tone="primary" busy={loading} disabled={!input.trim()}>
          {t("Araştır", "Research")}
        </Button>
      </form>

      <div className="min-h-[16rem]">
        {error && !result ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : !query ? (
          <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
            {t("Bir kelime yaz; ilgili aramaları, talep seviyesini ve alıcı niyetini göster.", "Type a keyword to see related searches, demand level and buyer intent.")}
          </p>
        ) : !result ? (
          <BlockSpinner />
        ) : result.status === "invalid" ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Kelime boş ya da çok uzun (en fazla 10 kelime).", "The keyword is empty or too long (max 10 words).")}</p>
        ) : result.status === "refused" ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">{refusedText(result.refused)}</p>
        ) : result.status === "empty" ? (
          <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">{t("Bu kelime için öneri bulunamadı. Daha genel bir ifade dene.", "No suggestions found. Try a more general phrase.")}</p>
        ) : result.status === "pending" ? (
          <div className="space-y-2 py-8 text-center">
            <BlockSpinner />
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {gaveUp
                ? t("Hazırlanması beklenenden uzun sürüyor. Birkaç dakika sonra aynı kelimeyi yeniden ara.", "This is taking longer than expected. Search the same keyword again in a few minutes.")
                : t("Bu kelime ilk kez araştırılıyor, genellikle 1–2 dakika sürer…", "This keyword is being researched for the first time; it usually takes 1–2 minutes…")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {result.stale && <p className="text-xs text-neutral-400 dark:text-neutral-500">{t("Sonuçlar güncelleniyor…", "Results are being refreshed…")}</p>}
            {result.seed_item && (
              <div className="rounded-xl border border-neutral-200 bg-white px-4 py-1 dark:border-neutral-800 dark:bg-neutral-900">
                <ul>
                  <KeywordRow item={result.seed_item} checked={selected.has(result.seed_item.term)} onToggle={() => toggle(result.seed_item!.term)} />
                </ul>
              </div>
            )}
            {result.items.length > 0 && (
              <div className="rounded-xl border border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {result.items.map((i) => (
                    <KeywordRow key={i.term} item={i} checked={selected.has(i.term)} onToggle={() => toggle(i.term)} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {selected.size > 0 && <SaveBar count={selected.size} collections={collections} busy={saving} onSave={(c) => void save(c)} />}
    </div>
  );
}

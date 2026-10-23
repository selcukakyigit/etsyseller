"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { DiscoverItem, DiscoverSearch, ETSY_RESULTS_MAX, SavedCollection, SearchMode, discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { readPageCache, writePageCache } from "@/lib/pageCache";
import { toast } from "@/lib/toast";
import { useUrlTab } from "@/lib/useUrlTab";
import CollectionBar from "./CollectionBar";
import EtsyTopModal from "./EtsyTopModal";
import KeywordDetailModal from "./KeywordDetailModal";
import FilterBar from "./FilterBar";
import KeywordTable from "./KeywordTable";
import OverviewCard from "./OverviewCard";
import SaveBar from "./SaveBar";
import { useRefusedText } from "./shared";
import { EMPTY_FILTERS, downloadCsv, toCsv } from "./table";
import { useCollection } from "./useCollection";
import { useResultsView } from "./useResultsView";

const POLL_MS = 2000;
const MAX_POLLS = 60; // ~2 dakika: ilk araştırma genellikle birkaç saniye ile 1–2 dakika arasında gelir
const NO_ITEMS: DiscoverItem[] = [];
const isQuery = (v: string) => v.length > 0 && v.length <= 120;

/** Tohum kelimeyi araştırır. Sonuç havuzda yoksa iş kuyruğa girer; sayfa hazır olana kadar kendiliğinden yoklar.
 *
 * Düzen: özet kart, kaynak notu, sekmeler (Tüm kelimeler / Sorular), koleksiyon çubuğu, araç çubuğu (solda Etsy ilan sayısı, sağda CSV ve Yeniden araştır),
 * kelime grupları, süzgeçler, özet satırı, tablo. Sekme değişince sayfa DEĞİŞMEZ: yalnızca tablonun bulunduğu bölge yüklenir (soru listesi arka planda
 * getirilir); her sekmenin süzgeci, sıralaması ve seçimi kendinde kalır. Sonuçlar anahtarlarıyla ayrı tutulur; anahtar çağrı anında verilir. */
export default function SearchPanel({ shopId, collections, onSaved }: { shopId: number; collections: SavedCollection[]; onSaved: () => void }) {
  const { t, locale } = useT();
  const refusedText = useRefusedText();
  // Aranan kelime URL'de (?q=) tutulur: sayfa yenilense ya da bağlantı paylaşılsa arama kaybolmaz (sonuç havuzdan anında gelir).
  const [query, setQuery] = useUrlTab<string>("q", "", isQuery);
  const [typed, setTyped] = useState<string | null>(null);
  const input = typed ?? query;
  const [mode, setMode] = useState<SearchMode>("all");
  const [results, setResults] = useState<Record<string, DiscoverSearch>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [etsy, setEtsy] = useState<Record<string, number | null>>({});
  const [polls, setPolls] = useState(0);
  const [analyzeTerm, setAnalyzeTerm] = useState<string | null>(null);
  const [detail, setDetail] = useState<DiscoverItem | null>(null);

  const keyOf = useCallback((q: string, m: SearchMode) => `discover:${shopId}:${m}:${q}`, [shopId]);
  const resultFor = (m: SearchMode): DiscoverSearch | null => {
    if (!query) return null;
    const k = keyOf(query, m);
    return results[k] ?? readPageCache<DiscoverSearch>(k);
  };
  const allRes = resultFor("all");
  const qRes = resultFor("questions");
  const result = mode === "all" ? allRes : qRes; // bölgede gösterilen liste
  // Her sekmenin kendi süzgeci/sıralaması/seçimi vardır; sekme değişince diğerinin durumu korunur.
  const vAll = useResultsView(allRes?.items ?? NO_ITEMS, allRes?.seed ?? "", etsy);
  const vQ = useResultsView(qRes?.items ?? NO_ITEMS, qRes?.seed ?? "", etsy);
  const v = mode === "all" ? vAll : vQ;
  const col = useCollection(shopId, collections, onSaved);

  const load = useCallback(
    async (q: string, m: SearchMode, refresh = false) => {
      const k = keyOf(q, m);
      try {
        const data = await discoverApi.search(shopId, q, m, refresh);
        writePageCache(k, data);
        setResults((prev) => ({ ...prev, [k]: data }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : t("Arama yapılamadı", "Search failed"));
      }
    },
    [shopId, keyOf, t],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setPolls(0);
    setMode("all");
    for (const view of [vAll, vQ]) {
      view.clearSelection();
      view.setFilters(EMPTY_FILTERS);
    }
    setQuery(q);
    setLoading(true);
    await load(q, "all");
    setLoading(false);
  }

  // Sayfa URL'de bir arama ile açıldıysa (yenileme/paylaşılan bağlantı) sonuç kendiliğinden yüklenir.
  useEffect(() => {
    if (!query || mode !== "all" || loading || results[keyOf(query, "all")] || readPageCache(keyOf(query, "all"))) return;
    const id = window.setTimeout(() => void load(query, "all"), 0); // zamanlayıcıda: efekt gövdesinde eşzamanlı durum ayarlanmaz
    return () => window.clearTimeout(id);
  }, [query, mode, loading, results, keyOf, load]);

  // Sorular ayrı bir araştırmadır: yalnızca sekmesi açılınca istenir. Sayfa yerinde kalır; yükleme yalnızca tablo bölgesinde görünür.
  async function switchMode(next: SearchMode) {
    if (next === mode || !query) return;
    setMode(next);
    setPolls(0);
    if (!resultFor(next)) await load(query, next);
  }

  // Google verisini yeniden çeker (liste yenisiyle değişir); eski liste yenisi gelene kadar görünür, sayfa kendiliğinden yoklar.
  async function refresh() {
    if (!query) return;
    setPolls(0);
    setRefreshing(true);
    await load(query, mode, true);
    setRefreshing(false);
  }

  // Sonuç hazırlanıyorsa (ya da yenileniyorsa) aynı aramayı kısa aralıkla yeniden sorar; hazır olunca durur.
  const waiting = result !== null && (result.status === "pending" || result.stale);
  useEffect(() => {
    if (!query || !waiting || polls >= MAX_POLLS) return;
    const id = window.setTimeout(() => {
      setPolls((n) => n + 1);
      void load(query, mode);
    }, POLL_MS);
    return () => window.clearTimeout(id);
  }, [query, mode, waiting, polls, load]);

  async function addSelected() {
    setSaving(true);
    await col.add([...v.selected]);
    v.clearSelection();
    setSaving(false);
  }

  // Görünen listenin sıralamadaki ilk ölçülmemiş kelimeleri için Etsy'deki ilan sayısı.
  async function measureEtsy() {
    // Varyantlar Etsy'de aynı aramadır: yalnızca grup temsilcileri ölçülür (ilk 20 grup, kota boşa gitmesin).
    const todo = v.rows.filter((r) => etsy[r.item.term] === undefined).slice(0, ETSY_RESULTS_MAX).map((r) => r.item.term);
    if (todo.length === 0) {
      toast.success(t("Görünen kelimelerin Etsy ilan sayıları zaten ölçüldü. Süzgeçle ya da sıralayarak başka kelimeleri öne al.", "Etsy listing counts for the shown keywords are already measured. Filter or sort to bring other keywords forward."));
      return;
    }
    setMeasuring(true);
    try {
      const r = await discoverApi.etsyResults(shopId, todo);
      if (r.limited) toast.error(t("Etsy ölçüm hakkın geçici olarak doldu; birkaç dakika sonra dene.", "Your Etsy measurement allowance is used up for now; try again in a few minutes."));
      else setEtsy((prev) => ({ ...prev, ...Object.fromEntries(todo.map((term) => [term, r.counts[term] ?? null])) }));
    } catch (e) {
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setMeasuring(false);
    }
  }

  const showEtsy = useMemo(() => Object.keys(etsy).length > 0, [etsy]);
  const gaveUp = waiting && polls >= MAX_POLLS;
  const pageReady = allRes !== null && allRes.status === "ready"; // sayfa iskeleti: ilk liste hazır olunca bir kez kurulur, sonra sabit kalır
  const seedItem = allRes?.seed_item ?? null;
  const measuredAt = allRes?.measured_at ?? null;

  const box = "flex min-h-[16rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm dark:border-neutral-800";
  const message = (text: string, tone: "muted" | "warn" = "muted"): ReactNode =>
    tone === "warn" ? (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">{text}</p>
    ) : (
      <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">{text}</p>
    );

  // Tablo bölgesi: seçili sekmenin listesi; yükleniyorsa yalnızca burası bekler (üstteki her şey yerinde kalır).
  const listRegion = (): ReactNode => {
    if (!result || result.status === "pending") {
      return (
        <div className={box} aria-live="polite">
          <BlockSpinner />
          <p className="text-neutral-600 dark:text-neutral-300">
            {gaveUp
              ? t("Hazırlanması beklenenden uzun sürüyor. Birkaç dakika sonra yeniden dene.", "This is taking longer than expected. Try again in a few minutes.")
              : mode === "questions"
                ? t("Sorular getiriliyor…", "Fetching questions…")
                : t("Liste hazırlanıyor…", "Preparing the list…")}
          </p>
        </div>
      );
    }
    if (result.status === "refused") return message(refusedText(result.refused), "warn");
    if (result.status === "empty") return message(mode === "questions" ? t("Bu kelime için soru bulunamadı.", "No questions found for this keyword.") : t("Bu kelime için öneri bulunamadı. Daha genel bir ifade dene.", "No suggestions found. Try a more general phrase."));
    return (
      <KeywordTable
        rows={v.rows}
        selected={v.selected}
        onToggle={v.toggle}
        onToggleMany={v.toggleMany}
        sort={v.sort}
        onSort={v.onSort}
        etsy={etsy}
        showEtsy={showEtsy && mode === "all"}
        emptyText={t("Süzgeçlere uyan kelime yok.", "No keywords match the filters.")}
        collect={{ active: col.active, has: col.has, onAdd: (term) => void col.add([term]), onRemove: (term) => void col.remove(term) }}
        onAnalyze={mode === "all" ? setAnalyzeTerm : undefined}
        onOpen={setDetail}
      />
    );
  };

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void submit(e)} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={120}
          placeholder={t("Bir ürün ya da kelime yaz (ör. metal wall art)", "Type a product or keyword (e.g. metal wall art)")}
          aria-label={t("Aranacak kelime", "Keyword to research")}
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
        />
        <Button type="submit" tone="primary" busy={loading} disabled={!input.trim()}>
          {t("Araştır", "Research")}
        </Button>
      </form>

      {!pageReady ? (
        <div className="min-h-[16rem]">
          {error && !allRes ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : !query ? (
            <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">{t("Bir kelime yaz; ilgili aramaları, aylık arama sayısını, trendi, CPC'yi ve alıcı niyetini göster.", "Type a keyword to see related searches, monthly searches, trend, CPC and buyer intent.")}</p>
          ) : !allRes ? (
            <div className="space-y-2 py-8 text-center">
              <BlockSpinner />
              <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("Aranıyor…", "Searching…")}</p>
            </div>
          ) : allRes.status === "invalid" ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("Kelime boş ya da çok uzun (en fazla 10 kelime).", "The keyword is empty or too long (max 10 words).")}</p>
          ) : allRes.status === "refused" ? (
            message(refusedText(allRes.refused), "warn")
          ) : allRes.status === "empty" ? (
            message(t("Bu kelime için öneri bulunamadı. Daha genel bir ifade dene.", "No suggestions found. Try a more general phrase."))
          ) : (
            <div className="space-y-2 py-8 text-center">
              <BlockSpinner />
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                {gaveUp
                  ? t("Hazırlanması beklenenden uzun sürüyor. Birkaç dakika sonra aynı kelimeyi yeniden ara.", "This is taking longer than expected. Search the same keyword again in a few minutes.")
                  : t("Kelimeyi senin için analiz ediyoruz: arama hacmi, trend ve öneriler hazırlanıyor (birkaç saniye)…", "We are analyzing this keyword for you: preparing search volume, trends and suggestions (a few seconds)…")}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {result?.stale && <p className="text-xs text-neutral-400 dark:text-neutral-500">{t("Sonuçlar güncelleniyor…", "Results are being refreshed…")}</p>}
          {seedItem && <OverviewCard item={seedItem} selected={v.selected.has(seedItem.term)} onToggle={() => v.toggle(seedItem.term)} onAnalyze={() => setAnalyzeTerm(seedItem.term)} season={allRes?.season ?? null} />}
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            {t("Hacim, trend, CPC, rekabet ve niyet Google aramalarına dayanır; Etsy arama hacmi değildir.", "Volume, trend, CPC, competition and intent are based on Google searches; not Etsy search volume.")}
            {measuredAt && ` ${t("Ölçüm:", "Measured:")} ${new Date(measuredAt).toLocaleDateString(locale, { dateStyle: "medium" })}.`}
            {` ${t("Etsy ilan sayısı: Etsy.", "Etsy listing count: Etsy.")}`}
          </p>

          <div role="tablist" className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
            {(
              [
                ["all", t("Tüm kelimeler", "All keywords")],
                ["questions", t("Sorular", "Questions")],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => void switchMode(m)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition ${
                  mode === m ? "border-[#D97757] text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                {label}
                {m === "all" && allRes && ` (${allRes.items.length.toLocaleString(locale)})`}
                {m === "questions" && qRes?.status === "ready" && ` (${qRes.items.length.toLocaleString(locale)})`}
              </button>
            ))}
          </div>

          <CollectionBar names={col.names} counts={col.counts} active={col.active} onChoose={col.choose} onCreate={col.create} />

          {/* Araç çubuğu: solda Etsy ilan sayısı, sağda CSV ve Yeniden araştır. Soru sekmesinde Etsy düğmesi kapalıdır (soru kalıbı Etsy'de anlamlı bir arama değil) ama yerinde durur. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              busy={measuring}
              disabled={mode !== "all" || !result || result.status !== "ready"}
              onClick={() => void measureEtsy()}
              title={mode !== "all" ? t("Soru kalıpları için Etsy ilan sayısı anlamlı değil", "Etsy listing counts are not meaningful for question patterns") : undefined}
            >
              {t(`Etsy'de kaç ilan var? (ilk ${ETSY_RESULTS_MAX})`, `How many Etsy listings? (first ${ETSY_RESULTS_MAX})`)}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!result || result.status !== "ready"} onClick={() => downloadCsv(`discover-${mode}-${(result?.seed ?? "list").replace(/\s+/g, "-")}.csv`, toCsv(v.view, etsy))}>
                {t("CSV indir", "Download CSV")}
              </Button>
              <Button
                busy={refreshing}
                disabled={waiting}
                onClick={() => void refresh()}
                title={t("Google verisini yeniden çeker ve listeyi yenisiyle değiştirir (saatte bir; günlük yeni araştırma hakkından düşer)", "Fetches the Google data again and replaces the list (once an hour; counts against your daily new searches)")}
              >
                {t("Yeniden araştır", "Research again")}
              </Button>
            </div>
          </div>

          <FilterBar
            filters={v.filters}
            onChange={v.setFilters}
            groups={v.groups}
            shown={v.view.length}
            total={result?.items.length ?? 0}
            volume={v.volume}
            rowCount={v.rows.length}
            showVariants={v.showVariants}
            onShowVariants={v.setShowVariants}
          />

          <div className="min-h-[16rem]">{listRegion()}</div>
        </div>
      )}

      {detail && (
        <KeywordDetailModal
          shopId={shopId}
          item={detail}
          onClose={() => setDetail(null)}
          onAnalyze={mode === "all" ? (term) => { setDetail(null); setAnalyzeTerm(term); } : undefined}
        />
      )}
      {analyzeTerm && <EtsyTopModal shopId={shopId} term={analyzeTerm} onClose={() => setAnalyzeTerm(null)} />}
      {v.selected.size > 0 && <SaveBar count={v.selected.size} collection={col.active} busy={saving} onAdd={() => void addSelected()} />}
    </div>
  );
}

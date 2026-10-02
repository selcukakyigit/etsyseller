"use client";

import { ClipboardEvent, useEffect, useRef, useState } from "react";
import { api, EtsyDataParsed, EtsyDataSaved, EtsyDataSource } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { toast } from "@/lib/toast";

type Loaded = { rows: EtsyDataSaved[]; to_check: { keyword: string; listing_id: number; listing_title: string }[] };

const input =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

/** Etsy verisi sekmesi: Etsy panelinden kopyalanan tablo ya da ekran görüntüsü → yapay zekâ okur → kontrol edip kaydet.
 * Kaydedilen veri kelime havuzunda rozet olur, listing'i getiren aramalar sıra takibine eklenir, AI önerisi bunlara öncelik verir. */
export default function EtsyDataTab({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t, locale } = useT();
  const [data, setData] = useCached<Loaded>(`etsy-data:${shopId}:${listingId}`);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [parsed, setParsed] = useState<(EtsyDataParsed & { selected: boolean[] }) | null>(null);
  const [busy, setBusy] = useState<"" | "parse" | "save">("");
  const fileInput = useRef<HTMLInputElement>(null);

  const sourceLabel: Record<EtsyDataSource, string> = {
    marketplace_insights: t("Marketplace Insights (aylık arama, rekabet)", "Marketplace Insights (monthly searches, competition)"),
    search_terms: t("Arama terimleri (listing'i getiren aramalar)", "Search terms (searches that brought visits)"),
    ads: t("Etsy Ads arama terimleri", "Etsy Ads search queries"),
  };
  const compLabel = { low: t("düşük", "low"), medium: t("orta", "medium"), high: t("yüksek", "high") };

  async function load() {
    try {
      setData(await api.insights.listingEtsyData(shopId, listingId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("Veri yüklenemedi", "Could not load the data"));
    }
  }

  useEffect(() => {
    let cancelled = false;
    api.insights
      .listingEtsyData(shopId, listingId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error && e.message ? e.message : t("Veri yüklenemedi", "Could not load the data"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, listingId, setData]);

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      e.preventDefault();
      setImage(file);
    }
  }

  async function parse() {
    setBusy("parse");
    try {
      const r = await api.insights.parseEtsyData(shopId, { text: text.trim() || undefined, image: image ?? undefined });
      setParsed({ ...r, selected: r.rows.map(() => true) });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("Okunamadı", "Could not read it"));
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!parsed) return;
    const rows = parsed.rows.filter((_, i) => parsed.selected[i]);
    if (!rows.length) return;
    setBusy("save");
    try {
      const r = await api.insights.saveEtsyData(shopId, { listing_id: listingId, source: parsed.source, period_start: parsed.period_start, period_end: parsed.period_end, rows });
      toast.success(
        r.tracked.length
          ? t(`${r.saved} satır kaydedildi; sıra takibine eklendi: ${r.tracked.join(", ")}`, `${r.saved} rows saved; added to rank tracking: ${r.tracked.join(", ")}`)
          : t(`${r.saved} satır kaydedildi`, `${r.saved} rows saved`),
      );
      setParsed(null);
      setText("");
      setImage(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("Kaydedilemedi", "Could not save"));
    } finally {
      setBusy("");
    }
  }

  async function remove(ids: number[]) {
    try {
      await api.insights.deleteEtsyData(shopId, ids);
      await load();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("Silinemedi", "Could not delete"));
    }
  }

  const num = (n: number | null) => (n === null || n === undefined ? "–" : n.toLocaleString(locale));
  const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  const groups = (Object.keys(sourceLabel) as EtsyDataSource[]).map((s) => [s, data.rows.filter((r) => r.source === s)] as const).filter(([, rows]) => rows.length);

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        {t(
          "Etsy bu verileri API'de vermiyor. Etsy panelinde Stats > Marketplace Insights, listing istatistiklerindeki arama terimleri ya da Etsy Ads arama terimleri tablosunu kopyalayıp buraya yapıştır (ya da ekran görüntüsünü bırak). Kaydedilen kelimeler Kelime Havuzu'nda rozet olur, AI önerisi bunlara öncelik verir; listing'i getiren aramalar sıra takibine eklenir.",
          "Etsy does not provide this data through its API. In your Etsy dashboard, copy the Stats > Marketplace Insights table, the listing's search terms or the Etsy Ads search queries and paste it here (or drop a screenshot). Saved keywords get badges in the Keyword pool, the AI suggestion prioritizes them, and searches that bring visits are added to rank tracking.",
        )}
      </p>

      {data.to_check.length > 0 && (
        <div className="rounded-xl border border-[#D97757]/30 bg-[#D97757]/5 p-3 text-xs dark:bg-[#D97757]/10">
          <p className="mb-1.5 font-semibold text-[#B4553A] dark:text-[#E89A7F]">
            {t("Bu hafta Marketplace Insights'ta bak (15 ücretsiz arama hakkın var)", "Check these in Marketplace Insights this week (you have 15 free searches)")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.to_check.map((k) => (
              <span key={k.keyword} title={k.listing_title} className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                {k.keyword}
              </span>
            ))}
          </div>
        </div>
      )}

      {!parsed ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            rows={5}
            placeholder={t("Etsy'den kopyaladığın tabloyu buraya yapıştır (ekran görüntüsünü de yapıştırabilirsin)", "Paste the table you copied from Etsy here (you can also paste a screenshot)")}
            className={`${input} font-mono text-xs`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              🖼 {image ? image.name : t("Ekran görüntüsü seç", "Choose a screenshot")}
            </button>
            {image && (
              <button type="button" onClick={() => setImage(null)} className="text-xs text-neutral-500 underline dark:text-neutral-400">
                {t("Kaldır", "Remove")}
              </button>
            )}
            <button
              type="button"
              disabled={!!busy || (!text.trim() && !image)}
              onClick={() => void parse()}
              className="ml-auto rounded-lg bg-[#D97757] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#C6613F] disabled:opacity-40"
            >
              {t("Oku", "Read")}
            </button>
            {busy === "parse" && <Spinner size={16} />}
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-white p-3 dark:border-amber-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {t("HENÜZ KAYDEDİLMEDİ", "NOT SAVED YET")}
            </span>
            <select
              value={parsed.source}
              onChange={(e) => setParsed({ ...parsed, source: e.target.value as EtsyDataSource })}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            >
              {(Object.keys(sourceLabel) as EtsyDataSource[]).map((s) => (
                <option key={s} value={s}>
                  {sourceLabel[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-500 dark:text-neutral-400">
                  <th className="w-6 py-1" />
                  <th className="py-1 font-medium">{t("Arama", "Search")}</th>
                  <th className="py-1 font-medium">{t("Aylık arama", "Monthly searches")}</th>
                  <th className="py-1 font-medium">{t("Rekabet", "Competition")}</th>
                  <th className="py-1 font-medium">{t("Görüntülenme", "Views")}</th>
                  <th className="py-1 font-medium">{t("Tıklama", "Clicks")}</th>
                  <th className="py-1 font-medium">{t("Sipariş", "Orders")}</th>
                </tr>
              </thead>
              <tbody className="text-neutral-700 dark:text-neutral-300">
                {parsed.rows.map((r, i) => (
                  <tr key={r.keyword} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1">
                      <input
                        type="checkbox"
                        checked={parsed.selected[i]}
                        onChange={(e) => setParsed({ ...parsed, selected: parsed.selected.map((v, j) => (j === i ? e.target.checked : v)) })}
                      />
                    </td>
                    <td className="py-1 font-medium text-neutral-900 dark:text-neutral-100">{r.keyword}</td>
                    <td className="py-1">{num(r.searches)}</td>
                    <td className="py-1">{r.competition ? compLabel[r.competition] : num(r.listings_count)}</td>
                    <td className="py-1">{num(r.views)}</td>
                    <td className="py-1">{num(r.clicks)}</td>
                    <td className="py-1">{num(r.orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setParsed(null)} disabled={!!busy} className="text-sm text-neutral-600 hover:underline dark:text-neutral-300">
              {t("Vazgeç", "Cancel")}
            </button>
            <button
              type="button"
              disabled={!!busy || !parsed.selected.some(Boolean)}
              onClick={() => void save()}
              className="rounded-lg bg-[#D97757] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#C6613F] disabled:opacity-40"
            >
              {busy === "save" ? t("Kaydediliyor…", "Saving…") : t(`Seçilenleri kaydet (${parsed.selected.filter(Boolean).length})`, `Save selected (${parsed.selected.filter(Boolean).length})`)}
            </button>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Bu listing için henüz Etsy verisi yok.", "No Etsy data for this listing yet.")}</p>
      ) : (
        groups.map(([source, rows]) => (
          <div key={source}>
            <p className="mb-1.5 text-xs font-medium text-neutral-400 dark:text-neutral-500">{sourceLabel[source]}</p>
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <table className="w-full min-w-[520px] text-xs">
                <tbody className="text-neutral-700 dark:text-neutral-300">
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-neutral-50 last:border-0 dark:border-neutral-800/60">
                      <td className="px-3 py-1.5 font-medium text-neutral-900 dark:text-neutral-100">{r.keyword}</td>
                      {source === "marketplace_insights" ? (
                        <>
                          <td className="px-3 py-1.5">{t(`${num(r.searches)} arama/ay`, `${num(r.searches)} searches/mo`)}</td>
                          <td className="px-3 py-1.5">{r.competition ? `${t("rekabet", "competition")}: ${compLabel[r.competition]}` : r.listings_count !== null ? t(`${num(r.listings_count)} listing`, `${num(r.listings_count)} listings`) : ""}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-1.5">{t(`${num(r.views)} görüntülenme`, `${num(r.views)} views`)}</td>
                          <td className="px-3 py-1.5">{t(`${num(r.clicks)} tıklama · ${num(r.orders)} sipariş`, `${num(r.clicks)} clicks · ${num(r.orders)} orders`)}</td>
                        </>
                      )}
                      <td className="px-3 py-1.5 text-neutral-400 dark:text-neutral-500">{fmtDay(r.captured_on)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button type="button" onClick={() => void remove([r.id])} title={t("Sil", "Delete")} className="rounded-full px-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

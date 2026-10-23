"use client";

import { Fragment, useState } from "react";
import { Button } from "@/components/admin/ui";
import type { DiscoverItem } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import Sparkline from "./Sparkline";
import { Row, Sort, SortKey, opportunity } from "./table";
import { useIntentLabel } from "./shared";

const PAGE = 100;

// Zebra: ardışık satırlar iki yakın gri tonda, seçili satır marka renginde; göz satırı kaybetmesin.
const ZEBRA = ["bg-white dark:bg-neutral-900", "bg-neutral-100/70 dark:bg-neutral-800/60"];
const SELECTED = "bg-[#D97757]/10 dark:bg-[#D97757]/15";

/** Sonuç tablosu: sabit yükseklikte, kendi içinde kayar (sayfayı uzatmaz) ve başlığı yapışkandır. Sıralanabilir sütunlar (aylık arama, trend, CPC, rekabet, Etsy ilan sayısı),
 * seçim kutuları, "sende var" / "kalabalık" işaretleri ve varyant grupları (aynı aramanın söz dizimi varyantları tek satırda, "+N" ile açılır).
 * Aylık arama, CPC ve rekabet GOOGLE verisidir (Etsy arama hacmi değil); sütun başlıklarındaki ipucu bunu söyler. */
export default function KeywordTable({
  rows,
  selected,
  onToggle,
  onToggleMany,
  sort,
  onSort,
  etsy,
  showEtsy,
  emptyText,
  onRemove,
  collect,
}: {
  rows: Row[];
  selected: Set<string>;
  onToggle: (term: string) => void;
  onToggleMany: (terms: string[], checked: boolean) => void;
  sort: Sort;
  onSort: (key: SortKey) => void;
  etsy: Record<string, number | null>;
  showEtsy: boolean;
  emptyText: string;
  onRemove?: (term: string) => void;
  /** Satır başına yeşil + (aktif koleksiyona tek dokunuşla ekle) / ✓ (koleksiyonda; dokununca çıkar). `active` null ise düğme kapalıdır. */
  collect?: { active: string | null; has: (term: string) => boolean; onAdd: (term: string) => void; onRemove: (term: string) => void };
}) {
  const { t, locale } = useT();
  const intentLabel = useIntentLabel();
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const visible = rows.slice(0, shown);
  const allChecked = visible.length > 0 && visible.every((r) => selected.has(r.item.term));
  const num = (n: number | null) => (n === null ? "—" : n.toLocaleString(locale));
  const toggleOpen = (term: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });

  const th = "px-2 py-2 font-medium";
  const head = (key: SortKey, label: string, hint?: string, align: "left" | "right" = "right") => (
    <th scope="col" className={`${th} ${align === "right" ? "text-right" : "text-left"}`} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(key)} title={hint} className={`inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100 ${sort.key === key ? "text-neutral-900 dark:text-neutral-100" : ""}`}>
        {label}
        <span aria-hidden className="text-[10px]">{sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  if (rows.length === 0) return <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">{emptyText}</p>;

  let zebra = 0;
  const renderRow = (r: DiscoverItem, rep: DiscoverItem, variantCount: number, isVariant: boolean) => {
    const intent = intentLabel(r.intent);
    const count = etsy[r.term] !== undefined ? etsy[r.term] : etsy[rep.term]; // varyantlar için Etsy aynı aramayı sayar: temsilcinin sayısı geçerli
    const ratio = opportunity(r.volume, count);
    const tone = selected.has(r.term) ? SELECTED : ZEBRA[zebra++ % 2];
    return (
      <tr key={r.term} className={`${tone} ${isVariant ? "text-neutral-500 dark:text-neutral-400" : ""}`}>
        <td className="px-3 py-1.5">
          <input type="checkbox" checked={selected.has(r.term)} onChange={() => onToggle(r.term)} aria-label={r.term} className="h-4 w-4 accent-[#D97757]" />
        </td>
        {collect && (
          <td className="px-1 py-1.5">
            {collect.has(r.term) ? (
              <button
                type="button"
                onClick={() => collect.onRemove(r.term)}
                aria-label={t(`${r.term}: koleksiyondan çıkar`, `${r.term}: remove from collection`)}
                title={t("Koleksiyonda. Çıkarmak için dokun.", "In the collection. Tap to remove.")}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700 hover:bg-green-200 dark:bg-green-950 dark:text-green-400 dark:hover:bg-green-900"
              >
                ✓
              </button>
            ) : (
              <button
                type="button"
                onClick={() => collect.onAdd(r.term)}
                disabled={collect.active === null}
                aria-label={t(`${r.term}: koleksiyona ekle`, `${r.term}: add to collection`)}
                title={collect.active === null ? t("Önce bir koleksiyon oluştur", "Create a collection first") : t("Koleksiyona ekle", "Add to collection")}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-base font-bold leading-none text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-green-500 dark:hover:bg-green-400"
              >
                +
              </button>
            )}
          </td>
        )}
        <td className={`max-w-[22rem] py-1.5 pr-2 ${isVariant ? "pl-7" : "pl-2"}`}>
          <span className={isVariant ? "" : "font-medium text-neutral-900 dark:text-neutral-100"}>{r.term}</span>
          {variantCount > 0 && (
            <button
              type="button"
              onClick={() => toggleOpen(r.term)}
              aria-expanded={open.has(r.term)}
              title={t("Aynı aramanın söz dizimi varyantları (kelime sırası, çoğul, 'for/the…'): aynı Google hacmi ve Etsy ilan sayısı", "Wording variants of the same search (word order, plural, 'for/the…'): same Google volume and Etsy listing count")}
              className="ml-2 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600"
            >
              {open.has(r.term) ? "−" : "+"}
              {variantCount}
            </button>
          )}
          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
            {r.mine && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" title={t("Listing'lerinde zaten etiket olarak var", "Already a tag on your listings")}>✓ {t("Sende var", "You use it")}</span>}
            {r.crowded && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300" title={t("Son günlerde birçok mağazaya önerildi; herkes aynı kelimeyle yarışır.", "Recently suggested to many shops; everyone competes for the same word.")}>⚑ {t("Kalabalık", "Crowded")}</span>}
          </span>
        </td>
        <td className="px-2 py-1.5">{intent && <span className="whitespace-nowrap rounded-full bg-neutral-200/70 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-700/60 dark:text-neutral-300">{intent}</span>}</td>
        <td className="px-2 py-1.5 text-right tabular-nums font-medium text-neutral-900 dark:text-neutral-100">{r.volume === null ? <span className="text-neutral-300 dark:text-neutral-600" title={t("Ölçüm hazırlanıyor", "Measurement in progress")}>…</span> : num(r.volume)}</td>
        <td className="px-2 py-1.5">
          <div className="flex items-center justify-end gap-2">
            {r.trend_pct !== null && <span className={`text-[11px] tabular-nums ${r.trend_pct > 10 ? "text-green-600 dark:text-green-400" : r.trend_pct < -10 ? "text-red-500 dark:text-red-400" : "text-neutral-400"}`}>{r.trend_pct > 0 ? "+" : ""}{r.trend_pct}%</span>}
            <Sparkline values={r.monthly} height={18} label={t("Son 12 ay aylık arama", "Monthly searches, last 12 months")} />
          </div>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{r.cpc === null ? "—" : `$${r.cpc.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{num(r.competition)}</td>
        {showEtsy && (
          <td className="px-2 py-1.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
            {count === undefined ? <span className="text-neutral-300 dark:text-neutral-600">·</span> : count === null ? "—" : num(count)}
            {ratio !== null && <div className="text-[10px] leading-3 text-neutral-400 dark:text-neutral-500">{ratio.toLocaleString(locale, { maximumFractionDigits: ratio < 1 ? 3 : 1 })}</div>}
          </td>
        )}
        {onRemove && (
          <td className="px-2 py-1.5 text-right">
            <button type="button" onClick={() => onRemove(r.term)} aria-label={t(`${r.term} çıkar`, `Remove ${r.term}`)} className="rounded px-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800 dark:hover:text-red-400">×</button>
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="max-h-[26rem] overflow-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 md:max-h-[32rem]">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-white text-xs text-neutral-500 shadow-[0_1px_0_0] shadow-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:shadow-neutral-800">
          <tr>
            <th scope="col" className="w-9 px-3 py-2">
              <input type="checkbox" checked={allChecked} onChange={(e) => onToggleMany(visible.map((r) => r.item.term), e.target.checked)} aria-label={t("Görünenlerin hepsini seç", "Select all shown")} className="h-4 w-4 accent-[#D97757]" />
            </th>
            {collect && <th scope="col" className="w-8 px-1 py-2" aria-label={t("Koleksiyona ekle", "Add to collection")} />}
            {head("term", t("Anahtar kelime", "Keyword"), undefined, "left")}
            <th scope="col" className={`${th} text-left`}>{t("Niyet", "Intent")}</th>
            {head("volume", t("Hacim", "Volume"), t("Google'da aylık arama (Etsy arama hacmi değil)", "Monthly Google searches (not Etsy search volume)"))}
            {head("trend", t("Trend", "Trend"), t("Son 12 ay; yüzde: son 3 ay ilk 3 aya göre", "Last 12 months; percent: last 3 months vs first 3"))}
            {head("cpc", "CPC", t("Google Ads tıklama başına ortalama maliyet (USD)", "Average Google Ads cost per click (USD)"))}
            {head("competition", t("Rekabet", "Comp."), t("Google Ads reklam rekabeti 0–100 (Etsy rekabeti değil)", "Google Ads ad competition 0–100 (not Etsy competition)"))}
            {showEtsy && head("etsy", t("Etsy ilan", "Etsy listings"), t("Etsy'de bu aramada aktif ilan sayısı; altındaki sayı: aylık arama ÷ ilan (yüksek = az rekabetle çok arama)", "Active listings on Etsy for this search; the number below: monthly searches ÷ listings (high = lots of searches, little competition)"))}
            {onRemove && <th scope="col" className="w-10 px-2 py-2" />}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <Fragment key={row.item.term}>
              {renderRow(row.item, row.item, row.variants.length, false)}
              {open.has(row.item.term) && row.variants.map((v) => renderRow(v, row.item, 0, true))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {rows.length > shown && (
        <div className="flex justify-center border-t border-neutral-100 p-2 dark:border-neutral-800">
          <Button onClick={() => setShown((n) => n + PAGE)}>{t(`Daha fazla göster (${(rows.length - shown).toLocaleString(locale)})`, `Show more (${(rows.length - shown).toLocaleString(locale)})`)}</Button>
        </div>
      )}
    </div>
  );
}

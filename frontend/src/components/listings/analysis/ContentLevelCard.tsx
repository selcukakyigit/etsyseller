"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ContentAudit, ContentLevel } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { T, useT } from "@/lib/i18n-client";
import HelpTip from "@/components/ui/HelpTip";
import { FocusKey } from "./NextStepCard";

type Finding = ContentAudit["findings"][number];
type Dim = "seo" | "aeo" | "geo";

export const DIMS: Dim[] = ["seo", "aeo", "geo"];
export const LEVEL_DOT: Record<ContentLevel, string> = { good: "bg-emerald-500", mid: "bg-amber-500", weak: "bg-red-500" };
const PILL: Record<ContentLevel, string> = {
  good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  mid: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  weak: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};
export const levelText = (t: T): Record<ContentLevel, string> => ({ good: t("iyi", "good"), mid: t("orta", "fair"), weak: t("zayıf", "weak") });
const dimTip = (t: T): Record<Dim, string> => ({
  seo: t("Etsy aramasında eşleşme: başlık, etiketler, kategori ve özellikler.", "Matching in Etsy search: title, tags, category and attributes."),
  aeo: t("Alıcının sorusuna doğrudan cevap: açılış cümlesi, olgu listesi, soru-cevap.", "Direct answers to buyer questions: opening sentence, fact list, Q&A."),
  geo: t("Yapay zekâ asistanlarının (ChatGPT, Google AI…) listing'i güvenle önerebilmesi: tutarlı, doğrulanabilir, eksiksiz veri.", "AI assistants (ChatGPT, Google AI…) being able to recommend the listing: consistent, verifiable, complete data."),
});

// Bulgunun düzenlendiği alan → düzenleyicinin odak modu (bkz. NextStepCard FocusKey).
export const AREA_FOCUS: Record<string, FocusKey> = { title: "title_tags", tags: "title_tags", description: "description", alt_text: "photo", attributes: "attributes" };

/** Bir boyutun bulgularını düzeltmek için düzenleyici bağlantısı: tek alanlıysa o alanın odak modunda, birden çok alanlıysa tam formda açılır; bulgular `fix` ile taşınır. */
export function fixHref(listingId: number, findings: Finding[]): string {
  const focuses = new Set(findings.filter((f) => f.fix).map((f) => AREA_FOCUS[f.fix as string]));
  const fix = `fix=${encodeURIComponent(findings.map((f) => f.id).join(","))}`;
  return `/listings/${listingId}/edit?${focuses.size === 1 ? `focus=${[...focuses][0]}&` : ""}${fix}`;
}

/** Üç gösterge (SEO / AEO / GEO) ve ayrıntıya açılan bulgu listesi. `listingId` verilirse boyut satırlarında "Düzelt" düğmesi çıkar.
 * `stepFocus`: Sıradaki Adım'ın bu turdaki alanı; o alandaki bulgular "bu tur" diye işaretlenir. */
export function ContentLevelView({ audit, listingId, stepFocus }: { audit: ContentAudit; listingId?: number; stepFocus?: FocusKey | null }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const text = levelText(t);
  const tips = dimTip(t);
  const inRound = (f: Finding) => !!stepFocus && !!f.fix && (AREA_FOCUS[f.fix] === stepFocus || stepFocus === "text" || stepFocus === "overhaul");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {t("İçerik seviyesi", "Content level")}
          <HelpTip>
            {t(
              "Listing metninin Etsy aramasına ve yapay zekâ alışveriş asistanlarına ne kadar hazır olduğunu gösterir. Ücretsizdir, yapay zekâ kullanmaz. Bir boyutun \"Düzelt\" düğmesi o boyuttaki tüm bulguları tek seferde düzeltir; başlık değişikliği Etsy sıralamasını etkileyebileceği için başlığa dokunmak ayrıca onay ister.",
              "Shows how ready the listing text is for Etsy search and AI shopping assistants. Free, no AI is used. A dimension's \"Fix\" button fixes all of its findings in one pass; a title change can affect Etsy ranking, so touching the title needs a separate confirmation.",
            )}
          </HelpTip>
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[audit.level]}`}>{text[audit.level]}</span>
      </div>

      <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
        {DIMS.map((d) => {
          const mine = audit.findings.filter((f) => f.dim === d);
          const info = audit.dims[d];
          return (
            <li key={d} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-10 font-semibold text-neutral-800 dark:text-neutral-200" title={tips[d]}>
                {d.toUpperCase()}
              </span>
              <span className="flex w-24 items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[info.level]}`} />
                {text[info.level]}
              </span>
              <span className="flex-1 text-xs text-neutral-500 dark:text-neutral-400">
                {mine.length > 0 ? t(`${mine.length} bulgu`, `${mine.length} findings`) : "—"}
                {mine.some(inRound) && <span className="ml-1.5 rounded bg-[#D97757]/15 px-1 text-[10px] font-semibold text-[#B4553A] dark:text-[#E89A7F]">{t("bu tur", "this round")}</span>}
              </span>
              {listingId !== undefined && mine.length > 0 && (
                <Link href={fixHref(listingId, mine)} className="text-xs font-medium text-[#D97757] hover:text-[#C6613F]">
                  {t("Düzelt", "Fix")}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {audit.findings.length > 0 && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
          {open ? t("Ayrıntıları gizle", "Hide details") : t("Ayrıntıları göster", "Show details")}
        </button>
      )}
      {open && (
        <ul className="mt-2 space-y-2">
          {audit.findings.map((f) => (
            <li key={f.id} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${f.weight >= 2 ? "bg-red-500" : "bg-amber-500"}`} />
              <span>
                <span className="mr-1.5 rounded bg-neutral-100 px-1 text-[10px] font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">{f.dim.toUpperCase()}</span>
                {f.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Teşhis sekmesindeki kart: Etsy'deki (yayınlanmış) hâlin içerik seviyesi. */
export default function ContentLevelCard({ shopId, listingId, stepFocus }: { shopId: number; listingId: number; stepFocus?: FocusKey | null }) {
  const [a, setA] = useCached<ContentAudit>(`content:${shopId}:${listingId}`);

  useEffect(() => {
    let cancelled = false;
    api.insights.content(shopId, listingId).then((r) => !cancelled && setA(r), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [shopId, listingId, setA]);

  if (!a) return null;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <ContentLevelView audit={a} listingId={listingId} stepFocus={stepFocus} />
    </div>
  );
}

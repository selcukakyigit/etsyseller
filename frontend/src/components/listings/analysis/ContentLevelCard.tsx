"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ContentAudit, ContentLevel } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { T, useT } from "@/lib/i18n-client";
import HelpTip from "@/components/ui/HelpTip";
import type { FocusKey } from "./NextStepCard";

export type Finding = ContentAudit["findings"][number];
type Dim = "seo" | "aeo" | "geo";

export const DIMS: Dim[] = ["seo", "aeo", "geo"];
export const LEVEL_DOT: Record<ContentLevel, string> = { good: "bg-emerald-500", mid: "bg-amber-500", weak: "bg-red-500" };
const PILL: Record<ContentLevel, string> = {
  good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  mid: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  weak: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};
export const levelText = (t: T): Record<ContentLevel, string> => ({ good: t("iyi", "good"), mid: t("orta", "fair"), weak: t("zayıf", "weak") });

// SEO temeldir; AEO ve GEO opsiyonel öneridir (backend audit.OPTIONAL_DIMS): küçük eksikler alarm gibi görünmesin.
const OPTIONAL: Dim[] = ["aeo", "geo"];
export const dimDot = (d: Dim, level: ContentLevel) => (OPTIONAL.includes(d) && level === "mid" ? "bg-sky-500" : LEVEL_DOT[level]);
export const dimLevelText = (t: T, d: Dim, level: ContentLevel) =>
  OPTIONAL.includes(d) && level === "mid" ? t("öneri var", "suggestions") : levelText(t)[level];
const dimTip = (t: T): Record<Dim, string> => ({
  seo: t("Etsy aramasında eşleşme: başlık, etiketler, kategori ve özellikler.", "Matching in Etsy search: title, tags, category and attributes."),
  aeo: t("Alıcının sorusuna doğrudan cevap: açılış cümlesi, olgu listesi, soru-cevap.", "Direct answers to buyer questions: opening sentence, fact list, Q&A."),
  geo: t("Yapay zekâ asistanlarının (ChatGPT, Google AI…) listing'i güvenle önerebilmesi: tutarlı, doğrulanabilir, eksiksiz veri.", "AI assistants (ChatGPT, Google AI…) being able to recommend the listing: consistent, verifiable, complete data."),
});

// Bulgunun düzenlendiği alan → düzenleyicinin odak modu (bkz. NextStepCard FocusKey).
export const AREA_FOCUS: Record<string, FocusKey> = { title: "title_tags", tags: "title_tags", description: "description", alt_text: "photo", attributes: "attributes" };
const areaLabel = (t: T): Record<string, string> => ({
  title: t("başlık", "title"),
  tags: t("etiketler", "tags"),
  description: t("açıklama", "description"),
  attributes: t("özellikler", "attributes"),
  alt_text: t("alt metin", "alt text"),
});
const AI_AREAS = ["title", "tags", "description"];

/** Bulguların düzeltileceği düzenleyici bağlantısı: tek alanlıysa o alanın odak modunda, birden çok alanlıysa tam formda açılır; bulgular `fix` ile taşınır. */
export function fixHref(listingId: number, findings: Finding[], opts: { touchTitle?: boolean } = {}): string {
  const focuses = new Set(findings.filter((f) => f.fix).map((f) => AREA_FOCUS[f.fix as string]));
  const fix = `fix=${encodeURIComponent(findings.map((f) => f.id).join(","))}`;
  const focus = focuses.size === 1 ? [...focuses][0] : null;
  return `/listings/${listingId}/edit?${focus ? `focus=${focus}&` : ""}${fix}${opts.touchTitle ? "&title=1" : ""}`;
}

/** Sıradaki Adım'ın bulguları: adım başlık-etiketse SEO boyutunun tamamı (başlık, etiketler, özellikler, çakışma: Etsy aramasındaki eşleşme), açıklamaysa açıklama alanındaki bulgular
 * (AEO + GEO dahil), kapsamlıysa metin alanlarının hepsi. Adımın düğmesi bunları tek seferde düzeltir. */
export function findingsForStep(audit: ContentAudit | null | undefined, step: FocusKey | null): Finding[] {
  if (!audit || !step) return [];
  if (step === "title_tags") return audit.findings.filter((f) => f.dim === "seo");
  const text = step === "text" || step === "overhaul";
  return audit.findings.filter((f) => !!f.fix && (AREA_FOCUS[f.fix] === step || (text && AI_AREAS.includes(f.fix))));
}

/** Teşhis sekmesi: içerik denetimi (Etsy'deki yayınlanmış hâl). Birden çok yerde kullanılır; istek bir kez yapılır ve önbellekten paylaşılır. */
export function useContentAudit(shopId: number, listingId: number): ContentAudit | null {
  const [a, setA] = useCached<ContentAudit>(`content:${shopId}:${listingId}`);
  useEffect(() => {
    let cancelled = false;
    api.insights.content(shopId, listingId).then((r) => !cancelled && setA(r), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [shopId, listingId, setA]);
  return a ?? null;
}

const btnPrimary = "rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C6613F]";
const btnGhost = "rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-[#B4553A] hover:bg-neutral-100 dark:border-neutral-700 dark:text-[#E89A7F] dark:hover:bg-neutral-800";

/** Üç gösterge (SEO / AEO / GEO): her satırda ilk bulgunun özeti, hangi alanlara dokunulacağı, yapay zekâ gerekip gerekmediği ve "Düzelt"; üstte tüm bulgular için "Hepsini düzelt".
 * `listingId` verilirse düğmeler çıkar. `stepFocus`: Sıradaki Adım'ın bu turdaki alanı; o alandaki bulgular "bu tur" diye işaretlenir. */
export function ContentLevelView({ audit, listingId, stepFocus, showTitle = true }: { audit: ContentAudit; listingId?: number; stepFocus?: FocusKey | null; showTitle?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const text = levelText(t);
  const tips = dimTip(t);
  const areas = areaLabel(t);
  const inRound = (f: Finding) => !!stepFocus && !!f.fix && (AREA_FOCUS[f.fix] === stepFocus || stepFocus === "text" || stepFocus === "overhaul");
  const actionable = audit.findings.filter((f) => f.fix);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {showTitle && (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {t("İçerik seviyesi", "Content level")}
          <HelpTip>
            {t(
              "Listing metninin Etsy aramasına ve yapay zekâ alışveriş asistanlarına ne kadar hazır olduğunu gösterir. Ücretsizdir, yapay zekâ kullanmaz. SEO temeldir, AEO ve GEO isteğe bağlı önerilerdir. Bir boyutun \"Düzelt\" düğmesi o boyuttaki bulguları tek seferde düzeltir; \"Hepsini düzelt\" üç boyutu birlikte, alanlara göre birleştirerek (örneğin açıklamayı bir kez) düzeltir. Başlık değişikliği Etsy sıralamasını etkileyebileceği için başlığa dokunmak ayrıca onay ister.",
              "Shows how ready the listing text is for Etsy search and AI shopping assistants. Free, no AI is used. SEO is the core; AEO and GEO are optional suggestions. A dimension's \"Fix\" button fixes its findings in one pass; \"Fix all\" fixes all three together, merged by area (for example the description once). A title change can affect Etsy ranking, so touching the title needs a separate confirmation.",
            )}
          </HelpTip>
        </span>
        )}
        {showTitle && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[audit.level]}`}>{text[audit.level]}</span>}
        {listingId !== undefined && actionable.length > 0 && (
          <Link href={fixHref(listingId, audit.findings.filter((f) => f.fix))} className={`${btnPrimary} ml-auto`}>
            {t("Hepsini düzelt", "Fix all")}
          </Link>
        )}
      </div>

      <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
        {DIMS.map((d) => {
          const mine = audit.findings.filter((f) => f.dim === d);
          const info = audit.dims[d];
          const touched = [...new Set(mine.filter((f) => f.fix).map((f) => f.fix as string))];
          const usesAi = touched.some((a) => AI_AREAS.includes(a));
          return (
            <li key={d} className="py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <span className="w-10 font-semibold text-neutral-800 dark:text-neutral-200" title={tips[d]}>
                  {d.toUpperCase()}
                </span>
                <span className="flex w-24 flex-shrink-0 items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className={`h-2 w-2 rounded-full ${dimDot(d, info.level)}`} />
                  {dimLevelText(t, d, info.level)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-neutral-600 dark:text-neutral-300">
                  {mine.length > 0 ? mine[0].text : t("Sorun yok", "No issues")}
                </span>
                {mine.some(inRound) && <span className="rounded bg-[#D97757]/15 px-1 text-[10px] font-semibold text-[#B4553A] dark:text-[#E89A7F]">{t("bu tur", "this round")}</span>}
                {listingId !== undefined && touched.length > 0 && (
                  <Link href={fixHref(listingId, mine)} className={btnGhost}>
                    {t("Düzelt", "Fix")}
                  </Link>
                )}
              </div>
              {mine.length > 0 && (
                <p className="mt-1 pl-[3.25rem] text-[11px] text-neutral-500 dark:text-neutral-400">
                  {t(`${mine.length} bulgu`, `${mine.length} findings`)}
                  {touched.length > 0 && ` · ${touched.map((a) => areas[a] ?? a).join(", ")}`}
                  {touched.length > 0 && ` · ${usesAi ? t("yapay zekâ", "AI") : t("yapay zekâsız", "no AI")}`}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
        {t("SEO temeldir. AEO ve GEO isteğe bağlı önerilerdir: Etsy'nin zorunlu şartı değildir ve genel seviyeyi düşürmez.", "SEO is the core. AEO and GEO are optional suggestions: they are not an Etsy requirement and do not lower the overall level.")}
      </p>
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

/** Teşhis sekmesindeki katlanır panel: Etsy'deki (yayınlanmış) hâlin içerik seviyesi. Kapalıyken yalnızca genel seviye ve üç gösterge görünür;
 * ana akış Sıradaki Adım kartıdır, burası diğer alanlara bakmak içindir. `defaultOpen`: Sıradaki Adım'ın düzelteceği bulgu yoksa açık başlar. */
export default function ContentLevelCard({ audit, listingId, stepFocus, defaultOpen = false }: { audit: ContentAudit | null; listingId: number; stepFocus?: FocusKey | null; defaultOpen?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(defaultOpen);
  if (!audit) return null;
  const text = levelText(t);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-4 text-left">
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("İçerik seviyesi", "Content level")}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[audit.level]}`}>{text[audit.level]}</span>
        <span className="flex items-center gap-3 text-xs text-neutral-600 dark:text-neutral-400">
          {DIMS.map((d) => (
            <span key={d} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${dimDot(d, audit.dims[d].level)}`} />
              {d.toUpperCase()}
            </span>
          ))}
        </span>
        <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-neutral-100 px-4 pb-4 pt-2 dark:border-neutral-800">
          <ContentLevelView audit={audit} listingId={listingId} stepFocus={stepFocus} showTitle={false} />
        </div>
      )}
    </div>
  );
}

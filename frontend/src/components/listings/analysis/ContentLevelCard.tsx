"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ContentAudit, ContentLevel } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import HelpTip from "@/components/ui/HelpTip";

const DOT: Record<ContentLevel, string> = { good: "bg-emerald-500", mid: "bg-amber-500", weak: "bg-red-500" };
const PILL: Record<ContentLevel, string> = {
  good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  mid: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  weak: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};
// Düzenleyicinin odak modları (bkz. NextStepCard FOCUS_KEYS): yalnızca ilgili alan açılır.
const FOCUS: Record<string, string> = { title: "title_tags", tags: "title_tags", description: "description", alt_text: "photo" };
const SHOWN = 5;

/** İçerik seviyesi: SEO (Etsy aramasında eşleşme), AEO (alıcının sorusuna cevap), GEO (yapay zekâ asistanlarının güvenle önerebilmesi) + bulgular. Ücretsiz, yapay zekâ çağırmaz. */
export default function ContentLevelCard({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t } = useT();
  const [a, setA] = useCached<ContentAudit>(`content:${shopId}:${listingId}`);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.insights.content(shopId, listingId).then((r) => !cancelled && setA(r), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [shopId, listingId, setA]);

  if (!a) return null;
  const levelText: Record<ContentLevel, string> = { good: t("iyi", "good"), mid: t("orta", "fair"), weak: t("zayıf", "weak") };
  const dims = [
    { key: "seo" as const, label: "SEO", tip: t("Etsy aramasında eşleşme: başlık, etiketler, kategori ve özellikler.", "Matching in Etsy search: title, tags, category and attributes.") },
    { key: "aeo" as const, label: "AEO", tip: t("Alıcının sorusuna doğrudan cevap: açılış cümlesi, olgu listesi, soru-cevap.", "Direct answers to buyer questions: opening sentence, fact list, Q&A.") },
    { key: "geo" as const, label: "GEO", tip: t("Yapay zekâ asistanlarının (ChatGPT, Google AI…) listing'i güvenle önerebilmesi: tutarlı, doğrulanabilir, eksiksiz veri.", "AI assistants (ChatGPT, Google AI…) being able to recommend the listing: consistent, verifiable, complete data.") },
  ];
  const list = all ? a.findings : a.findings.slice(0, SHOWN);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {t("İçerik seviyesi", "Content level")}
          <HelpTip>
            {t(
              "Listing metninin Etsy aramasına ve yapay zekâ alışveriş asistanlarına ne kadar hazır olduğunu gösterir. Ücretsizdir, yapay zekâ kullanmaz. Başlık değişikliği sıralamayı etkileyebilir; açıklamaya ekleme ve özellik doldurma başlığa dokunmaz.",
              "Shows how ready the listing text is for Etsy search and AI shopping assistants. Free, no AI is used. Title changes can affect ranking; adding to the description or filling attributes does not touch the title.",
            )}
          </HelpTip>
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[a.level]}`}>{levelText[a.level]}</span>
        <span className="flex items-center gap-3 text-xs text-neutral-600 dark:text-neutral-400">
          {dims.map((d) => (
            <span key={d.key} className="flex items-center gap-1" title={d.tip}>
              <span className={`h-2 w-2 rounded-full ${DOT[a.dims[d.key].level]}`} />
              {d.label}
            </span>
          ))}
        </span>
      </div>

      {a.findings.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{t("Belirgin bir eksik yok.", "No obvious gaps.")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {list.map((f) => (
            <li key={f.id} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${f.weight >= 2 ? "bg-red-500" : "bg-amber-500"}`} />
              <span className="flex-1">
                <span className="mr-1.5 rounded bg-neutral-100 px-1 text-[10px] font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">{f.dim.toUpperCase()}</span>
                {f.text}
              </span>
              {f.fix && (
                <Link
                  href={`/listings/${listingId}/edit${FOCUS[f.fix] ? `?focus=${FOCUS[f.fix]}` : ""}`}
                  className="flex-shrink-0 text-xs font-medium text-[#D97757] hover:text-[#C6613F]"
                  title={f.risk === "high" ? t("Başlık değişikliği sıralamayı etkileyebilir", "A title change can affect ranking") : undefined}
                >
                  {t("Düzelt", "Fix")}
                  {f.risk === "high" ? " ⚠" : ""}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {a.findings.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
          {all ? t("Daha az göster", "Show less") : t(`${a.findings.length - SHOWN} bulgu daha`, `${a.findings.length - SHOWN} more`)}
        </button>
      )}
    </div>
  );
}

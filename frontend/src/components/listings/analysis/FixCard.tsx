"use client";

import { useEffect, useState } from "react";
import { ContentAudit, ListingDiagnosis } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { AREA_FOCUS, ContentLevelView } from "./ContentLevelCard";
import { FocusKey, focusLabel, stepFocus } from "./NextStepCard";

type Finding = ContentAudit["findings"][number];

/** Düzenleyicide, içerik denetiminden seçilen düzeltmeler (Sıradaki Adım kartının yerine geçer): hangi sorunlar düzeltiliyor, AI önerisi bunlara odaklanır;
 * yapay zekâ gerektirmeyen düzeltmeler (özellik, alt metin) ilgili bölüme götürür. "Kontrol et" formdaki güncel değerleri ücretsiz yeniden denetler. */
export default function FixCard({
  shopId,
  listingId,
  fixes,
  focus,
  onAi,
  busy,
  canTouchTitle,
  touchTitle,
  onTouchTitle,
  onCheck,
  checkKey,
  onGoTo,
}: {
  shopId: number;
  listingId: number;
  fixes: Finding[];
  focus: FocusKey | null;
  onAi: () => void;
  busy: boolean;
  canTouchTitle: boolean;
  touchTitle: boolean;
  onTouchTitle: (v: boolean) => void;
  onCheck: () => Promise<ContentAudit>;
  /** AI önerisi forma yazılınca artar: kontrol kendiliğinden yenilenir */
  checkKey: number;
  onGoTo: (sectionId: string) => void;
}) {
  const { t } = useT();
  const [d] = useCached<ListingDiagnosis>(`diagnosis:${shopId}:${listingId}`);
  const [result, setResult] = useState<ContentAudit | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      setResult(await onCheck());
    } catch {
      setResult(null);
    } finally {
      setChecking(false);
    }
  }
  // AI önerisi forma yazılınca kontrol kendiliğinden yenilenir (ücretsiz).
  useEffect(() => {
    if (checkKey === 0) return;
    let cancelled = false;
    onCheck().then(
      (r) => !cancelled && setResult(r),
      () => !cancelled && setResult(null),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  const areas = new Set(fixes.map((f) => f.fix));
  const needsAi = areas.has("description") || areas.has("tags") || (areas.has("title") && (!canTouchTitle || touchTitle));
  const step = d?.next_step ? stepFocus(d.next_step) : null;
  const fixFocuses = new Set(fixes.filter((f) => f.fix).map((f) => AREA_FOCUS[f.fix as string]));
  const outside = !!step && step !== "overhaul" && step !== "text" && !fixFocuses.has(step);
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
  const ghost = `${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800`;

  return (
    <div className="rounded-xl border border-[#D97757]/40 bg-[#D97757]/5 p-4 dark:bg-[#D97757]/10">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{t("Seçtiğin düzeltme", "Selected fix")}</p>
      <ul className="mt-1.5 space-y-1.5">
        {fixes.map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-sm text-neutral-900 dark:text-neutral-100">
            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${f.weight >= 2 ? "bg-red-500" : "bg-amber-500"}`} />
            <span>{f.text}</span>
          </li>
        ))}
      </ul>

      {canTouchTitle && (
        <label className="mt-3 flex items-start gap-2 text-xs text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={touchTitle} onChange={(e) => onTouchTitle(e.target.checked)} className="mt-0.5" />
          <span>{t("Başlığa da dokun (Etsy sıralamasını etkileyebilir; kapalıysa başlık bulgusu atlanır)", "Change the title too (can affect Etsy ranking; when off, the title finding is skipped)")}</span>
        </label>
      )}
      {outside && step && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {t(
            `Bu turun adımı "${focusLabel(t, step)}". Burayı da değiştirirsen sonucun neyden geldiği ölçülemez; yine de düzeltebilirsin.`,
            `This round's step is "${focusLabel(t, step)}". Changing this area too makes it impossible to tell what caused the result; you can still fix it.`,
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {needsAi && (
          <button type="button" onClick={onAi} disabled={busy} className={`${btn} bg-[#D97757] text-white hover:bg-[#C6613F]`}>
            {busy ? t("Üretiliyor…", "Generating…") : t("Bu sorunlara odaklı AI önerisi üret", "Generate an AI suggestion focused on these issues")}
          </button>
        )}
        {!focus && areas.has("attributes") && (
          <button type="button" onClick={() => onGoTo("sec-attributes")} className={ghost}>
            {t("Özelliklere git (yapay zekâsız)", "Go to attributes (no AI)")}
          </button>
        )}
        {!focus && areas.has("alt_text") && (
          <button type="button" onClick={() => onGoTo("sec-media")} className={ghost}>
            {t("Fotoğraflara git (alt metin)", "Go to photos (alt text)")}
          </button>
        )}
        <button type="button" onClick={() => void check()} disabled={checking} className={ghost}>
          {checking ? t("Kontrol ediliyor…", "Checking…") : t("Kontrol et", "Check")}
        </button>
      </div>

      {result && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <ContentLevelView audit={result} />
        </div>
      )}
    </div>
  );
}

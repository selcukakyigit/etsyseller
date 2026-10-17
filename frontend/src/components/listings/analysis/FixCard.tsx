"use client";

import { ContentAudit, ListingDiagnosis } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { FocusKey, focusLabel, stepFocus } from "./NextStepCard";

type Finding = ContentAudit["findings"][number];

/** Odak modunda, içerik denetiminden seçilen düzeltmeleri gösterir (Sıradaki Adım kartının yerine geçer): hangi sorun düzeltiliyor, AI önerisi bunlara odaklanır.
 * Yapay zekâ gerektirmeyen düzeltmeler (özellik, alt metin) aşağıdaki alandan elle yapılır. */
export default function FixCard({
  shopId,
  listingId,
  fixes,
  focus,
  onAi,
  busy,
}: {
  shopId: number;
  listingId: number;
  fixes: Finding[];
  focus: FocusKey;
  onAi: () => void;
  busy: boolean;
}) {
  const { t } = useT();
  const [d] = useCached<ListingDiagnosis>(`diagnosis:${shopId}:${listingId}`);
  const needsAi = fixes.some((f) => f.fix === "title" || f.fix === "tags" || f.fix === "description");
  const step = d?.next_step ? stepFocus(d.next_step) : null;
  const outside = step && step !== focus && step !== "overhaul" && !(step === "text" && ["title_tags", "description"].includes(focus));
  const risky = fixes.some((f) => f.risk === "high");

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
      {outside && d?.next_step && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {t(
            `Bu turun adımı "${focusLabel(t, step)}". Bu alanı da değiştirirsen sonucun neyden geldiği ölçülemez; yine de düzeltebilirsin.`,
            `This round's step is "${focusLabel(t, step)}". Changing this area too makes it impossible to tell what caused the result; you can still fix it.`,
          )}
        </p>
      )}
      {risky && (
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          {t("Başlık değişikliği Etsy sıralamasını etkileyebilir.", "A title change can affect your Etsy ranking.")}
        </p>
      )}
      <div className="mt-3">
        {needsAi ? (
          <button type="button" onClick={onAi} disabled={busy} className="rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C6613F] disabled:opacity-50">
            {busy ? t("Üretiliyor…", "Generating…") : t("Bu sorunlara odaklı AI önerisi üret", "Generate an AI suggestion focused on these issues")}
          </button>
        ) : (
          <p className="text-xs text-neutral-600 dark:text-neutral-400">{t("Bu düzeltme yapay zekâ gerektirmez: aşağıdaki alanı doldur.", "This fix needs no AI: fill in the field below.")}</p>
        )}
      </div>
    </div>
  );
}

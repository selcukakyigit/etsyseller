"use client";

import { useState } from "react";
import { ChatCard } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

type Brief = Extract<ChatCard, { type: "brief" }>;

const chip =
  "rounded-full border px-3 py-1 text-left text-sm font-medium transition disabled:cursor-default disabled:opacity-60";
const chipOff =
  "border-neutral-300 bg-white text-neutral-700 hover:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200";
const chipOn = "border-[#D97757] bg-[#D97757] text-white";

/** Listeyi kurmadan önce: anlaşılanlar + eksikler. Hazır cevaplı sorular düğmeyle, gerisi TEK yazı/ses kutusuyla cevaplanır; hepsi tek mesajda gider. */
export default function BriefCard({ card, onAsk, active }: { card: Brief; onAsk?: (text: string) => void; active: boolean }) {
  const { t } = useT();
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [text, setText] = useState("");
  const live = active && !!onAsk;
  const typed = card.questions.map((q, i) => ({ q, i })).filter(({ q }) => q.options.length === 0);

  const send = () => {
    const chosen = card.questions.flatMap((q, i) => (picked[i] ? [{ label: q.label, value: picked[i] }] : []));
    // Tek soru, yalnızca seçim: mesaj yalnızca seçilen değerdir ("Powder coated"); birden çok sorulu kartta hangi cevabın hangi soruya ait olduğu için "soru: cevap" kalır.
    if (card.questions.length === 1 && chosen.length === 1 && !text.trim()) {
      onAsk?.(chosen[0].value);
      return;
    }
    // Hazır cevaplı HER soru cevaplandıysa sohbette yalnızca cevaplar görünür (kartla aynı sırada); atlanan soru varsa hangi cevabın hangisi olduğu için "soru: cevap" kalır.
    const choiceQuestions = card.questions.filter((q) => q.options.length > 0).length;
    const lines = chosen.length === choiceQuestions ? chosen.map((c) => c.value) : chosen.map((c) => `${c.label}: ${c.value}`);
    // Hem hazır cevap seçildi hem yazıldıysa model hangisinin geçerli olduğunu bilemez ve geri sorar: yazılan açıkça öncelikli işaretlenir.
    if (text.trim()) lines.push(lines.length > 0 ? `${t("Kendi yazdıklarım (seçimlerle çelişirse BUNLAR geçerli)", "What I wrote myself (wins over the choices above if they conflict)")}: ${text.trim()}` : text.trim());
    onAsk?.(lines.join("\n") || t("Sen karar ver", "You decide"));
  };

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-[#D97757]/50 bg-white dark:bg-neutral-900">
      {card.understood.length > 0 && (
        <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <div className="mb-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("Anladığım", "What I understood")}</div>
          <dl className="space-y-0.5 text-sm text-neutral-800 dark:text-neutral-100">
            {card.understood.map((r, i) => (
              <div key={i} className="flex gap-2">
                <dt className="shrink-0 text-neutral-500 dark:text-neutral-400">{r.label}:</dt>
                <dd className="min-w-0 break-words">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="space-y-3 px-4 py-3">
        {card.questions.map((q, i) =>
          q.options.length > 0 ? (
            <div key={i}>
              <div className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">{q.label}</div>
              <div className={q.type === "title" ? "flex flex-col gap-1.5" : "flex flex-wrap gap-2"}>
                {q.options.map((o) => (
                  <button key={o} type="button" disabled={!live} onClick={() => setPicked((p) => ({ ...p, [i]: p[i] === o ? "" : o }))} className={`${chip} ${picked[i] === o ? chipOn : chipOff} ${q.type === "title" ? "rounded-lg" : ""}`}>
                    {o}
                  </button>
                ))}
              </div>
              {q.type === "title" && <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{t("Seçin ya da aşağıya kendi başlığınızı yazın", "Pick one or write your own below")}</div>}
            </div>
          ) : null,
        )}
        {typed.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-neutral-800 dark:text-neutral-100">
            {typed.map(({ q, i }) => (
              <li key={i}>{q.label}</li>
            ))}
          </ul>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!live}
          rows={3}
          placeholder={t("Eksikleri tek paragrafta yazın ya da söyleyin", "Write or dictate the missing details in one paragraph")}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-[#D97757] focus:outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </div>
      <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <button
          type="button"
          disabled={!live}
          onClick={send}
          className="rounded-lg bg-[#D97757] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#C6613F] disabled:cursor-default disabled:bg-neutral-300 dark:disabled:bg-neutral-700"
        >
          {t("Tamam, listeyi oluştur", "Done, create the listing")}
        </button>
        <span className="ml-3 text-xs text-neutral-400 dark:text-neutral-500">{t("Boş bıraktığınıza ben karar veririm", "I will decide anything you leave empty")}</span>
      </div>
    </div>
  );
}

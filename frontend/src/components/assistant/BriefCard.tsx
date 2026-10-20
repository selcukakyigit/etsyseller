"use client";

import { useState } from "react";
import { ChatCard } from "@/lib/api";
import { MoneyInput } from "@/components/ui/NumberInputs";
import { useT } from "@/lib/i18n-client";

type Brief = Extract<ChatCard, { type: "brief" }>;

const chip =
  "rounded-full border px-3 py-1 text-sm font-medium transition disabled:cursor-default disabled:opacity-60";
const chipOff =
  "border-neutral-300 bg-white text-neutral-700 hover:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200";
const chipOn = "border-[#D97757] bg-[#D97757] text-white";
const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-[#D97757] focus:outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

/** Listeyi kurmadan önce: yapay zekânın anladıkları + eksikler. Cevaplar TEK mesajda gider, liste tek seferde kurulur. */
export default function BriefCard({ card, onAsk, active }: { card: Brief; onAsk?: (text: string) => void; active: boolean }) {
  const { t } = useT();
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const set = (i: number, v: string) => setAnswers((a) => ({ ...a, [i]: v }));
  const live = active && !!onAsk;

  const send = () => {
    const decide = t("sen karar ver", "you decide");
    const lines = card.questions.map((q, i) => `${q.label}: ${answers[i]?.trim() || decide}`);
    onAsk?.(lines.join("\n"));
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
      {card.questions.length > 0 && (
        <div className="space-y-3 px-4 py-3">
          <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("Eksik olanlar", "What is missing")}</div>
          {card.questions.map((q, i) => (
            <div key={i}>
              <div className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">{q.label}</div>
              <div className="mb-1.5 flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <button key={o} type="button" disabled={!live} onClick={() => set(i, answers[i] === o ? "" : o)} className={`${chip} ${answers[i] === o ? chipOn : chipOff}`}>
                    {o}
                  </button>
                ))}
              </div>
              {q.type === "price" ? (
                <MoneyInput value={answers[i] ?? ""} onValue={(v) => set(i, v)} disabled={!live} unit={q.unit || "$"} placeholder={t("veya fiyat yazın", "or type a price")} className={inputCls} />
              ) : (
                <input value={answers[i] ?? ""} onChange={(e) => set(i, e.target.value)} disabled={!live} placeholder={t("veya kendiniz yazın", "or type your own")} className={inputCls} />
              )}
            </div>
          ))}
        </div>
      )}
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

"use client";

import { useState } from "react";
import { ChatCard } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

type Pins = Extract<ChatCard, { type: "social_pins" }>;

/** Pinterest pin metinleri: her pinin başlığı, açıklaması ve hashtag'leri tek dokunuşla kopyalanır (paylaşım yapılmaz). */
export default function SocialPinsCard({ card }: { card: Pins }) {
  const { t } = useT();
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // pano izni yok: kullanıcı metni elle seçip kopyalayabilir
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {t("Pinterest pin metinleri", "Pinterest pin copy")} · <span className="text-neutral-700 dark:text-neutral-300">{card.title}</span>
      </div>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {card.pins.map((p, i) => {
          const full = `${p.title}\n\n${p.description}\n\n${p.hashtags.map((h) => `#${h}`).join(" ")}`;
          const key = `pin-${i}`;
          return (
            <li key={key} className="space-y-1.5 px-4 py-3 text-sm">
              <div className="font-semibold text-neutral-900 dark:text-neutral-100">{p.title}</div>
              <p className="text-neutral-600 dark:text-neutral-300">{p.description}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                {p.hashtags.map((h) => (
                  <span key={h}>#{h}</span>
                ))}
                {p.board && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">
                    {t("Pano", "Board")}: {p.board}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void copy(key, full)}
                className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {copied === key ? t("Kopyalandı ✓", "Copied ✓") : t("Kopyala", "Copy")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

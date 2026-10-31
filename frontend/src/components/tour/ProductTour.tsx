"use client";

import { useEffect, useReducer, useState } from "react";
import { useT } from "@/lib/i18n-client";
import { TourStep } from "./steps";

const CARD_W = 340;
const GAP = 14;

/** Görünür (boyutu olan) ilk işaretli öğe: aynı ad hem masaüstü kenar çubuğunda hem mobil çekmecede olabilir. */
function findTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  return all.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Adım adım ürün turu: işaretli öğeyi aydınlatır, yanında açıklama kartı gösterir. Telefonda (ve işaretli öğe görünmüyorsa) kart ortada/altta açılır.
 * Klavye: ← → ile gez, Esc ile kapat. Bitince ya da atlanınca `onClose` çağrılır (`completed`: son adıma gelindi mi). */
export default function ProductTour({
  steps,
  onClose,
  connectHref,
}: {
  steps: TourStep[];
  onClose: (completed: boolean) => void;
  /** Verilirse son adımda "Etsy'ye bağlan" düğmesi çıkar (örnek mağazadaki kullanıcı için). */
  connectHref?: string;
}) {
  const { t, lang } = useT();
  const [index, setIndex] = useState(0);
  const [, relayout] = useReducer((n: number) => n + 1, 0); // pencere boyutu/kaydırma değişince konum yeniden hesaplanır
  const step = steps[index];
  const last = index === steps.length - 1;
  const [title, body] = lang === "tr" ? step.tr : step.en;

  useEffect(() => {
    findTarget(step.target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const again = () => relayout();
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
  }, [step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  // Ölçüm render sırasında DOM'dan okunur (konum, gösterim anındaki düzene bağlı).
  const el = findTarget(step.target);
  const rect = el?.getBoundingClientRect();
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const anchored = !!rect && vw >= 1024;
  let cardStyle: React.CSSProperties;
  if (anchored && rect) {
    const roomRight = rect.right + GAP + CARD_W + 12 <= vw;
    cardStyle = roomRight
      ? { left: rect.right + GAP, top: clamp(rect.top - 12, 12, vh - 260) }
      : { left: clamp(rect.right - CARD_W, 12, vw - CARD_W - 12), top: clamp(rect.bottom + GAP, 12, vh - 260) };
  } else if (vw >= 640) {
    cardStyle = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  } else {
    cardStyle = { left: 16, right: 16, bottom: 16 };
  }

  return (
    <div className="fixed inset-0 z-[70]" role="presentation">
      {/* Tıklamaları engeller: tur sırasında yanlışlıkla sayfa değişmesin. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      {anchored && rect ? (
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-[#D97757] transition-all duration-200"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/60" />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ position: "fixed", width: vw < 640 ? undefined : CARD_W, maxWidth: "calc(100vw - 2rem)", ...cardStyle }}
        className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
            {index + 1} / {steps.length}
          </span>
          <button type="button" onClick={() => onClose(false)} className="text-xs text-neutral-500 transition hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
            {t("Turu atla", "Skip tour")}
          </button>
        </div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{body}</p>

        <div className="mt-4 space-y-3">
          <div className="flex gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-[#D97757]" : "w-1.5 bg-neutral-300 dark:bg-neutral-700"}`} />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:whitespace-nowrap">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {t("Geri", "Back")}
              </button>
            )}
            {last && connectHref ? (
              <>
                <button
                  type="button"
                  onClick={() => onClose(true)}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  {t("Örnekle devam et", "Keep exploring")}
                </button>
                <a href={connectHref} className="rounded-lg bg-[#D97757] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#C6613F]">
                  {t("Etsy'ye bağlan", "Connect Etsy")}
                </a>
              </>
            ) : (
              <button
                type="button"
                autoFocus
                onClick={() => (last ? onClose(true) : setIndex(index + 1))}
                className="rounded-lg bg-[#D97757] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#C6613F]"
              >
                {last ? t("Bitir", "Done") : t("İleri", "Next")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

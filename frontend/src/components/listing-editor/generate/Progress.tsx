"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import type { Shot } from "./useImageSet";

/** Çalışırken yarım saniyede bir güncellenen saat (ilerleme çubuğu akıcı dolsun diye). */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Süren bir işin tahmini payı: ortalama süreye göre zamanla dolar, %90'da bekler (bitince tamamlanır). */
const estimate = (startedAt: number, now: number, averageMs: number) => 0.9 * (1 - Math.exp(-Math.max(0, now - startedAt) / averageMs));

function Bar({ pct, failed, label }: { pct: number; failed: boolean; label: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${failed ? "bg-red-500" : "bg-[#D97757]"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Fotoğraf seti: biten her fotoğraf tam pay, üretilmekte olan bir fotoğrafın ~30 sn sürdüğü varsayımıyla dolar. */
export function ShotsProgress({ shots, busy }: { shots: Shot[]; busy: boolean }) {
  const { t } = useT();
  const now = useNow(busy);
  const total = shots.length;
  const done = shots.filter((s) => s.status === "done").length;
  const running = shots.find((s) => s.status === "running");
  const failed = shots.some((s) => s.status === "error");
  const partial = busy && running?.startedAt ? estimate(running.startedAt, now, 30000) : 0;
  const pct = total ? Math.min(100, ((done + partial) / total) * 100) : 0;
  const label = busy
    ? t(`Üretiliyor… ${done} / ${total} hazır`, `Generating… ${done} / ${total} ready`)
    : failed
      ? t(`${done} / ${total} üretildi, kalanlar durduruldu`, `${done} / ${total} generated, the rest stopped`)
      : t(`${done} / ${total} fotoğraf hazır, listeye eklendi`, `${done} / ${total} photos ready and added to the listing`);

  return (
    <>
      <Bar pct={pct} failed={failed && !busy} label={label} />
      <ul className="space-y-1.5 text-sm text-neutral-800 dark:text-neutral-200">
        {shots.map((shot, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="flex w-4 justify-center">
              {shot.status === "pending" && "⏳"}
              {shot.status === "running" && <Spinner size={14} />}
              {shot.status === "done" && "✅"}
              {shot.status === "error" && "❌"}
            </span>
            <span className={shot.status === "pending" ? "text-neutral-400 dark:text-neutral-500" : ""}>{shot.label}</span>
            {shot.status === "error" && <span className="text-xs text-red-600 dark:text-red-400">— {shot.error}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Video: ortalama ~60 sn varsayımıyla dolar. */
export function VideoProgress({ startedAt, done }: { startedAt: number; done: boolean }) {
  const { t } = useT();
  const now = useNow(!done);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  const pct = done ? 100 : estimate(startedAt, now, 60000) * 100;
  return (
    <Bar
      pct={pct}
      failed={false}
      label={done ? t("Video hazır, listeye eklendi", "Video ready and added to the listing") : t(`Video üretiliyor… ${seconds} sn`, `Generating video… ${seconds}s`)}
    />
  );
}

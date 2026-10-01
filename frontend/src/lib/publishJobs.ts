"use client";

import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";

/**
 * Arka planda süren "Etsy'de yayınla" işleri. Modül düzeyinde durduğu için kullanıcı editörden liste sayfasına
 * geçse de istek kesilmez; liste kartı buradan ilerleme çubuğunu ve sonucu okur.
 */
export type PublishJob = {
  phase: "running" | "done" | "error";
  startedAt: number;
  error?: string;
  warnings?: string[];
  /** Etsy'de sonradan değişmiş alanlar; doluysa hiçbir şey yazılmadı (editör çözümü gösterir). */
  conflicts?: { key: string; label: string }[];
};

let jobs: ReadonlyMap<number, PublishJob> = new Map();
const listeners = new Set<() => void>();
const finished = new Set<(listingId: number, ok: boolean) => void>();

function setJob(id: number, job: PublishJob | null) {
  const next = new Map(jobs);
  if (job) next.set(id, job);
  else next.delete(id);
  jobs = next;
  listeners.forEach((l) => l());
}

export function usePublishJobs(): ReadonlyMap<number, PublishJob> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => jobs,
    () => jobs
  );
}

/** Bir iş bittiğinde (başarılı ya da hatalı) çağrılır; liste sayfası listeyi yenilemek için kullanır. */
export function onPublishFinished(cb: (listingId: number, ok: boolean) => void): () => void {
  finished.add(cb);
  return () => finished.delete(cb);
}

export function dismissPublishJob(id: number) {
  setJob(id, null);
}

export function startPublish(shopId: number, listingId: number, force = false) {
  if (jobs.get(listingId)?.phase === "running") return;
  const startedAt = Date.now();
  setJob(listingId, { phase: "running", startedAt });
  void (async () => {
    let ok = false;
    try {
      const r = await api.listings.publishLocal(shopId, listingId, force);
      if (r.conflicts && r.conflicts.length > 0) {
        setJob(listingId, {
          phase: "error",
          startedAt,
          conflicts: r.conflicts,
          error: `Etsy'de sonradan değişmiş alanlar var (${r.conflicts.map((c) => c.label).join(", ")}); hiçbir şey yazılmadı. Düzenleyiciden açıp çöz.`,
        });
      } else if (!r.ok) {
        const failed = r.steps.filter((st) => !st.ok).map((st) => `${st.name}${st.error ? `: ${st.error}` : ""}`);
        setJob(listingId, { phase: "error", startedAt, error: [r.error ?? "Yayın tamamlanamadı", ...failed].join(" — ") });
      } else {
        ok = true;
        const warnings = r.warnings ?? [];
        setJob(listingId, { phase: "done", startedAt, warnings });
        if (warnings.length === 0) setTimeout(() => dismissPublishJob(listingId), 1500);
      }
    } catch (e) {
      setJob(listingId, { phase: "error", startedAt, error: e instanceof Error ? e.message : "Yayınlanamadı" });
    }
    finished.forEach((cb) => cb(listingId, ok));
  })();
}

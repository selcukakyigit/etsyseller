"use client";

import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { tNow } from "@/lib/i18n";

/**
 * Arka planda süren "Etsy'de yayınla" işleri. Modül düzeyinde durduğu için kullanıcı sayfa değiştirse de (uygulama
 * içinde) iş kesilmez; liste kartı buradan ilerleme çubuğunu ve sonucu okur. Yayınlar tek bir sırada, birer birer
 * gider (Etsy oran sınırı): toplu yayında sıradakiler "queued" görünür.
 */
export type PublishJob = {
  phase: "queued" | "running" | "done" | "error";
  /** Kullanıcının yayına bastığı an (sıralamada "son düzenlenen" için). */
  queuedAt: number;
  /** Etsy'ye gönderimin başladığı an (ilerleme çubuğu buradan hesaplanır). */
  startedAt: number;
  error?: string;
  warnings?: string[];
  /** Etsy'de sonradan değişmiş alanlar; doluysa hiçbir şey yazılmadı (editör çözümü gösterir). */
  conflicts?: { key: string; label: string }[];
};

/** Bir yayının sonucu (toplu yayın özeti için). */
export type PublishOutcome = { ok: boolean; error?: string; updated?: string[]; warnings?: string[] };

let jobs: ReadonlyMap<number, PublishJob> = new Map();
const listeners = new Set<() => void>();
const finished = new Set<(listingId: number, ok: boolean) => void>();
const pending = new Map<number, Promise<PublishOutcome>>();
let queue: Promise<unknown> = Promise.resolve();

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

/** Yayını sıraya koyar; aynı listing zaten sıradaysa ya da yayınlanıyorsa o işin sonucunu döndürür. */
export function startPublish(shopId: number, listingId: number, force = false): Promise<PublishOutcome> {
  const existing = pending.get(listingId);
  if (existing) return existing;
  const queuedAt = Date.now();
  setJob(listingId, { phase: "queued", queuedAt, startedAt: queuedAt });
  const work = queue.then(() => run(shopId, listingId, queuedAt, force));
  queue = work.catch(() => undefined);
  pending.set(listingId, work);
  void work.finally(() => pending.delete(listingId));
  return work;
}

async function run(shopId: number, listingId: number, queuedAt: number, force: boolean): Promise<PublishOutcome> {
  const startedAt = Date.now();
  setJob(listingId, { phase: "running", queuedAt, startedAt });
  let outcome: PublishOutcome;
  try {
    const r = await api.listings.publishLocal(shopId, listingId, force);
    if (r.conflicts && r.conflicts.length > 0) {
      const error = tNow(
        `Etsy'de sonradan değişmiş alanlar var (${r.conflicts.map((c) => c.label).join(", ")}); hiçbir şey yazılmadı. Düzenleyiciden açıp çöz.`,
        `Some fields changed on Etsy in the meantime (${r.conflicts.map((c) => c.label).join(", ")}); nothing was written. Open the editor to resolve it.`,
      );
      setJob(listingId, { phase: "error", queuedAt, startedAt, conflicts: r.conflicts, error });
      outcome = { ok: false, error };
    } else if (!r.ok) {
      const failed = r.steps.filter((st) => !st.ok).map((st) => `${st.name}${st.error ? `: ${st.error}` : ""}`);
      const error = [r.error ?? tNow("Yayın tamamlanamadı", "Publishing did not finish"), ...failed].join(" — ");
      setJob(listingId, { phase: "error", queuedAt, startedAt, error });
      outcome = { ok: false, error };
    } else {
      const warnings = r.warnings ?? [];
      setJob(listingId, { phase: "done", queuedAt, startedAt, warnings });
      if (warnings.length === 0) setTimeout(() => dismissPublishJob(listingId), 1500);
      outcome = { ok: true, warnings, updated: r.steps.filter((st) => st.changed).map((st) => st.name) };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : tNow("Yayınlanamadı", "Could not publish");
    setJob(listingId, { phase: "error", queuedAt, startedAt, error });
    outcome = { ok: false, error };
  }
  finished.forEach((cb) => cb(listingId, outcome.ok));
  return outcome;
}

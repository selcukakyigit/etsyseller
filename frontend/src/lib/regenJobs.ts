"use client";

import { useSyncExternalStore } from "react";

/**
 * Herhangi bir görselin arka planda süren "sihirli değnek" (AI yeniden oluşturma) işi.
 * publishJobs.ts ile aynı desen: modül düzeyinde durur, kart yeniden render olsa/kapansa da
 * iş kesilmez; anahtar (`key`) çağıranın seçtiği herhangi bir kararlı kimlik olabilir
 * (burada: değiştirilecek görselin o anki listing_image_id'si).
 */
export type RegenJob = {
  phase: "running" | "error";
  startedAt: number;
  error?: string;
};

let jobs: ReadonlyMap<number, RegenJob> = new Map();
const listeners = new Set<() => void>();

function setJob(key: number, job: RegenJob | null) {
  const next = new Map(jobs);
  if (job) next.set(key, job);
  else next.delete(key);
  jobs = next;
  listeners.forEach((l) => l());
}

export function useRegenJobs(): ReadonlyMap<number, RegenJob> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => jobs,
    () => jobs
  );
}

export function dismissRegenJob(key: number) {
  setJob(key, null);
}

/** Async kod içinden (React render'ı beklemeden) o anki iş durumunu okur — ör. bir toplu döngü,
 * bir görsel az önce neden başarısız olduğunu (hata mesajını) hemen bildirmek istediğinde. */
export function getRegenJob(key: number): RegenJob | undefined {
  return jobs.get(key);
}

/** `task` üretimi yapıp sonucu döner; ilerleme çubuğu bu fonksiyon sürerken `key` için görünür. */
export async function runRegenJob<T>(key: number, task: () => Promise<T>): Promise<T | null> {
  if (jobs.get(key)?.phase === "running") return null;
  setJob(key, { phase: "running", startedAt: Date.now() });
  try {
    const result = await task();
    setJob(key, null);
    return result;
  } catch (e) {
    setJob(key, { phase: "error", startedAt: Date.now(), error: e instanceof Error ? e.message : "Bilinmeyen hata" });
    return null;
  }
}

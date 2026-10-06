"use client";

import { useEffect, useRef, useState } from "react";
import { api, GenerationChoice, GenerationReference } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

const POLL_MS = 4000;
// Yazılmazsa kullanılan hareket tarifi: ürünü değiştirmeden, sakin bir ürün videosu.
const DEFAULT_PROMPT =
  "A smooth, slow cinematic camera move around the product, soft natural light, the product itself stays exactly the same.";

export type VideoPhase = "idle" | "running" | "done" | "error";

/** Video işi: başlatır, bitene kadar sorar, bitince listeye ekler. Pencere kapanırsa sorgu durur (video sağlayıcıda yine
 *  üretilir ama listeye eklenmez ve kredisi düşülmez; kredi video kaydedilirken düşülür). */
export function useVideoJob({ shopId, listingId, onAdded }: { shopId: number; listingId: number; onAdded: (fileId: string) => void }) {
  const { t } = useT();
  const [phase, setPhase] = useState<VideoPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run(prompt: string, duration: number, reference: () => Promise<GenerationReference>, choice: GenerationChoice) {
    setPhase("running");
    setError(null);
    setStartedAt(Date.now());
    try {
      const ref = await reference();
      const { job } = await api.listings.startVideo(shopId, listingId, prompt.trim() || DEFAULT_PROMPT, duration, ref, choice);
      while (alive.current) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const res = await api.listings.videoStatus(shopId, listingId, job);
        if (res.status === "done") {
          onAdded(res.file_id);
          setPhase("done");
          return;
        }
      }
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : t("Video üretilemedi", "Could not generate the video"));
      setPhase("error");
    }
  }

  return { phase, error, startedAt, run, reset: () => setPhase("idle") };
}

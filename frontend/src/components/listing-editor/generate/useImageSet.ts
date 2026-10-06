"use client";

import { useState } from "react";
import { api, GenerationChoice, GenerationReference } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { SHOT_PRESETS } from "./shots";

export type Shot = { label: string; prompt: string; status: "pending" | "running" | "done" | "error"; error?: string; startedAt?: number };

/** Fotoğraf seti üretimi: çekimler sırayla üretilir, biten her biri hemen listeye eklenir; ilk hatada durur (ör. kota). */
export function useImageSet({ shopId, listingId, onAdded }: { shopId: number; listingId: number; onAdded: (fileId: string) => void }) {
  const { t } = useT();
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Shot>) => setShots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  async function run(qty: number, note: string, reference: () => Promise<GenerationReference>, choice: GenerationChoice) {
    setBusy(true);
    setError(null);
    try {
      const ref = await reference();
      const extra = note.trim() ? ` Extra note: ${note.trim()}` : "";
      const planned: Shot[] = Array.from({ length: qty }, (_, i) => {
        const preset = SHOT_PRESETS[i % SHOT_PRESETS.length];
        const cycle = Math.floor(i / SHOT_PRESETS.length);
        const name = t(...preset.label);
        return {
          label: cycle > 0 ? `${name} (${cycle + 1})` : name,
          prompt: preset.prompt + extra + (cycle > 0 ? " Make it a clearly different variation from the earlier ones." : ""),
          status: "pending",
        };
      });
      setShots(planned);
      for (let i = 0; i < planned.length; i++) {
        update(i, { status: "running", startedAt: Date.now() });
        try {
          const up = await api.listings.generateImage(shopId, listingId, planned[i].prompt, ref, choice);
          onAdded(up.file_id);
          update(i, { status: "done" });
        } catch (e) {
          update(i, { status: "error", error: e instanceof Error ? e.message : t("Üretilemedi", "Could not generate") });
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Görsel üretilemedi", "Could not generate the image"));
    } finally {
      setBusy(false);
    }
  }

  return { shots, busy, error, run };
}

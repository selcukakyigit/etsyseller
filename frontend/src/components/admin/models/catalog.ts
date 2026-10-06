import type { AdminAiModel, AdminAiVariant, AdminPricing } from "@/lib/api";

/** Yönetim > Modeller'in ortak sabitleri ve fiyat hesabı. Kredi kuralı backend'deki billing/pricing.py ile aynıdır;
 *  burada yalnızca formdaki canlı önizleme için kullanılır, kaydedilen değeri backend hesaplar. */

export type Kind = AdminAiModel["kind"];

export const KINDS: { id: Kind; tr: string; en: string }[] = [
  { id: "llm", tr: "Metin (LLM)", en: "Text (LLM)" },
  { id: "image", tr: "Görsel", en: "Image" },
  { id: "video", tr: "Video", en: "Video" },
];

export const PROVIDERS = ["anthropic", "openai", "google", "replicate"];
export const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  google: "Google (Gemini)",
  replicate: "Replicate",
};

export const IMAGE_SIZES = ["1K", "2K", "4K"];

/** Bu çarpanın altı ince marj sayılır: ödeme kesintisi ve başarısız üretimler de bu paydan karşılanıyor. */
export const SAFE_MULTIPLIER = 1.5;

/** Maliyetin kredi karşılığı: maliyet × çarpan ÷ kredi değeri, yukarı yuvarlanır, en az 1. */
export function autoCredits(costUsd: number, pricing: AdminPricing): number {
  const raw = Number(((costUsd * pricing.credit_markup) / pricing.credit_usd).toFixed(6));
  return Math.max(1, Math.ceil(raw));
}

export function unitCredits(v: Pick<AdminAiVariant, "cost_usd" | "credits">, pricing: AdminPricing): number {
  return v.credits ?? autoCredits(v.cost_usd, pricing);
}

/** Gerçek kâr çarpanı: kullanıcıdan alınan kredinin USD değeri ÷ sağlayıcı maliyeti. Maliyet 0 ise null. */
export function multiplier(credits: number, costUsd: number, pricing: AdminPricing): number | null {
  return costUsd > 0 ? (credits * pricing.credit_usd) / costUsd : null;
}

export function multiplierTone(m: number | null): "good" | "warn" | "bad" | "muted" {
  if (m === null) return "muted";
  if (m < 1) return "bad";
  return m < SAFE_MULTIPLIER ? "warn" : "good";
}

/** Sağlayıcı parametreleri formda tek satır metin olarak düzenlenir: `resolution=720p, draft=false`. */
export function formatParams(params: AdminAiVariant["params"]): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

export function parseParams(text: string): AdminAiVariant["params"] {
  const out: AdminAiVariant["params"] = {};
  for (const part of text.split(",")) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey.trim();
    if (!key) continue;
    const value = rest.join("=").trim();
    if (value === "true" || value === "false") out[key] = value === "true";
    else if (value !== "" && !Number.isNaN(Number(value))) out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}

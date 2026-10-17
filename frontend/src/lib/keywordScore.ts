import { KeywordPoolItem } from "@/lib/api";

/** Havuz rengi: sunucunun puanı (keywords/scoring.py; yapay zekâ da aynısını kullanır). 0 = kırmızı (zayıf), 1 = yeşil (güçlü). Puan yoksa nötr. */
export function scoreFill(item: KeywordPoolItem): string {
  const hue = (item.rank_score ?? 0.5) * 130;
  return `hsla(${hue}, 70%, 45%, 0.3)`;
}

/** Dolgu genişliği (%): puanın kendisi. */
export function scorePercent(item: KeywordPoolItem): number {
  return Math.round((item.rank_score ?? 0.5) * 100);
}

const CONFIDENCE: Record<NonNullable<KeywordPoolItem["confidence"]>, [string, string]> = {
  measured: ["ölçülü", "measured"],
  partial: ["kısmi", "partial"],
  estimate: ["tahmin", "estimate"],
};
const ROLE: Record<NonNullable<KeywordPoolItem["role"]>, [string, string]> = {
  head: ["ana ürün ifadesi", "main product phrase"],
  mid: ["orta kapsam", "mid-range"],
  long: ["uzun kuyruk", "long tail"],
  occasion: ["vesile/alıcı", "occasion/recipient"],
  style: ["stil/malzeme", "style/material"],
};

/** Fare üzerine gelince: puan, veri güveni, rol ve ölçülen sonuç sayısı. */
export function scoreTitle(item: KeywordPoolItem, t: (tr: string, en: string) => string): string {
  const parts: string[] = [];
  if (item.rank_score !== undefined) parts.push(t(`Puan ${item.rank_score.toFixed(2)}`, `Score ${item.rank_score.toFixed(2)}`));
  if (item.confidence) parts.push(t(`veri: ${CONFIDENCE[item.confidence][0]}`, `data: ${CONFIDENCE[item.confidence][1]}`));
  if (item.role) parts.push(t(`rol: ${ROLE[item.role][0]}`, `role: ${ROLE[item.role][1]}`));
  if (item.etsy_results != null) parts.push(t(`${item.etsy_results.toLocaleString()} arama sonucu`, `${item.etsy_results.toLocaleString()} search results`));
  return parts.join(" · ");
}

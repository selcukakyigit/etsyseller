/** Tanıtım sitesinin fiyat verisi (sunucu tarafı, herkese açık): kredi paketleri ve her işlemin yaklaşık kredi karşılığı. Backend'e ulaşılamazsa boş
 * döner; fiyat bölümü "yakında" gösterir, sayfa düşmez. */
export type PricePack = { id: number; name_tr: string; name_en: string; credits: number; price_cents: number; currency: string; list_price_cents: number; discount_pct: number };
export type PriceAction = { key: string; kind: "text" | "image" | "video"; label_tr: string; label_en: string; credits: number };
/** Özel miktar: sınırlar ve hangi miktardan itibaren yüzde kaç indirim (paketlerin birim fiyatlarından türer). Paket yoksa null. */
export type PriceCustom = { min: number; max: number; tiers: { from_credits: number; discount_pct: number }[] };
export type PriceList = { enabled: boolean; welcome_credits: number; packs: PricePack[]; custom: PriceCustom | null; actions: PriceAction[] };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const EMPTY: PriceList = { enabled: false, welcome_credits: 0, packs: [], custom: null, actions: [] };

export async function loadPriceList(): Promise<PriceList> {
  try {
    const res = await fetch(`${API_URL}/api/site/pricing`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    return res.ok ? ((await res.json()) as PriceList) : EMPTY;
  } catch {
    return EMPTY;
  }
}

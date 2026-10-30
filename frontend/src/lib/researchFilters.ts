/** Yönetim kelime listesinin süzgeci ve sunucuya gönderilen biçimleri (saf mantık; ağ yok). `researchApi.ts` bunları dışarı da verir. */

/** Kelime listesinin süzgeci (ekranda yazıldığı hâliyle: sayılar metin). Liste, toplu işlem ve dışa aktarma aynı süzgeci kullanır. */
export type KeywordFilters = {
  q: string;
  state: string;
  source: string;
  etsy: boolean;
  status: string;
  pinned: string;
  intent: string;
  minVolume: string;
  maxVolume: string;
  expiringDays: string;
  unusedDays: string;
};

export const EMPTY_KEYWORD_FILTERS: KeywordFilters = {
  q: "",
  state: "",
  source: "",
  etsy: false,
  status: "",
  pinned: "",
  intent: "",
  minVolume: "",
  maxVolume: "",
  expiringDays: "",
  unusedDays: "",
};

/** Gelişmiş süzgeçlerden kaç tanesi dolu (arama kutusu, veri durumu ve yönetim durumu hızlı çubukta olduğu için sayılmaz). */
export const advancedFilterCount = (f: KeywordFilters) =>
  [f.source, f.pinned, f.intent, f.minVolume, f.maxVolume, f.expiringDays, f.unusedDays].filter(Boolean).length + (f.etsy ? 1 : 0);

const num = (v: string) => (v === "" ? null : Number(v));

/** Sunucunun beklediği gövde (POST toplu işlem). */
export const filterBody = (f: KeywordFilters) => ({
  q: f.q,
  state: f.state,
  source: f.source,
  etsy: f.etsy,
  status: f.status,
  pinned: f.pinned,
  intent: f.intent,
  min_volume: num(f.minVolume),
  max_volume: num(f.maxVolume),
  expiring_days: num(f.expiringDays),
  unused_days: num(f.unusedDays),
});

/** Sunucunun beklediği sorgu dizgesi (GET); boş süzgeçler gönderilmez. */
export function filterQuery(f: KeywordFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  for (const [k, v] of Object.entries(filterBody(f))) if (v !== "" && v !== null && v !== false) params.set(k, String(v));
  return params.toString();
}

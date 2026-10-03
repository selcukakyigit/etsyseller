import type { ChangeField, ChangeResult, ListingChange } from "@/lib/api";
import type { T } from "@/lib/i18n-client";

/** Değişiklik ve ölçüm sonucunun iki dilli metinleri (Değişiklikler sekmesi, pano kartı ve düzenleyici şeridi ortak kullanır). */

const FIELD: Record<ChangeField, [string, string]> = {
  title: ["başlık", "title"],
  tags: ["etiketler", "tags"],
  description: ["açıklama", "description"],
  materials: ["malzemeler", "materials"],
  images: ["fotoğraflar", "photos"],
  videos: ["video", "video"],
  price: ["fiyat", "price"],
  inventory: ["varyasyonlar", "variations"],
  properties: ["özellikler", "attributes"],
  personalization: ["kişiselleştirme", "personalization"],
  shipping: ["kargo", "shipping"],
  category: ["kategori", "category"],
  text: ["başlık/etiket/açıklama", "title/tags/description"],
  other: ["diğer", "other"],
};

export const fieldsText = (t: T, fields: ChangeField[]) => fields.map((f) => t(...(FIELD[f] ?? [f, f]))).join(", ");

export const sourceText = (t: T, source: ListingChange["source"]) =>
  source === "ai" ? t("AI destekli", "AI-assisted") : source === "etsy" ? t("Etsy'de yapıldı", "Made on Etsy") : t("Elle", "Manual");

const METRIC: Record<"views" | "favorites" | "units", [string, string]> = {
  views: ["görüntülenme", "views"],
  favorites: ["favori", "favorites"],
  units: ["satış", "sales"],
};

export const metricText = (t: T, m: keyof typeof METRIC) => t(...METRIC[m]);

export type VerdictKey = "better" | "same" | "worse" | "unclear" | "waiting" | "other";

export function verdictKey(r: ChangeResult | null): VerdictKey {
  if (!r || r.status === "waiting") return "waiting";
  if (r.status === "measured" && r.verdict !== "low_data") return r.verdict;
  return "other";
}

export const VERDICT_STYLE: Record<VerdictKey, string> = {
  better: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  same: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  worse: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  unclear: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  waiting: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  other: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

/** Kısa rozet metni: "İşe yaradı · görüntülenme +24% · güven yüksek" gibi. */
export function verdictLabel(t: T, r: ChangeResult | null): string {
  if (!r || r.status === "waiting") {
    const days = r && r.status === "waiting" ? r.ready_in : null;
    return days ? t(`Ölçülüyor · ${days} gün sonra`, `Measuring · in ${days} days`) : t("Ölçülüyor", "Measuring");
  }
  if (r.status === "no_baseline") return t("Öncesi kayıtlı değil", "No data from before");
  if (r.status === "interrupted") return t("Sonraki değişiklik ölçümü kesti", "Cut short by the next change");
  if (r.verdict === "low_data") return t("Veri çok az", "Too little data");
  const net = r.net[r.metric];
  const pct = net === null ? "" : ` · ${metricText(t, r.metric)} ${net > 0 ? "+" : ""}${net}%`;
  const conf = r.confidence === "high" ? ` · ${t("güven yüksek", "high confidence")}` : r.confidence === "medium" ? ` · ${t("güven orta", "medium confidence")}` : "";
  if (r.verdict === "better") return t("İşe yaradı", "It worked") + pct + conf;
  if (r.verdict === "worse") return t("Kötüleşti", "Got worse") + pct + conf;
  if (r.verdict === "unclear") return t("Henüz belirsiz", "Not clear yet") + pct;
  return t("Belirgin fark yok", "No clear difference") + pct;
}

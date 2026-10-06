"use client";

import { Badge, Button, Toggle, inputClass } from "@/components/admin/ui";
import type { AdminAiVariant, AdminPricing } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { IMAGE_SIZES, autoCredits, formatParams, multiplier, multiplierTone, parseParams } from "./catalog";

/** Formda düzenlenen seçenek: sayılar ve parametreler metin olarak tutulur, kaydederken `toVariant` ile çevrilir. */
export type VariantDraft = {
  key: string;
  label_tr: string;
  label_en: string;
  cost: string;
  credits: string;
  params: string;
  is_default: boolean;
  active: boolean;
};

const num = (v: string): number | null => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function toDraft(v: AdminAiVariant): VariantDraft {
  return {
    key: v.key, label_tr: v.label_tr, label_en: v.label_en, cost: String(v.cost_usd), credits: v.credits === null ? "" : String(v.credits),
    params: formatParams(v.params), is_default: v.is_default, active: v.active,
  };
}

export function toVariant(d: VariantDraft): AdminAiVariant {
  const key = d.key.trim();
  return {
    key, label_tr: d.label_tr.trim() || key, label_en: d.label_en.trim() || d.label_tr.trim() || key, cost_usd: num(d.cost) ?? 0,
    credits: num(d.credits), params: parseParams(d.params), is_default: d.is_default, active: d.active,
  };
}

export function emptyDraft(googleImage: boolean, first: boolean): VariantDraft {
  return googleImage
    ? { key: "2K", label_tr: "2K", label_en: "2K", cost: "", credits: "", params: "image_size=2K", is_default: first, active: true }
    : { key: "", label_tr: "", label_en: "", cost: "", credits: "", params: "", is_default: first, active: true };
}

/** Çözünürlük değişince, eski çözünürlüğü taşıyan anahtar ve adlar da yenisine geçer ("2K" → "4K"). */
function sizePatch(d: VariantDraft, from: string, to: string): Partial<VariantDraft> {
  const follow = (v: string) => (v === from || v === "" ? to : v);
  return { params: `image_size=${to}`, key: follow(d.key), label_tr: follow(d.label_tr), label_en: follow(d.label_en) };
}

/** Google görsel modellerinde parametre serbest metin değil, çözünürlük seçicidir (backend de bunu şart koşar). */
export default function VariantEditor({
  drafts,
  onChange,
  pricing,
  perSecond,
  googleImage,
}: {
  drafts: VariantDraft[];
  onChange: (next: VariantDraft[]) => void;
  pricing: AdminPricing;
  perSecond: boolean;
  googleImage: boolean;
}) {
  const { t, locale } = useT();

  const update = (i: number, patch: Partial<VariantDraft>) => onChange(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const makeDefault = (i: number) => onChange(drafts.map((d, j) => ({ ...d, is_default: j === i, active: j === i ? true : d.active })));
  const remove = (i: number) => onChange(drafts.filter((_, j) => j !== i));
  const add = () => onChange([...drafts, emptyDraft(googleImage, drafts.length === 0)]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {perSecond ? t("Fiyat seçenekleri (video saniyesi başına)", "Price options (per video second)") : t("Fiyat seçenekleri (görsel başına)", "Price options (per image)")}
        </p>
        <Button onClick={add}>{t("Seçenek ekle", "Add option")}</Button>
      </div>
      {drafts.length === 0 && (
        <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
          {t("En az bir fiyat seçeneği ekle.", "Add at least one price option.")}
        </p>
      )}
      {drafts.map((d, i) => {
        const cost = num(d.cost) ?? 0;
        const auto = autoCredits(cost, pricing);
        const credits = num(d.credits) ?? auto;
        const m = multiplier(credits, cost, pricing);
        const size = String(parseParams(d.params).image_size ?? "2K");
        return (
          <div key={i} className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="grid gap-2 sm:grid-cols-3">
              <input value={d.label_tr} onChange={(e) => update(i, { label_tr: e.target.value })} placeholder={t("Ad (TR), ör. 720p taslak", "Name (TR), e.g. 720p taslak")} className={inputClass} aria-label={t("Ad (Türkçe)", "Name (Turkish)")} />
              <input value={d.label_en} onChange={(e) => update(i, { label_en: e.target.value })} placeholder={t("Ad (EN), ör. 720p draft", "Name (EN), e.g. 720p draft")} className={inputClass} aria-label={t("Ad (İngilizce)", "Name (English)")} />
              <input value={d.key} onChange={(e) => update(i, { key: e.target.value })} placeholder={t("Anahtar, ör. 720p-draft", "Key, e.g. 720p-draft")} className={`${inputClass} font-mono`} spellCheck={false} aria-label={t("Anahtar", "Key")} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[11px] text-neutral-400 dark:text-neutral-500">{perSecond ? t("Maliyet (USD / sn)", "Cost (USD / sec)") : t("Maliyet (USD / görsel)", "Cost (USD / image)")}</span>
                <input inputMode="decimal" value={d.cost} onChange={(e) => update(i, { cost: e.target.value })} placeholder="0.02" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-neutral-400 dark:text-neutral-500">{t("Kredi (boş: otomatik)", "Credits (empty: automatic)")}</span>
                <input inputMode="numeric" value={d.credits} onChange={(e) => update(i, { credits: e.target.value })} placeholder={String(auto)} className={inputClass} />
              </label>
              {googleImage ? (
                <label className="block">
                  <span className="mb-1 block text-[11px] text-neutral-400 dark:text-neutral-500">{t("Çözünürlük", "Resolution")}</span>
                  <select value={size} onChange={(e) => update(i, sizePatch(d, size, e.target.value))} className={inputClass}>
                    {IMAGE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-[11px] text-neutral-400 dark:text-neutral-500">{t("API parametreleri", "API parameters")}</span>
                  <input value={d.params} onChange={(e) => update(i, { params: e.target.value })} placeholder="resolution=720p, draft=false" className={`${inputClass} font-mono`} spellCheck={false} />
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={d.is_default} onChange={() => makeDefault(i)} className="accent-[#D97757]" />
                  {t("Varsayılan", "Default")}
                </label>
                <span className="flex items-center gap-1.5">
                  <Toggle checked={d.active} disabled={d.is_default} onChange={(v) => update(i, { active: v })} label={t("Aktif", "Active")} />
                  {t("Aktif", "Active")}
                </span>
                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                  {perSecond ? t(`${credits} kredi / sn`, `${credits} credits / sec`) : t(`${credits} kredi / görsel`, `${credits} credits / image`)}
                </span>
                <Badge tone={multiplierTone(m)}>{m === null ? t("maliyet yok", "no cost") : `${m.toLocaleString(locale, { maximumFractionDigits: 1 })}×`}</Badge>
              </div>
              <Button tone="danger" onClick={() => remove(i)}>
                {t("Kaldır", "Remove")}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

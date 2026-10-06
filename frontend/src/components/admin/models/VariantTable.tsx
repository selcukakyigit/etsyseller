"use client";

import { Badge } from "@/components/admin/ui";
import type { AdminAiModel, AdminPricing } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { formatParams, multiplier, multiplierTone } from "./catalog";

/** Görsel/video modelinin fiyat seçenekleri, salt okunur: maliyet, düşülen kredi, gerçek kâr çarpanı. Videoda bir de
 *  varsayılan süre için örnek tutar gösterilir ("5 sn = 30 kredi"). */
export default function VariantTable({ model, pricing }: { model: AdminAiModel; pricing: AdminPricing }) {
  const { t, locale } = useT();
  const perSecond = model.kind === "video";
  const duration = model.options.default_duration ?? model.options.durations?.[0];
  const usd = (n: number) => `$${n.toLocaleString(locale, { maximumFractionDigits: 4 })}`;

  if (model.variants.length === 0) {
    return <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("Fiyat seçeneği yok; her üretim en az ücreti (1 kredi) öder.", "No price options; each generation charges the minimum (1 credit).")}</p>;
  }

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="text-left text-neutral-400 dark:text-neutral-500">
            <th className="pb-1 font-medium">{t("Seçenek", "Option")}</th>
            <th className="pb-1 text-right font-medium">{perSecond ? t("Maliyet / sn", "Cost / sec") : t("Maliyet / görsel", "Cost / image")}</th>
            <th className="pb-1 text-right font-medium">{perSecond ? t("Kredi / sn", "Credits / sec") : t("Kredi / görsel", "Credits / image")}</th>
            {perSecond && duration && <th className="pb-1 text-right font-medium">{t(`${duration} sn`, `${duration} sec`)}</th>}
            <th className="pb-1 text-right font-medium">{t("Çarpan", "Multiplier")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {model.variants.map((v) => {
            const m = multiplier(v.unit_credits, v.cost_usd, pricing);
            return (
              <tr key={v.key} className={v.active ? "text-neutral-700 dark:text-neutral-300" : "text-neutral-400 dark:text-neutral-600"}>
                <td className="py-1.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {t(v.label_tr, v.label_en)}
                    {v.is_default && <Badge tone="good">{t("varsayılan", "default")}</Badge>}
                    {!v.active && <Badge tone="muted">{t("pasif", "inactive")}</Badge>}
                  </span>
                  {Object.keys(v.params).length > 0 && <span className="block font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{formatParams(v.params)}</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{usd(v.cost_usd)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {v.unit_credits}
                  {v.credits !== null && <span className="ml-1 text-neutral-400 dark:text-neutral-500">{t("(elle)", "(fixed)")}</span>}
                </td>
                {perSecond && duration && <td className="py-1.5 text-right tabular-nums">{v.unit_credits * duration}</td>}
                <td className="py-1.5 text-right">
                  <Badge tone={multiplierTone(m)}>{m === null ? "—" : `${m.toLocaleString(locale, { maximumFractionDigits: 1 })}×`}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

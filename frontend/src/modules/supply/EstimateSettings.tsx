"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { errMsg } from "../core/errors";
import { input, label, muted } from "../core/ui";
import { money } from "../core/units";
import DecimalInput from "../components/DecimalInput";
import { JobDetail, supplyApi } from "./api";

/** Süreyi "25 dk 4,8 sn" gibi yazar. */
function duration(seconds: number, t: (tr: string, en: string) => string): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round((seconds - m * 60) * 10) / 10;
  return m > 0 ? `${m} ${t("dk", "min")} ${s} ${t("sn", "s")}` : `${s} ${t("sn", "s")}`;
}

/** "Tahmini maliyete göre" dağıtımın iş başına ayarları: raporun süreleri, süre (lazer) bedeli ve malzemenin kesimciden gelip
 * gelmediği. Süre bedeli boşsa süre ölçüsüne eşlenmiş satırların toplamı kullanılır. */
export default function EstimateSettings({ entityId, job, onJob }: { entityId: number; job: JobDetail; onJob: (j: JobDetail) => void }) {
  const { t, locale } = useT();
  const [fee, setFee] = useState(job.time_fee == null ? "" : String(job.time_fee));
  const times = job.times ?? [];

  async function patch(body: { time_fee?: number | null; with_material?: boolean }) {
    try {
      onJob(await supplyApi.jobs.update(entityId, job.id, body));
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
    }
  }

  function commitFee() {
    const v = fee.trim() === "" ? null : Number(fee.replace(",", "."));
    if (v !== null && !(Number.isFinite(v) && v >= 0)) return setFee(job.time_fee == null ? "" : String(job.time_fee));
    if (v !== (job.time_fee ?? null)) void patch({ time_fee: v });
  }

  return (
    <div className="mb-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      {times.length > 0 && (
        <p className={`${muted} mb-2`}>
          {t("Raporda okunan süreler", "Times read from the report")}: {times.map((x) => `${x.label} ${duration(x.seconds, t)}`).join(" · ")}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className={label}>{t("Süre bedeli", "Time fee")}</span>
          <DecimalInput
            value={fee}
            onValue={setFee}
            onBlur={commitFee}
            disabled={job.status === "confirmed"}
            placeholder={job.time_fee_mapped != null ? String(job.time_fee_mapped) : t("tutar", "amount")}
            className={`${input} w-36`}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700 dark:text-neutral-200">
          <input type="checkbox" checked={job.with_material ?? true} onChange={(e) => void patch({ with_material: e.target.checked })} className="h-4 w-4 accent-[#D97757]" />
          {t("Malzeme kesimciden", "Material from the cutter")}
        </label>
      </div>
      <p className={`${muted} mt-2`}>
        {job.time_fee == null && job.time_fee_mapped != null
          ? t(`Süre bedeli boş: fiyat listesine eşlenen süre satırları kullanılıyor (${money(job.time_fee_mapped, job.currency, locale)}).`, `Time fee is empty: the report-time lines mapped to the price list are used (${money(job.time_fee_mapped, job.currency, locale)}).`)
          : t("Yalnızca lazer süresinin tutarını yaz, fatura toplamını değil; boş bırakırsan rapordaki süre kullanılır.", "Enter only the laser time amount, not the invoice total; leave empty to use the report's time.")}
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Section, errorText, inputClass } from "@/components/admin/ui";
import { AdminCatalog, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

/** Her özelliğin (asistan, SEO, görsel üretimi…) kullandığı model. */
export default function TasksSection({ data, onChanged }: { data: AdminCatalog; onChanged: () => void }) {
  const { t } = useT();
  const [saving, setSaving] = useState<string | null>(null);

  async function assign(task: string, modelId: number, variant: string | null = null) {
    setSaving(task);
    try {
      await api.admin.assignTask(task, modelId, variant);
      toast.success(t("Görev güncellendi", "Task updated"));
      onChanged();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Section title={t("Görevler", "Tasks")}>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        {t(
          "Her özellik burada seçilen modeli ve kaliteyi (çözünürlük/video kalitesi) kullanır; kullanıcı model seçmediği her yerde bu geçerlidir. Seçilen modelin anahtarı yoksa aynı türde anahtarı olan bir modele düşülür; “Şu an” sütunu gerçekte kullanılanı gösterir. Yükseltmede 2K/4K kullanıcı seçimidir.",
          "Each feature uses the model and quality (resolution / video quality) chosen here, wherever the user does not pick a model. If that model has no key, a model of the same type that has one is used; the “Now” column shows what is actually used. For upscaling, 2K/4K is the user's choice.",
        )}
      </p>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {data.tasks.map((task) => {
          const options = data.models.filter((m) => m.kind === task.kind && m.active && m.supported);
          const assigned = data.models.find((m) => m.id === task.model_id);
          const variants = task.task === "upscale" || !assigned ? [] : assigned.variants.filter((v) => v.active);
          const currentVariant = task.variant_key && variants.some((v) => v.key === task.variant_key) ? task.variant_key : (variants.find((v) => v.is_default) ?? variants[0])?.key ?? "";
          return (
            <li key={task.task} className="grid gap-2 py-3 sm:grid-cols-[1fr_minmax(0,16rem)_minmax(0,11rem)_minmax(0,16rem)] sm:items-center">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(task.name_tr, task.name_en)}</p>
              <select
                value={task.model_id ?? ""}
                disabled={saving === task.task || options.length === 0}
                onChange={(e) => void assign(task.task, Number(e.target.value), null)}
                className={inputClass}
                aria-label={t(task.name_tr, task.name_en)}
              >
                {task.model_id === null && <option value="">{t("Seçilmedi", "Not set")}</option>}
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.provider}
                  </option>
                ))}
              </select>
              {variants.length > 0 ? (
                <select
                  value={currentVariant}
                  disabled={saving === task.task}
                  onChange={(e) => void assign(task.task, task.model_id as number, e.target.value)}
                  className={inputClass}
                  aria-label={t("Kalite / çözünürlük", "Quality / resolution")}
                >
                  {variants.map((v) => (
                    <option key={v.key} value={v.key}>
                      {t(v.label_tr, v.label_en)} · {t(`${v.unit_credits} kredi`, `${v.unit_credits} credits`)}
                    </option>
                  ))}
                </select>
              ) : (
                <span />
              )}
              <p className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400" title={task.effective}>
                {t("Şu an", "Now")}: {task.effective}
              </p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

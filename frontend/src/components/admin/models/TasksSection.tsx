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

  async function assign(task: string, modelId: number) {
    setSaving(task);
    try {
      await api.admin.assignTask(task, modelId);
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
          "Her özellik burada seçilen modeli kullanır. Seçilen modelin anahtarı yoksa aynı türde anahtarı olan bir modele düşülür; “Şu an” sütunu gerçekte kullanılanı gösterir.",
          "Each feature uses the model chosen here. If that model has no key, a model of the same type that has one is used; the “Now” column shows what is actually used.",
        )}
      </p>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {data.tasks.map((task) => {
          const options = data.models.filter((m) => m.kind === task.kind && m.active && m.supported);
          return (
            <li key={task.task} className="grid gap-2 py-3 sm:grid-cols-[1fr_minmax(0,16rem)_minmax(0,14rem)] sm:items-center">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(task.name_tr, task.name_en)}</p>
              <select
                value={task.model_id ?? ""}
                disabled={saving === task.task || options.length === 0}
                onChange={(e) => void assign(task.task, Number(e.target.value))}
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

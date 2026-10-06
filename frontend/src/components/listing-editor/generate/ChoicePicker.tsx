"use client";

import type { GenerationChoice, GenerationKindOptions, GenerationModel, GenerationVariant } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useStoredState } from "@/lib/useStoredState";

export type ResolvedChoice = { model: GenerationModel; variant: GenerationVariant; choice: GenerationChoice };

/** Kullanıcının model ve kalite (seçenek) seçimi; bu tarayıcıda hatırlanır. Kayıtlı seçim artık sunulmuyorsa (yönetici
 *  kaldırdı/pasifleştirdi) varsayılana düşülür. */
export function useGenerationChoice(kind: "image" | "video", options: GenerationKindOptions) {
  const [stored, setStored] = useStoredState<string>(`gen:${kind}`, "");
  const [storedModel, storedVariant] = stored.split(":");
  const model =
    options.models.find((m) => String(m.id) === storedModel) ??
    options.models.find((m) => m.id === options.default_model) ??
    options.models[0];
  if (!model) return { resolved: null, setModel: () => {}, setVariant: () => {} };
  const variant = model.variants.find((v) => v.key === storedVariant) ?? model.variants.find((v) => v.is_default) ?? model.variants[0];
  const resolved: ResolvedChoice = { model, variant, choice: { modelId: model.id, variant: variant.key } };
  return {
    resolved,
    setModel: (id: number) => setStored(`${id}:`),
    setVariant: (key: string) => setStored(`${model.id}:${key}`),
  };
}

/** Model seçici (birden fazla model varsa) ve kalite düğmeleri. Kredi sistemi açıksa her kalitenin birim kredisi görünür. */
export default function ChoicePicker({
  options,
  resolved,
  onModel,
  onVariant,
  unit,
  showCredits,
  disabled,
}: {
  options: GenerationKindOptions;
  resolved: ResolvedChoice;
  onModel: (id: number) => void;
  onVariant: (key: string) => void;
  unit: "image" | "second";
  showCredits: boolean;
  disabled?: boolean;
}) {
  const { t } = useT();
  const perUnit = (n: number) => (unit === "second" ? t(`${n} kr/sn`, `${n} cr/sec`) : t(`${n} kr`, `${n} cr`));

  return (
    <div className="space-y-2">
      {options.models.length > 1 && (
        <select
          value={resolved.model.id}
          onChange={(e) => onModel(Number(e.target.value))}
          disabled={disabled}
          aria-label={t("Model", "Model")}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          {options.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      )}
      <div role="radiogroup" aria-label={t("Kalite", "Quality")} className="flex flex-wrap gap-1.5">
        {resolved.model.variants.map((v) => {
          const on = v.key === resolved.variant.key;
          return (
            <button
              key={v.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onVariant(v.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                on
                  ? "border-[#D97757] bg-[#D97757]/10 font-medium text-neutral-900 dark:text-neutral-100"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600"
              }`}
            >
              {t(v.label_tr, v.label_en)}
              {showCredits && <span className="ml-1.5 text-xs text-neutral-400 dark:text-neutral-500">{perUnit(v.credits)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

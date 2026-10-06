"use client";

import { useState } from "react";
import { Button, Field, Toggle, errorText, inputClass } from "@/components/admin/ui";
import { AdminAiModel, AdminAiModelInput, AdminAiModelOptions, AdminPricing, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { KINDS, Kind, PROVIDERS, PROVIDER_NAMES } from "./catalog";
import VariantEditor, { VariantDraft, emptyDraft, toDraft, toVariant } from "./VariantEditor";

const num = (v: string): number | null => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v: number | null): string => (v === null ? "" : String(v));

function parseDurations(text: string): number[] {
  const values = text
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

/** Model ekleme/düzenleme. Metin modeli token fiyatıyla, görsel/video modeli fiyat seçenekleriyle kaydedilir; videoda
 *  kullanıcının seçebileceği süreler de modelin özelliğidir. */
export default function ModelForm({
  initial,
  defaultKind,
  supported,
  pricing,
  onCancel,
  onSaved,
}: {
  initial: AdminAiModel | null;
  defaultKind: Kind;
  supported: Record<string, string[]>;
  pricing: AdminPricing;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [kind, setKind] = useState<Kind>(initial?.kind ?? defaultKind);
  const [provider, setProvider] = useState(initial?.provider ?? (defaultKind === "video" ? "replicate" : defaultKind === "image" ? "google" : "anthropic"));
  const [modelId, setModelId] = useState(initial?.model_id ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [inputPrice, setInputPrice] = useState(str(initial?.input_usd_per_mtok ?? null));
  const [outputPrice, setOutputPrice] = useState(str(initial?.output_usd_per_mtok ?? null));
  const [durations, setDurations] = useState((initial?.options.durations ?? [5, 10]).join(", "));
  const [defaultDuration, setDefaultDuration] = useState(initial?.options.default_duration ?? 5);
  const [drafts, setDrafts] = useState<VariantDraft[]>(
    () => initial?.variants.map(toDraft) ?? (defaultKind === "llm" ? [] : [emptyDraft(defaultKind === "image", true)]),
  );
  const [saving, setSaving] = useState(false);

  const wired = (supported[kind] ?? []).includes(provider);
  const googleImage = kind === "image" && provider === "google";
  const durationList = parseDurations(durations);

  function changeKind(next: Kind) {
    setKind(next);
    if (next !== "llm" && drafts.length === 0) setDrafts([emptyDraft(next === "image" && provider === "google", true)]);
  }

  async function save() {
    const options: AdminAiModelOptions = kind === "video" ? { durations: durationList, default_duration: defaultDuration } : {};
    const body: AdminAiModelInput = {
      kind,
      provider,
      model_id: modelId.trim(),
      label: label.trim() || modelId.trim(),
      active,
      input_usd_per_mtok: kind === "llm" ? num(inputPrice) : null,
      output_usd_per_mtok: kind === "llm" ? num(outputPrice) : null,
      options,
      variants: kind === "llm" ? [] : drafts.map(toVariant),
    };
    setSaving(true);
    try {
      if (initial) await api.admin.updateModel(initial.id, body);
      else await api.admin.createModel(body);
      toast.success(t("Model kaydedildi", "Model saved"));
      onSaved();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Tür", "Type")}>
          <select value={kind} onChange={(e) => changeKind(e.target.value as Kind)} className={inputClass}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {t(k.tr, k.en)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("Sağlayıcı", "Provider")}
          hint={!wired ? t("Bu sağlayıcı bu tür için henüz bağlı değil; model kaydedilir ama göreve atanamaz.", "This provider is not wired for this type yet; the model is saved but cannot be assigned to a task.") : undefined}
        >
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_NAMES[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Model kimliği (API'deki ad)", "Model ID (name in the API)")}>
          <input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder={kind === "video" ? "prunaai/p-video" : kind === "image" ? "gemini-3.1-flash-image-preview" : "claude-sonnet-5"}
            className={`${inputClass} font-mono`}
            spellCheck={false}
          />
        </Field>
        <Field label={t("Görünen ad", "Display name")} hint={t("Kullanıcılar model seçicide bunu görür.", "Users see this in the model picker.")}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "video" ? "P-Video" : "Claude Sonnet 5"} className={inputClass} />
        </Field>
        {kind === "llm" && (
          <>
            <Field label={t("Girdi fiyatı (USD / 1M token)", "Input price (USD / 1M tokens)")}>
              <input inputMode="decimal" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("Çıktı fiyatı (USD / 1M token)", "Output price (USD / 1M tokens)")}>
              <input inputMode="decimal" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} className={inputClass} />
            </Field>
          </>
        )}
        {kind === "video" && (
          <>
            <Field label={t("Seçilebilir süreler (sn)", "Selectable durations (sec)")} hint={t("Virgülle ayır, ör. 3, 5, 8, 10", "Comma-separated, e.g. 3, 5, 8, 10")}>
              <input value={durations} onChange={(e) => setDurations(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("Varsayılan süre", "Default duration")}>
              <select value={defaultDuration} onChange={(e) => setDefaultDuration(Number(e.target.value))} className={inputClass}>
                {durationList.map((d) => (
                  <option key={d} value={d}>
                    {t(`${d} sn`, `${d} sec`)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>
      {kind !== "llm" && <VariantEditor drafts={drafts} onChange={setDrafts} pricing={pricing} perSecond={kind === "video"} googleImage={googleImage} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <Toggle checked={active} onChange={setActive} label={t("Aktif", "Active")} />
          {t("Aktif", "Active")}
        </span>
        <div className="flex gap-2">
          <Button onClick={onCancel}>{t("Vazgeç", "Cancel")}</Button>
          <Button tone="primary" busy={saving} disabled={!modelId.trim()} onClick={() => void save()}>
            {t("Kaydet", "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

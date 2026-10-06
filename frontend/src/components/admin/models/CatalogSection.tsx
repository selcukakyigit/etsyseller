"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Section, errorText } from "@/components/admin/ui";
import { AdminAiModel, AdminCatalog, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { KINDS, Kind } from "./catalog";
import ModelForm from "./ModelForm";
import VariantTable from "./VariantTable";

function llmPriceText(m: AdminAiModel, t: (tr: string, en: string) => string): string {
  if (m.input_usd_per_mtok === null && m.output_usd_per_mtok === null) return t("Fiyat girilmemiş", "No price set");
  return t(`$${m.input_usd_per_mtok ?? 0} girdi · $${m.output_usd_per_mtok ?? 0} çıktı / 1M token`, `$${m.input_usd_per_mtok ?? 0} in · $${m.output_usd_per_mtok ?? 0} out / 1M tokens`);
}

export default function CatalogSection({ data, onChanged }: { data: AdminCatalog; onChanged: () => void }) {
  const { t } = useT();
  const [kind, setKind] = useState<Kind>("image");
  const [editing, setEditing] = useState<AdminAiModel | "new" | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const models = data.models.filter((m) => m.kind === kind);

  async function remove(m: AdminAiModel) {
    if (!window.confirm(t(`“${m.label}” katalogdan silinsin mi?`, `Remove “${m.label}” from the catalog?`))) return;
    setDeleting(m.id);
    try {
      await api.admin.deleteModel(m.id);
      onChanged();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Section
      title={t("Model kataloğu", "Model catalog")}
      action={
        editing === null && (
          <Button tone="primary" onClick={() => setEditing("new")}>
            {t("Model ekle", "Add model")}
          </Button>
        )
      }
    >
      <div role="tablist" className="mb-4 inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
        {KINDS.map((k) => {
          const count = data.models.filter((m) => m.kind === k.id).length;
          const selected = k.id === kind;
          return (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setKind(k.id);
                setEditing(null);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                selected
                  ? "bg-[#D97757] text-white"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {t(k.tr, k.en)} <span className={selected ? "text-white/80" : "text-neutral-400 dark:text-neutral-500"}>{count}</span>
            </button>
          );
        })}
      </div>
      {editing !== null && (
        <ModelForm
          key={editing === "new" ? `new-${kind}` : editing.id}
          initial={editing === "new" ? null : editing}
          defaultKind={kind}
          supported={data.providers}
          pricing={data.pricing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {models.length === 0 ? (
        <EmptyState>{t("Bu türde model yok.", "No models of this type.")}</EmptyState>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
          {models.map((m) => (
            <li key={m.id} className="px-3 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {m.label}
                    {!m.active && <Badge tone="muted">{t("pasif", "inactive")}</Badge>}
                    {!m.supported && <Badge tone="warn">{t("henüz bağlı değil", "not wired yet")}</Badge>}
                  </p>
                  <p className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
                    {m.provider}/{m.model_id}
                  </p>
                  {m.kind === "llm" && <p className="text-xs text-neutral-400 dark:text-neutral-500">{llmPriceText(m, t)}</p>}
                  {m.kind === "video" && m.options.durations && (
                    <p className="text-xs text-neutral-400 dark:text-neutral-500">
                      {t("Süreler", "Durations")}: {m.options.durations.map((d) => (d === m.options.default_duration ? `[${d}]` : d)).join(", ")} {t("sn", "sec")}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <Button onClick={() => setEditing(m)}>{t("Düzenle", "Edit")}</Button>
                  <Button tone="danger" busy={deleting === m.id} onClick={() => void remove(m)}>
                    {t("Sil", "Delete")}
                  </Button>
                </div>
              </div>
              {m.kind !== "llm" && <VariantTable model={m} pricing={data.pricing} />}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
        {kind === "llm"
          ? t(
              "Metin modelleri gerçek token sayısıyla fiyatlanır. Fiyatı girilmemiş modelin her çağrısı en az ücreti (1 kredi) öder.",
              "Text models are priced by actual token count. A model without a price charges the minimum (1 credit) per call.",
            )
          : t(
              `Görsel ve video seçenekleri sabit fiyatlıdır: kullanıcı üretmeden önce tutarı görür. Otomatik kredi = maliyet × ${data.pricing.credit_markup} ÷ $${data.pricing.credit_usd} (Krediler sayfasından değişir). Çarpan, alınan kredinin maliyete oranıdır; 1,5×'in altı sarı, 1×'in altı (zarar) kırmızı.`,
              `Image and video options have a fixed price: users see it before generating. Automatic credits = cost × ${data.pricing.credit_markup} ÷ $${data.pricing.credit_usd} (set on the Credits page). The multiplier is what we charge over cost; below 1.5× is amber, below 1× (a loss) is red.`,
            )}
      </p>
    </Section>
  );
}

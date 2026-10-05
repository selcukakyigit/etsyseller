"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, Button, EmptyState, Field, Section, Toggle, errorText, inputClass } from "@/components/admin/ui";
import { useApiData } from "@/lib/useApiData";
import { BlockSpinner } from "@/components/ui/Spinner";
import { AdminAiModel, AdminAiModelInput, AdminCatalog, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

const KINDS: { id: AdminAiModel["kind"]; tr: string; en: string }[] = [
  { id: "llm", tr: "Metin (LLM)", en: "Text (LLM)" },
  { id: "image", tr: "Görsel", en: "Image" },
  { id: "video", tr: "Video", en: "Video" },
];
const PROVIDERS = ["anthropic", "openai", "google"];
const PROVIDER_NAMES: Record<string, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI", google: "Google (Gemini)" };
const IMAGE_SIZES = ["1K", "2K", "4K"];

export default function AdminModelsPage() {
  return (
    <AdminShell current="/admin/models">
      <Models />
    </AdminShell>
  );
}

function Models() {
  const { t } = useT();
  const { data, error, reload } = useApiData("admin:catalog", api.admin.catalog);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data.from_db && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t(
            "Katalog tabloları okunamadı; AI şu an .env ayarlarıyla çalışıyor. 0024 veritabanı göçünü uygulayın.",
            "The catalog tables could not be read; AI is running on .env settings. Apply database migration 0024.",
          )}
        </p>
      )}
      <Tasks data={data} onChanged={reload} />
      <Catalog data={data} onChanged={reload} />
      <Keys data={data} onChanged={reload} />
    </div>
  );
}

function Tasks({ data, onChanged }: { data: AdminCatalog; onChanged: () => void }) {
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

function priceText(m: AdminAiModel, t: (tr: string, en: string) => string): string {
  if (m.kind === "llm") {
    if (m.input_usd_per_mtok === null && m.output_usd_per_mtok === null) return t("Fiyat girilmemiş", "No price set");
    return t(`$${m.input_usd_per_mtok ?? 0} girdi · $${m.output_usd_per_mtok ?? 0} çıktı / 1M token`, `$${m.input_usd_per_mtok ?? 0} in · $${m.output_usd_per_mtok ?? 0} out / 1M tokens`);
  }
  if (m.unit_usd === null) return t("Fiyat girilmemiş", "No price set");
  return m.kind === "image" ? t(`$${m.unit_usd} / görsel`, `$${m.unit_usd} / image`) : t(`$${m.unit_usd} / saniye`, `$${m.unit_usd} / second`);
}

function Catalog({ data, onChanged }: { data: AdminCatalog; onChanged: () => void }) {
  const { t } = useT();
  const [editing, setEditing] = useState<AdminAiModel | "new" | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

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
      {editing !== null && (
        <ModelForm
          initial={editing === "new" ? null : editing}
          supported={data.providers}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {KINDS.map((kind) => {
        const models = data.models.filter((m) => m.kind === kind.id);
        return (
          <div key={kind.id} className="mt-4 first:mt-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{t(kind.tr, kind.en)}</h3>
            {models.length === 0 ? (
              <EmptyState>{t("Bu türde model yok.", "No models of this type.")}</EmptyState>
            ) : (
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
                {models.map((m) => (
                  <li key={m.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {m.label}
                        {!m.active && <Badge tone="muted">{t("pasif", "inactive")}</Badge>}
                        {!m.supported && <Badge tone="warn">{t("henüz bağlı değil", "not wired yet")}</Badge>}
                      </p>
                      <p className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
                        {m.provider}/{m.model_id}
                        {m.options.image_size ? ` · ${m.options.image_size}` : ""}
                      </p>
                      <p className="text-xs text-neutral-400 dark:text-neutral-500">{priceText(m, t)}</p>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <Button onClick={() => setEditing(m)}>{t("Düzenle", "Edit")}</Button>
                      <Button tone="danger" busy={deleting === m.id} onClick={() => void remove(m)}>
                        {t("Sil", "Delete")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
        {t(
          "Fiyatlar sağlayıcının USD liste fiyatıdır; kredi hesabı ve maliyet raporu bunlardan yapılır. Fiyatı girilmemiş modelin her çağrısı en az ücreti (1 kredi) öder.",
          "Prices are the provider's USD list prices; credits and the cost report are calculated from them. A model without a price charges the minimum (1 credit) per call.",
        )}
      </p>
    </Section>
  );
}

const num = (v: string): number | null => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v: number | null): string => (v === null ? "" : String(v));

function ModelForm({
  initial,
  supported,
  onCancel,
  onSaved,
}: {
  initial: AdminAiModel | null;
  supported: Record<string, string[]>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [kind, setKind] = useState<AdminAiModel["kind"]>(initial?.kind ?? "llm");
  const [provider, setProvider] = useState(initial?.provider ?? "anthropic");
  const [modelId, setModelId] = useState(initial?.model_id ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [inputPrice, setInputPrice] = useState(str(initial?.input_usd_per_mtok ?? null));
  const [outputPrice, setOutputPrice] = useState(str(initial?.output_usd_per_mtok ?? null));
  const [unitPrice, setUnitPrice] = useState(str(initial?.unit_usd ?? null));
  const [imageSize, setImageSize] = useState(initial?.options.image_size ?? "2K");
  const [saving, setSaving] = useState(false);
  const wired = (supported[kind] ?? []).includes(provider);

  async function save() {
    const body: AdminAiModelInput = {
      kind,
      provider,
      model_id: modelId.trim(),
      label: label.trim() || modelId.trim(),
      active,
      input_usd_per_mtok: kind === "llm" ? num(inputPrice) : null,
      output_usd_per_mtok: kind === "llm" ? num(outputPrice) : null,
      unit_usd: kind === "llm" ? null : num(unitPrice),
      options: kind === "image" ? { image_size: imageSize } : {},
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
    <div className="mb-4 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Tür", "Type")}>
          <select value={kind} onChange={(e) => setKind(e.target.value as AdminAiModel["kind"])} className={inputClass}>
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
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="claude-sonnet-5" className={`${inputClass} font-mono`} spellCheck={false} />
        </Field>
        <Field label={t("Görünen ad", "Display name")} hint={t("Asistandaki model seçicide kullanıcılar bunu görür.", "Users see this in the assistant's model picker.")}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Claude Sonnet 5" className={inputClass} />
        </Field>
        {kind === "llm" ? (
          <>
            <Field label={t("Girdi fiyatı (USD / 1M token)", "Input price (USD / 1M tokens)")}>
              <input inputMode="decimal" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("Çıktı fiyatı (USD / 1M token)", "Output price (USD / 1M tokens)")}>
              <input inputMode="decimal" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} className={inputClass} />
            </Field>
          </>
        ) : (
          <Field label={kind === "image" ? t("Görsel başına fiyat (USD)", "Price per image (USD)") : t("Video saniyesi başına fiyat (USD)", "Price per video second (USD)")}>
            <input inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={inputClass} />
          </Field>
        )}
        {kind === "image" && (
          <Field label={t("Çözünürlük", "Resolution")} hint={t("Yükseldikçe fiyat artar; 2K Etsy için yeterli.", "Higher costs more; 2K is enough for Etsy.")}>
            <select value={imageSize} onChange={(e) => setImageSize(e.target.value)} className={inputClass}>
              {IMAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
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

function Keys({ data, onChanged }: { data: AdminCatalog; onChanged: () => void }) {
  const { t } = useT();
  const [testingEtsy, setTestingEtsy] = useState(false);

  async function testEtsy() {
    setTestingEtsy(true);
    try {
      const r = await api.admin.testEtsy();
      (r.ok ? toast.success : toast.error)(r.message);
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setTestingEtsy(false);
    }
  }

  return (
    <Section
      title={t("Sağlayıcı anahtarları", "Provider keys")}
      action={
        <Button busy={testingEtsy} onClick={() => void testEtsy()}>
          {t("Etsy bağlantısını dene", "Test Etsy connection")}
        </Button>
      }
    >
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        {t(
          "Anahtarlar veritabanında şifreli saklanır ve deploy'da kaybolmaz. Panelden anahtar girilmemişse sunucudaki ortam değişkeni (.env) kullanılır. Etsy anahtarı uygulama kimliğidir, yalnızca sunucu ortamından değişir.",
          "Keys are stored encrypted in the database and survive deploys. Without a key here, the server environment variable (.env) is used. The Etsy key is the app identity and only changes in the server environment.",
        )}
      </p>
      <ul className="space-y-3">
        {data.keys.map((k) => (
          <KeyRow key={k.provider} provider={k.provider} masked={k.masked} source={k.source} onChanged={onChanged} />
        ))}
      </ul>
    </Section>
  );
}

function KeyRow({ provider, masked, source, onChanged }: { provider: string; masked: string; source: string; onChanged: () => void }) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);

  async function run(kind: "save" | "test" | "clear") {
    setBusy(kind);
    try {
      if (kind === "test") {
        const r = await api.admin.testKey(provider, value.trim() || undefined);
        (r.ok ? toast.success : toast.error)(`${PROVIDER_NAMES[provider] ?? provider}: ${r.message}`);
        return;
      }
      if (kind === "save") {
        await api.admin.setKey(provider, value.trim());
        setValue("");
        toast.success(t("Anahtar kaydedildi", "Key saved"));
      } else {
        if (!window.confirm(t("Panelden girilen anahtar silinsin mi? Varsa .env'deki anahtar kullanılır.", "Remove the key entered here? The .env key is used if there is one."))) return;
        await api.admin.clearKey(provider);
      }
      onChanged();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-lg border border-neutral-100 p-3 dark:border-neutral-800">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{PROVIDER_NAMES[provider] ?? provider}</span>
        {source === "db" && <Badge tone="good">{t("panelden", "from panel")}</Badge>}
        {source === "env" && <Badge tone="muted">.env</Badge>}
        {source === "" && <Badge tone="warn">{t("tanımlı değil", "not set")}</Badge>}
        {masked && <span className="font-mono text-xs text-neutral-400 dark:text-neutral-500">{masked}</span>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("Yeni anahtar", "New key")}
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <div className="flex flex-shrink-0 gap-2">
          <Button tone="primary" busy={busy === "save"} disabled={value.trim().length < 8 || busy !== null} onClick={() => void run("save")}>
            {t("Kaydet", "Save")}
          </Button>
          <Button busy={busy === "test"} disabled={busy !== null} onClick={() => void run("test")}>
            {t("Dene", "Test")}
          </Button>
          {source === "db" && (
            <Button tone="danger" busy={busy === "clear"} disabled={busy !== null} onClick={() => void run("clear")}>
              {t("Kaldır", "Remove")}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import ModelForm from "@/components/admin/models/ModelForm";
import VariantTable from "@/components/admin/models/VariantTable";
import { KINDS, Kind, PROVIDER_NAMES } from "@/components/admin/models/catalog";
import { Badge, Button, EmptyState, Section, errorText, inputClass } from "@/components/admin/ui";
import { useApiData } from "@/lib/useApiData";
import { BlockSpinner } from "@/components/ui/Spinner";
import { AdminAiModel, AdminCatalog, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

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

function llmPriceText(m: AdminAiModel, t: (tr: string, en: string) => string): string {
  if (m.input_usd_per_mtok === null && m.output_usd_per_mtok === null) return t("Fiyat girilmemiş", "No price set");
  return t(`$${m.input_usd_per_mtok ?? 0} girdi · $${m.output_usd_per_mtok ?? 0} çıktı / 1M token`, `$${m.input_usd_per_mtok ?? 0} in · $${m.output_usd_per_mtok ?? 0} out / 1M tokens`);
}

function Catalog({ data, onChanged }: { data: AdminCatalog; onChanged: () => void }) {
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

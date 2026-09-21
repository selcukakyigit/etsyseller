"use client";

import { useEffect, useState } from "react";
import { api, ApiKeys, ApiKeyTestResult } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";

const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4-turbo", "o1", "o1-mini", "o3-mini"];
const ANTHROPIC_MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001", "claude-fable-5-1"];
const CUSTOM_MODEL = "__custom__";

function SecretField({
  label,
  masked,
  value,
  onChange,
}: {
  label: string;
  masked: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={masked || "Ayarlanmadı"}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm font-mono outline-none focus:border-[#F1641E] break-all"
      />
      {masked && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 break-all">
          Kayıtlı değer: <span className="font-mono">{masked}</span> — değiştirmek için yeni değeri gir, boş
          bırakırsan aynı kalır
        </p>
      )}
    </div>
  );
}

/** Curated dropdown with a manual fallback, since new models ship faster than
 * this list can be kept in sync — "Özel model" reveals a free-text input. */
function ModelSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const isCustom = value !== "" && !options.includes(value);

  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{label}</label>
      <select
        value={isCustom ? CUSTOM_MODEL : value}
        onChange={(e) => onChange(e.target.value === CUSTOM_MODEL ? "" : e.target.value)}
        className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-sm font-mono outline-none focus:border-[#F1641E]"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={CUSTOM_MODEL}>Özel model…</option>
      </select>
      {isCustom && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Model adını gir"
          className="mt-2 w-full rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm font-mono outline-none focus:border-[#F1641E]"
        />
      )}
    </div>
  );
}

function TestConnectionButton({ provider }: { provider: "etsy" | "openai" | "anthropic" }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ApiKeyTestResult | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.account.testApiKey(provider));
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Bilinmeyen hata" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={handleTest}
        disabled={testing}
        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition disabled:opacity-50"
      >
        {testing ? "Kontrol ediliyor…" : "Bağlantıyı Test Et"}
      </button>
      {result && (
        <span className={`text-xs font-medium ${result.ok ? "text-green-600" : "text-red-600"}`}>
          {result.ok ? "✓ " : "✗ "}
          {result.message}
        </span>
      )}
    </div>
  );
}

export default function ApiKeysSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();

  const [apiKeysMasked, setApiKeysMasked] = useState<ApiKeys | null>(null);
  const [etsyApiKey, setEtsyApiKey] = useState("");
  const [etsySharedSecret, setEtsySharedSecret] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [aiProvider, setAiProvider] = useState<"openai" | "anthropic">("openai");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.account
      .apiKeys()
      .then((keys) => {
        setApiKeysMasked(keys);
        setOpenaiModel(keys.openai_model);
        setAnthropicModel(keys.anthropic_model);
        setAiProvider(keys.ai_provider === "anthropic" ? "anthropic" : "openai");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.account.updateApiKeys({
        etsy_api_key: etsyApiKey || undefined,
        etsy_shared_secret: etsySharedSecret || undefined,
        openai_api_key: openaiApiKey || undefined,
        openai_model: openaiModel || undefined,
        anthropic_api_key: anthropicApiKey || undefined,
        anthropic_model: anthropicModel || undefined,
        ai_provider: aiProvider,
      });
      setApiKeysMasked(updated);
      setEtsyApiKey("");
      setEtsySharedSecret("");
      setOpenaiApiKey("");
      setAnthropicApiKey("");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSubpage
      user={user}
      shops={shops}
      activeShop={activeShop}
      onSwitchShop={setActiveShopId}
      title="API Anahtarları"
    >
      {(bootError || error) && <p className="text-sm text-red-600">{bootError ?? error}</p>}

      {apiKeysMasked && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-6">
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Buradan kaydedilen değerler sunucudaki .env dosyasına yazılır ve hemen devreye girer.
          </p>

          <div className="space-y-3 pb-6 border-b border-neutral-100 dark:border-neutral-800">
            <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide">
              Etsy
            </h3>
            <SecretField
              label="Etsy API Key"
              masked={apiKeysMasked.etsy_api_key}
              value={etsyApiKey}
              onChange={setEtsyApiKey}
            />
            <SecretField
              label="Etsy Shared Secret"
              masked={apiKeysMasked.etsy_shared_secret}
              value={etsySharedSecret}
              onChange={setEtsySharedSecret}
            />
            <TestConnectionButton provider="etsy" />
          </div>

          <div className="space-y-3 pb-6 border-b border-neutral-100 dark:border-neutral-800">
            <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide">
              SEO önerileri için AI sağlayıcısı
            </h3>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="radio"
                  name="ai_provider"
                  checked={aiProvider === "openai"}
                  onChange={() => setAiProvider("openai")}
                />
                OpenAI
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="radio"
                  name="ai_provider"
                  checked={aiProvider === "anthropic"}
                  onChange={() => setAiProvider("anthropic")}
                />
                Claude (Anthropic)
              </label>
            </div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Seçtiğin sağlayıcı, listing SEO önerileri üretilirken kullanılır. Diğerinin anahtarını da girip
              saklayabilirsin, istediğin an değiştirirsin.
            </p>
          </div>

          <div className="space-y-3 pb-6 border-b border-neutral-100 dark:border-neutral-800">
            <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide">
              OpenAI {aiProvider === "openai" && <span className="text-[#F1641E]">(aktif)</span>}
            </h3>
            <SecretField
              label="OpenAI API Key"
              masked={apiKeysMasked.openai_api_key}
              value={openaiApiKey}
              onChange={setOpenaiApiKey}
            />
            <ModelSelect label="OpenAI Model" options={OPENAI_MODELS} value={openaiModel} onChange={setOpenaiModel} />
            <TestConnectionButton provider="openai" />
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide">
              Claude (Anthropic) {aiProvider === "anthropic" && <span className="text-[#F1641E]">(aktif)</span>}
            </h3>
            <SecretField
              label="Anthropic API Key"
              masked={apiKeysMasked.anthropic_api_key}
              value={anthropicApiKey}
              onChange={setAnthropicApiKey}
            />
            <ModelSelect
              label="Claude Model"
              options={ANTHROPIC_MODELS}
              value={anthropicModel}
              onChange={setAnthropicModel}
            />
            <TestConnectionButton provider="anthropic" />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
            >
              {saving ? "Kaydediliyor…" : "Anahtarları Kaydet"}
            </button>
            {saved && <span className="text-xs text-green-600">Kaydedildi ✓</span>}
          </div>
        </section>
      )}
    </SettingsSubpage>
  );
}

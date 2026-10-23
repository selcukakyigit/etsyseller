"use client";

import { useState } from "react";
import { Badge, Button, Field, Section, Toggle, errorText, inputClass } from "@/components/admin/ui";
import { IntegerInput, MoneyInput } from "@/components/ui/NumberInputs";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n-client";
import { ResearchSettings, researchAdmin } from "@/lib/researchApi";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";

/** Yenileme süreleri, bütçe ve sınırlar. Kimlik bilgisi ayrı kutuda; değeri sunucudan asla geri okunmaz. */
export default function SettingsPanel() {
  const { data, error, setData } = useApiData("admin:research:settings", researchAdmin.settings);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;
  return (
    <>
      <SettingsForm initial={data} onSaved={setData} />
      <Credentials />
    </>
  );
}

function SettingsForm({ initial, onSaved }: { initial: ResearchSettings; onSaved: (s: ResearchSettings) => void }) {
  const { t } = useT();
  const [form, setForm] = useState({
    enabled: initial.research_enabled,
    market: initial.research_default_market,
    language: initial.research_default_language,
    ttlVolume: String(initial.research_ttl_volume_days),
    ttlSuggest: String(initial.research_ttl_suggest_days),
    budget: initial.research_monthly_budget_usd.toFixed(2),
    shopDaily: String(initial.research_shop_daily_jobs),
    refreshPerDay: String(initial.research_refresh_per_day),
    activeDays: String(initial.research_active_days),
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setBusy(true);
    try {
      const saved = await researchAdmin.saveSettings({
        research_enabled: form.enabled,
        research_default_market: form.market,
        research_default_language: form.language,
        research_ttl_volume_days: Number(form.ttlVolume),
        research_ttl_suggest_days: Number(form.ttlSuggest),
        research_monthly_budget_usd: Number(form.budget),
        research_shop_daily_jobs: Number(form.shopDaily),
        research_refresh_per_day: Number(form.refreshPerDay),
        research_active_days: Number(form.activeDays),
      });
      onSaved(saved);
      toast.success(t("Kaydedildi.", "Saved."));
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title={t("Politika ve bütçe", "Policy and budget")}
      action={
        <div className="flex items-center gap-2">
          <HelpTip align="right">
            {t(
              "Süreler başlangıç varsayımıdır; gerçek değişim hızına ve maliyete göre ayarla. Her süreye ±%15 sapma eklenir ki binlerce kelime aynı gün dolmasın. Bütçe dolunca yeni istek yapılmaz, eski veri sunulur.",
              "Durations are starting assumptions; tune them to real change rates and cost. A ±15% jitter is added so thousands of keywords do not expire on the same day. At the budget cap no new requests are made and old data is served.",
            )}
          </HelpTip>
          <Button tone="primary" busy={busy} onClick={() => void save()}>
            {t("Kaydet", "Save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-neutral-900 dark:text-neutral-100">{t("Araştırma açık", "Research enabled")}</span>
          <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} label={t("Araştırma açık", "Research enabled")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Varsayılan pazar (ülke kodu)", "Default market (country code)")}>
            <input value={form.market} maxLength={2} onChange={(e) => set("market", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} className={inputClass} />
          </Field>
          <Field label={t("Varsayılan dil kodu", "Default language code")}>
            <input value={form.language} maxLength={5} onChange={(e) => set("language", e.target.value.toLowerCase().replace(/[^a-z-]/g, ""))} className={inputClass} />
          </Field>
          <Field label={t("Hacim ölçümü süresi", "Volume measurement lifetime")}>
            <IntegerInput value={form.ttlVolume} onValue={(v) => set("ttlVolume", v)} unit={t("gün", "days")} className={inputClass} />
          </Field>
          <Field label={t("Öneri listesi süresi", "Suggestion list lifetime")}>
            <IntegerInput value={form.ttlSuggest} onValue={(v) => set("ttlSuggest", v)} unit={t("gün", "days")} className={inputClass} />
          </Field>
          <Field label={t("Aylık bütçe", "Monthly budget")}>
            <MoneyInput value={form.budget} onValue={(v) => set("budget", v)} unit="$" className={inputClass} />
          </Field>
          <Field label={t("Mağaza başı günlük iş", "Jobs per shop per day")}>
            <IntegerInput value={form.shopDaily} onValue={(v) => set("shopDaily", v)} className={inputClass} />
          </Field>
          <Field label={t("Günlük otomatik yenileme", "Daily auto-refresh")}>
            <IntegerInput value={form.refreshPerDay} onValue={(v) => set("refreshPerDay", v)} unit={t("kelime", "keywords")} className={inputClass} />
          </Field>
          <Field label={t("Kullanılmış sayılma süresi", "Counts as in use for")}>
            <IntegerInput value={form.activeDays} onValue={(v) => set("activeDays", v)} unit={t("gün", "days")} className={inputClass} />
          </Field>
        </div>
      </div>
    </Section>
  );
}

function Credentials() {
  const { t, locale } = useT();
  const [confirm, confirmElement] = useConfirm();
  const overview = useApiData("admin:research:overview", researchAdmin.overview);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  const source = overview.data?.credentials ?? "none";

  async function save() {
    setBusy(true);
    try {
      await researchAdmin.saveCredentials(login.trim(), password);
      setLogin("");
      setPassword("");
      overview.reload();
      toast.success(t("Kimlik bilgisi kaydedildi.", "Credentials saved."));
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: t("Kimlik bilgisi silinsin mi?", "Remove the credentials?"), message: t("Sunucudaki .env değeri varsa o kullanılır.", "If the server .env has a value, it is used instead."), confirmLabel: t("Sil", "Remove"), destructive: true }))) return;
    try {
      await researchAdmin.clearCredentials();
      overview.reload();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    }
  }

  async function check() {
    setChecking(true);
    try {
      const r = await researchAdmin.account();
      if (r.ok) toast.success(t(`Bağlantı tamam. Bakiye: ${(r.balance ?? 0).toLocaleString(locale, { style: "currency", currency: "USD" })}`, `Connected. Balance: ${(r.balance ?? 0).toLocaleString(locale, { style: "currency", currency: "USD" })}`));
      else toast.error(r.error ?? t("Bağlantı kurulamadı.", "Could not connect."));
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <Section
      title={t("Sağlayıcı kimlik bilgisi", "Provider credentials")}
      action={
        <div className="flex items-center gap-2">
          {source === "none" ? <Badge tone="bad">{t("Girilmemiş", "Not set")}</Badge> : <Badge tone="good">{source === "database" ? t("Panelden (şifreli)", "From panel (encrypted)") : ".env"}</Badge>}
          <Button busy={checking} disabled={source === "none"} onClick={() => void check()}>
            {t("Bağlantıyı dene", "Test connection")}
          </Button>
        </div>
      }
    >
      {confirmElement}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="DataForSEO login">
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" className={inputClass} />
        </Field>
        <Field label={t("Parola (API)", "Password (API)")} hint={t("Kaydedildikten sonra bir daha gösterilmez.", "Never shown again once saved.")}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button tone="primary" busy={busy} disabled={!login.trim() || !password} onClick={() => void save()}>
          {t("Kaydet", "Save")}
        </Button>
        {source === "database" && (
          <Button tone="danger" onClick={() => void remove()}>
            {t("Panel kaydını sil", "Remove panel entry")}
          </Button>
        )}
      </div>
    </Section>
  );
}

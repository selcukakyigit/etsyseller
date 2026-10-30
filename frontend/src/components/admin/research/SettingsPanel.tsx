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

/** Sayı olarak düzenlenen ayarlar (açma/kapama, pazar ve dil ayrı alanlardır; `research_ttl_jitter` sabit kalır). */
type NumKey = Exclude<keyof ResearchSettings, "research_enabled" | "research_auto_refresh" | "research_default_market" | "research_default_language" | "research_ttl_jitter">;
type Spec = { key: NumKey; tr: string; en: string; money?: boolean; unit?: [string, string] };
type Group = { tr: string; en: string; help: [string, string]; fields: Spec[] };

const DAYS: [string, string] = ["gün", "days"];
const GROUPS: Group[] = [
  {
    tr: "Yenileme süreleri",
    en: "Refresh lifetimes",
    help: [
      "Google Ads aylık arama sayısı ayda bir güncellenir; bu yüzden hacim ölçümü 30 gün yaşar, daha sık sormak aynı sayıyı tekrar almak olur. Süresi dolan kelimeler haftalık otomatik işle (ya da Havuz sağlığındaki düğmeyle) yenilenir. Her süreye ±%15 sapma eklenir ki binlerce kelime aynı gün dolmasın.",
      "Google Ads monthly searches update once a month, so a volume measurement lives 30 days; asking more often just returns the same number. Expired keywords refresh in the weekly automatic job (or with the button under Pool health). A ±15% jitter is added so thousands of keywords do not expire on the same day.",
    ],
    fields: [
      { key: "research_ttl_volume_days", tr: "Hacim ölçümü", en: "Volume measurement", unit: DAYS },
      { key: "research_ttl_trend_days", tr: "Google ilgi (trend) ölçümü", en: "Google interest (trend) measurement", unit: DAYS },
      { key: "research_ttl_suggest_days", tr: "Öneri listesi", en: "Suggestion list", unit: DAYS },
    ],
  },
  {
    tr: "Bütçe",
    en: "Budget",
    help: [
      "Aylık sistem tavanı dolunca yeni sağlayıcı isteği yapılmaz, eski veri 'güncel değil' etiketiyle sunulur. İş türü tavanları sistem tavanının içindedir: bir tür (ör. mevsimsellik) bütçenin tamamını yemesin. 0 = o tür için ayrı tavan yok. Bakiye eşiğinin altına inince genel bakışta uyarı çıkar.",
      "At the monthly system cap no new provider requests are made and old data is served as stale. Per-kind caps sit inside the system cap so one kind (e.g. seasonality) cannot eat the whole budget. 0 = no separate cap for that kind. Below the balance threshold an alert shows on the overview.",
    ],
    fields: [
      { key: "research_monthly_budget_usd", tr: "Aylık sistem tavanı", en: "Monthly system cap", money: true },
      { key: "research_budget_volume_usd", tr: "Hacim işleri tavanı", en: "Volume jobs cap", money: true },
      { key: "research_budget_suggest_usd", tr: "Öneri işleri tavanı", en: "Suggestion jobs cap", money: true },
      { key: "research_budget_season_usd", tr: "Mevsimsellik işleri tavanı", en: "Seasonality jobs cap", money: true },
      { key: "research_budget_trend_usd", tr: "Trend işleri tavanı", en: "Trend jobs cap", money: true },
      { key: "research_low_balance_usd", tr: "Düşük bakiye uyarı eşiği", en: "Low balance alert threshold", money: true },
    ],
  },
  {
    tr: "Kotalar ve otomatik yenileme",
    en: "Quotas and auto-refresh",
    help: [
      "Mağaza kotaları tek bir mağazanın bütçeyi tüketmesini önler; havuzda hazır olan kelimeler kotaya sayılmaz. Otomatik yenileme (haftalık) yalnızca son 'kullanılmış sayılma süresi' içinde istenen ya da sabitli kelimeleri yeniler; kullanılmayan kelimeye para harcanmaz.",
      "Shop quotas stop one shop from using up the budget; keywords already in the pool do not count. The (weekly) auto-refresh only refreshes keywords requested within the 'counts as in use' window, or pinned ones; no money is spent on unused keywords.",
    ],
    fields: [
      { key: "research_shop_daily_jobs", tr: "Mağaza başı günlük iş", en: "Jobs per shop per day" },
      { key: "research_shop_monthly_searches", tr: "Mağaza başı aylık yeni kelime araştırması (Keşfet)", en: "New keyword searches per shop per month (Discover)" },
      { key: "research_shop_daily_searches", tr: "Günlük üst sınır (aylık hak tek günde bitmesin)", en: "Daily ceiling (so the monthly allowance cannot go in one day)" },
      { key: "research_refresh_per_day", tr: "Her yenilemede en fazla kelime", en: "Max keywords per refresh run", unit: ["kelime", "keywords"] },
      { key: "research_active_days", tr: "Kullanılmış sayılma süresi", en: "Counts as in use for", unit: DAYS },
    ],
  },
];

const NUM_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));
const isMoney = (key: NumKey) => GROUPS.some((g) => g.fields.some((f) => f.key === key && f.money));
const fmtNum = (key: NumKey, v: number) => (isMoney(key) ? v.toFixed(2) : String(v));

const toForm = (s: ResearchSettings) => ({
  enabled: s.research_enabled,
  auto: s.research_auto_refresh,
  market: s.research_default_market,
  language: s.research_default_language,
  nums: Object.fromEntries(NUM_KEYS.map((k) => [k, fmtNum(k, s[k])])) as Record<NumKey, string>,
});

function SettingsForm({ initial, onSaved }: { initial: ResearchSettings; onSaved: (s: ResearchSettings) => void }) {
  const { t } = useT();
  const [form, setForm] = useState(() => toForm(initial));
  const [open, setOpen] = useState(false); // kapalıyken tek satır özet; Kaydet formu kapatır
  const [busy, setBusy] = useState(false);
  const setNum = (key: NumKey, value: string) => setForm((f) => ({ ...f, nums: { ...f.nums, [key]: value } }));

  async function save() {
    setBusy(true);
    try {
      const saved = await researchAdmin.saveSettings({
        research_enabled: form.enabled,
        research_auto_refresh: form.auto,
        research_default_market: form.market,
        research_default_language: form.language,
        ...Object.fromEntries(NUM_KEYS.map((k) => [k, Number(form.nums[k])])),
      });
      onSaved(saved);
      setForm(toForm(saved));
      setOpen(false);
      toast.success(t("Kaydedildi.", "Saved."));
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** Fabrika değerlerini forma yükler; Kaydet'e basılana kadar kaydedilmiş ayar değişmez. */
  async function loadDefaults() {
    try {
      setForm(toForm(await researchAdmin.settingDefaults()));
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    }
  }

  function cancel() {
    setForm(toForm(initial));
    setOpen(false);
  }

  return (
    <Section
      title={t("Politika ve bütçe", "Policy and budget")}
      action={
        <div className="flex items-center gap-2">
          {open ? (
            <>
              <Button onClick={() => void loadDefaults()} disabled={busy}>
                {t("Varsayılanları yükle", "Load defaults")}
              </Button>
              <Button onClick={cancel} disabled={busy}>
                {t("Vazgeç", "Cancel")}
              </Button>
              <Button tone="primary" busy={busy} onClick={() => void save()}>
                {t("Kaydet", "Save")}
              </Button>
            </>
          ) : (
            <Button onClick={() => setOpen(true)}>{t("Düzenle", "Edit")}</Button>
          )}
        </div>
      }
    >
      {!open ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {initial.research_enabled ? t("Açık", "On") : t("Kapalı", "Off")} · {initial.research_default_market}/{initial.research_default_language} ·{" "}
          {t(`bütçe ${initial.research_monthly_budget_usd.toFixed(2)} $/ay`, `budget $${initial.research_monthly_budget_usd.toFixed(2)}/month`)} ·{" "}
          {t(`mağaza başı ${initial.research_shop_monthly_searches} yeni arama/ay`, `${initial.research_shop_monthly_searches} new searches per shop/month`)}
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <span className="text-sm text-neutral-900 dark:text-neutral-100">{t("Araştırma açık", "Research enabled")}</span>
              <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label={t("Araştırma açık", "Research enabled")} />
            </div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <span className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-neutral-100">
                {t("Otomatik yenileme", "Automatic refresh")}
                <HelpTip>
                  {t(
                    "Açıkken süresi dolan kelimeler haftada bir (pazartesi), trend ölçümleri ayda bir kendiliğinden yenilenir. Kapalıyken zamanlanmış hiçbir iş sağlayıcıya istek atmaz; yalnızca kullanıcı aramaları ve senin düğmelerin istek açar. Veriler eskiyebilir, Havuz sağlığındaki düğmeyi düzenli kullan.",
                    "When on, expired keywords refresh once a week (Monday) and trend measurements once a month. When off, no scheduled job calls the provider; only user searches and your buttons do. Data can age, so use the button under Pool health regularly.",
                  )}
                </HelpTip>
              </span>
              <Toggle checked={form.auto} onChange={(v) => setForm((f) => ({ ...f, auto: v }))} label={t("Otomatik yenileme", "Automatic refresh")} />
            </div>
            <Field label={t("Varsayılan pazar (ülke kodu)", "Default market (country code)")}>
              <input value={form.market} maxLength={2} onChange={(e) => setForm((f) => ({ ...f, market: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") }))} className={inputClass} />
            </Field>
            <Field label={t("Varsayılan dil kodu", "Default language code")}>
              <input value={form.language} maxLength={5} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value.toLowerCase().replace(/[^a-z-]/g, "") }))} className={inputClass} />
            </Field>
          </div>
          {GROUPS.map((g) => (
            <div key={g.en}>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                {t(g.tr, g.en)}
                <HelpTip>{t(g.help[0], g.help[1])}</HelpTip>
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.fields.map((spec) => (
                  <Field key={spec.key} label={t(spec.tr, spec.en)}>
                    {spec.money ? (
                      <MoneyInput value={form.nums[spec.key]} onValue={(v) => setNum(spec.key, v)} unit="$" className={inputClass} />
                    ) : (
                      <IntegerInput value={form.nums[spec.key]} onValue={(v) => setNum(spec.key, v)} unit={spec.unit ? t(spec.unit[0], spec.unit[1]) : undefined} className={inputClass} />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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

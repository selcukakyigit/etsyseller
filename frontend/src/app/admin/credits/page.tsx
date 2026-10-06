"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, Button, EmptyState, Field, Section, Toggle, errorText, inputClass, useFormat } from "@/components/admin/ui";
import { useApiData } from "@/lib/useApiData";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { AdminCreditSettings, AdminWorkspaceCredit, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

const PAGE_SIZE = 50;
const TASK_NAMES: Record<string, [string, string]> = {
  assistant: ["Asistan", "Assistant"],
  seo: ["SEO önerisi", "SEO suggestion"],
  vision: ["Alt metin", "Alt text"],
  document: ["Fatura/tablo okuma", "Invoice/table reading"],
  image: ["Görsel üretimi", "Image generation"],
};

export default function AdminCreditsPage() {
  return (
    <AdminShell current="/admin/credits">
      <div className="space-y-6">
        <Settings />
        <Usage />
        <Workspaces />
      </div>
    </AdminShell>
  );
}

function Settings() {
  const { t } = useT();
  const { data, setData, error } = useApiData("admin:credit-settings", api.admin.creditSettings);
  const [draft, setDraft] = useState<AdminCreditSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const form = draft ?? data;

  async function save(next: AdminCreditSettings) {
    setSaving(true);
    try {
      const saved = await api.admin.updateCreditSettings(next);
      setData(saved);
      setDraft(null);
      toast.success(t("Kredi ayarları kaydedildi", "Credit settings saved"));
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  function toggleEnabled(on: boolean) {
    if (!form) return;
    const msg = on
      ? t(
          "Kredi sistemi açılsın mı? Bakiyesi 0 ya da altında olan kullanıcıların AI istekleri reddedilir.",
          "Turn the credit system on? AI requests from users with a balance of 0 or less will be refused.",
        )
      : t("Kredi sistemi kapatılsın mı? Kullanım yine ölçülür ama bakiyeden düşülmez.", "Turn the credit system off? Usage is still measured but not deducted.");
    if (window.confirm(msg)) void save({ ...form, credits_enabled: on });
  }

  if (error && !form) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!form) return <BlockSpinner />;

  // Örnek: 1 USD maliyetli bir işlem kaç kredi eder ve kullanıcıya kaça gelir.
  const exampleCredits = Math.ceil((1 * form.credit_markup) / (form.credit_usd || 0.01));

  return (
    <Section
      title={t("Kredi ayarları", "Credit settings")}
      action={
        <span className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          {form.credits_enabled ? <Badge tone="good">{t("Açık", "On")}</Badge> : <Badge tone="muted">{t("Yalnızca ölçüm", "Measuring only")}</Badge>}
          <Toggle checked={form.credits_enabled} disabled={saving} onChange={toggleEnabled} label={t("Kredi sistemi", "Credit system")} />
        </span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Kâr çarpanı", "Markup")} hint={t("Sağlayıcı maliyetinin kaç katı alınır (1–50).", "How many times the provider cost is charged (1–50).")}>
          <input type="number" min={1} max={50} step={0.1} value={form.credit_markup} onChange={(e) => setDraft({ ...form, credit_markup: Number(e.target.value) })} className={inputClass} />
        </Field>
        <Field label={t("1 kredinin değeri (USD)", "Value of 1 credit (USD)")} hint={t("Kullanıcıya satış fiyatı, ör. 0.01.", "Sale price to users, e.g. 0.01.")}>
          <input type="number" min={0.0001} step={0.001} value={form.credit_usd} onChange={(e) => setDraft({ ...form, credit_usd: Number(e.target.value) })} className={inputClass} />
        </Field>
        <Field label={t("Hoş geldin kredisi", "Welcome credits")} hint={t("Bakiyesi ilk kez oluşan hesaba bir kez.", "Given once when an account's balance is first created.")}>
          <input type="number" min={0} step={1} value={form.signup_credits} onChange={(e) => setDraft({ ...form, signup_credits: Number(e.target.value) })} className={inputClass} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t(
            `Örnek: sağlayıcıya 1 USD'lik işlem = ${exampleCredits} kredi = kullanıcıya ${(exampleCredits * form.credit_usd).toFixed(2)} USD. Her çağrı en az 1 kredi.`,
            `Example: a 1 USD provider call = ${exampleCredits} credits = ${(exampleCredits * form.credit_usd).toFixed(2)} USD to the user. Each call costs at least 1 credit.`,
          )}
        </p>
        <div className="flex gap-2">
          {draft && <Button onClick={() => setDraft(null)}>{t("Vazgeç", "Cancel")}</Button>}
          <Button tone="primary" busy={saving} disabled={!draft} onClick={() => draft && void save(draft)}>
            {t("Kaydet", "Save")}
          </Button>
        </div>
      </div>
    </Section>
  );
}

function Usage() {
  const { t } = useT();
  const f = useFormat();
  const [days, setDays] = useState(30);
  const { data, error } = useApiData(`admin:credit-usage:${days}`, () => api.admin.creditUsage(days));

  return (
    <Section
      title={t("Maliyet raporu", "Cost report")}
      action={
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputClass} w-auto py-1`} aria-label={t("Dönem", "Period")}>
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              {t(`Son ${d} gün`, `Last ${d} days`)}
            </option>
          ))}
        </select>
      }
    >
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.rows.length === 0 && <EmptyState>{t("Bu dönemde AI kullanımı yok.", "No AI usage in this period.")}</EmptyState>}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                <th className="pb-2 font-medium">{t("Görev", "Task")}</th>
                <th className="pb-2 font-medium">{t("Model", "Model")}</th>
                <th className="pb-2 text-right font-medium">{t("Çağrı", "Calls")}</th>
                <th className="pb-2 text-right font-medium">{t("Maliyet (USD)", "Cost (USD)")}</th>
                <th className="pb-2 text-right font-medium">{t("Kredi", "Credits")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.rows.map((r) => {
                const name = r.task ? TASK_NAMES[r.task] : undefined;
                return (
                  <tr key={`${r.task}/${r.model}/${r.variant}`} className="text-neutral-800 dark:text-neutral-200">
                    <td className="py-2">{name ? t(name[0], name[1]) : r.task ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">
                      {r.model ?? "—"}
                      {r.variant && <span className="text-neutral-400 dark:text-neutral-500"> · {r.variant}</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{f.num(r.calls)}</td>
                    <td className="py-2 text-right tabular-nums">{r.cost_usd.toFixed(2)}</td>
                    <td className="py-2 text-right tabular-nums">{f.num(r.credits)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-neutral-200 font-medium text-neutral-900 dark:border-neutral-700 dark:text-neutral-100">
                <td className="py-2" colSpan={3}>
                  {t("Toplam", "Total")}
                </td>
                <td className="py-2 text-right tabular-nums">{data.total_cost_usd.toFixed(2)}</td>
                <td className="py-2 text-right tabular-nums">{f.num(data.total_credits)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
        {t(
          "Maliyet, Modeller sayfasındaki fiyatlardan hesaplanır; fiyatı girilmemiş modeller 0 görünür. Kredi sistemi kapalıyken de ölçülür.",
          "Cost is calculated from the prices on the Models page; models without a price show 0. Measured even while the credit system is off.",
        )}
      </p>
    </Section>
  );
}

function Workspaces() {
  const { t } = useT();
  const f = useFormat();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [adjusting, setAdjusting] = useState<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(input.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [input]);

  const { data, error, loading, reload } = useApiData(`admin:credit-ws:${query}:${offset}`, () => api.admin.creditWorkspaces(query, offset, PAGE_SIZE));
  const total = data?.total ?? 0;

  return (
    <Section title={t("Bakiyeler", "Balances")} action={loading && data ? <Spinner size={16} /> : null}>
      <div className="space-y-4">
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("E-posta ya da çalışma alanı adıyla ara", "Search by email or workspace name")}
          className={inputClass}
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!data && !error && <BlockSpinner />}
        {data && data.items.length === 0 && <EmptyState>{t("Sonuç yok.", "No results.")}</EmptyState>}
        {data && data.items.length > 0 && (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.items.map((w) => (
              <li key={w.workspace_id} className="py-3">
                <WorkspaceRow
                  ws={w}
                  open={adjusting === w.workspace_id}
                  onToggle={() => setAdjusting(adjusting === w.workspace_id ? null : w.workspace_id)}
                  onDone={() => {
                    setAdjusting(null);
                    reload();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {data && total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <Button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              {t("Önceki", "Previous")}
            </Button>
            <span className="tabular-nums text-xs text-neutral-500 dark:text-neutral-400">
              {f.num(offset + 1)}–{f.num(Math.min(offset + PAGE_SIZE, total))} / {f.num(total)}
            </span>
            <Button disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
              {t("Sonraki", "Next")}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

function WorkspaceRow({ ws, open, onToggle, onDone }: { ws: AdminWorkspaceCredit; open: boolean; onToggle: () => void; onDone: () => void }) {
  const { t } = useT();
  const f = useFormat();
  const [amount, setAmount] = useState("");
  const [bucket, setBucket] = useState<"plan" | "purchased">("purchased");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const value = Number(amount);
  const valid = amount.trim() !== "" && Number.isInteger(value) && value !== 0;

  async function save() {
    setSaving(true);
    try {
      await api.admin.adjustCredits(ws.workspace_id, value, bucket, note.trim());
      toast.success(t("Bakiye güncellendi", "Balance updated"));
      setAmount("");
      setNote("");
      onDone();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const balance = ws.plan + ws.purchased;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{ws.owner_email ?? ws.name}</p>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {ws.name} · {t(`son 30 gün ${f.num(ws.used_30d)} kredi`, `${f.num(ws.used_30d)} credits in 30 days`)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {ws.subscription_status && <Badge tone="good">{ws.subscription_status}</Badge>}
          <Badge tone={balance > 0 ? "muted" : "warn"}>
            {t(`${f.num(balance)} kredi`, `${f.num(balance)} credits`)} ({t("plan", "plan")} {f.num(ws.plan)} · {t("satın alınan", "purchased")} {f.num(ws.purchased)})
          </Badge>
          <Button onClick={onToggle}>{open ? t("Kapat", "Close") : t("Düzelt", "Adjust")}</Button>
        </div>
      </div>
      {open && (
        <div className="grid gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 sm:grid-cols-[8rem_10rem_1fr_auto] sm:items-end dark:border-neutral-800 dark:bg-neutral-950">
          <Field label={t("Miktar (+/−)", "Amount (+/−)")}>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" className={inputClass} />
          </Field>
          <Field label={t("Kova", "Bucket")}>
            <select value={bucket} onChange={(e) => setBucket(e.target.value as "plan" | "purchased")} className={inputClass}>
              <option value="purchased">{t("Satın alınan", "Purchased")}</option>
              <option value="plan">{t("Plan", "Plan")}</option>
            </select>
          </Field>
          <Field label={t("Not", "Note")}>
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={t("ör. destek telafisi", "e.g. support refund")} className={inputClass} />
          </Field>
          <Button tone="primary" busy={saving} disabled={!valid} onClick={() => void save()}>
            {t("Uygula", "Apply")}
          </Button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Field, Section, Toggle, errorText, inputClass, useFormat } from "@/components/admin/ui";
import { AdminBilling, AdminProduct, AdminProductInput, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

function money(cents: number, currency: string, locale: string): string {
  try {
    return (cents / 100).toLocaleString(locale, { style: "currency", currency });
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Satılan planlar ve kredi paketleri (Lemon varyantlarına bağlı). */
export default function ProductsSection({ data, onChanged }: { data: AdminBilling; onChanged: () => void }) {
  const products = data.products;
  const { t, locale } = useT();
  const f = useFormat();
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function remove(p: AdminProduct) {
    if (!window.confirm(t(`“${p.name_tr}” silinsin mi?`, `Delete “${p.name_en}”?`))) return;
    setDeleting(p.id);
    try {
      await api.admin.deleteProduct(p.id);
      onChanged();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Section
      title={t("Planlar ve kredi paketleri", "Plans and credit packs")}
      action={
        editing === null && (
          <Button tone="primary" onClick={() => setEditing("new")}>
            {t("Ürün ekle", "Add product")}
          </Button>
        )
      }
    >
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        {t(
          "Ürünü önce Lemon Squeezy'de oluşturun, varyant numarasını buraya girin. Fiyatın asıl kaynağı Lemon'dur; buradaki fiyat yalnızca gösterim içindir. Plan kredisi her dönem yenilenir (devretmez), paket kredisi süresizdir.",
          "Create the product in Lemon Squeezy first and enter its variant ID here. Lemon is the source of truth for the price; the price here is for display only. Plan credits renew each period (no rollover); pack credits never expire.",
        )}
      </p>
      {editing !== null && (
        <ProductForm
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {products.length === 0 ? (
        <EmptyState>{t("Henüz ürün yok.", "No products yet.")}</EmptyState>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
          {products.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {t(p.name_tr, p.name_en)}
                  <Badge tone="muted">{p.kind === "plan" ? (p.interval === "year" ? t("yıllık plan", "yearly plan") : t("aylık plan", "monthly plan")) : t("paket", "pack")}</Badge>
                  {!p.active && <Badge tone="warn">{t("satışta değil", "not for sale")}</Badge>}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {money(p.price_cents, p.currency, locale)} · {t(`${f.num(p.credits)} kredi`, `${f.num(p.credits)} credits`)} · {t("varyant", "variant")} {p.variant_id}
                </p>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <Button onClick={() => setEditing(p)}>{t("Düzenle", "Edit")}</Button>
                <Button tone="danger" busy={deleting === p.id} onClick={() => void remove(p)}>
                  {t("Sil", "Delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ProductForm({ initial, onCancel, onSaved }: { initial: AdminProduct | null; onCancel: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [kind, setKind] = useState<AdminProduct["kind"]>(initial?.kind ?? "pack");
  const [nameTr, setNameTr] = useState(initial?.name_tr ?? "");
  const [nameEn, setNameEn] = useState(initial?.name_en ?? "");
  const [variant, setVariant] = useState(initial?.variant_id ?? "");
  const [creditsValue, setCreditsValue] = useState(initial ? String(initial.credits) : "");
  const [price, setPrice] = useState(initial ? (initial.price_cents / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [interval, setBillingInterval] = useState<"month" | "year">(initial?.interval ?? "month");
  const [active, setActive] = useState(initial?.active ?? true);
  const [sort, setSort] = useState(String(initial?.sort ?? 0));
  const [saving, setSaving] = useState(false);

  const creditsNum = Number(creditsValue);
  const priceNum = Number(price);
  const valid =
    nameTr.trim() && nameEn.trim() && /^[0-9]+$/.test(variant.trim()) && Number.isInteger(creditsNum) && creditsNum > 0 && price.trim() !== "" && priceNum >= 0 && /^[A-Z]{3}$/.test(currency);

  async function save() {
    const body: AdminProductInput = {
      kind,
      name_tr: nameTr.trim(),
      name_en: nameEn.trim(),
      variant_id: variant.trim(),
      credits: creditsNum,
      price_cents: Math.round(priceNum * 100),
      currency,
      interval: kind === "plan" ? interval : null,
      active,
      sort: Number(sort) || 0,
    };
    setSaving(true);
    try {
      if (initial) await api.admin.updateProduct(initial.id, body);
      else await api.admin.createProduct(body);
      toast.success(t("Ürün kaydedildi", "Product saved"));
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
          <select value={kind} onChange={(e) => setKind(e.target.value as AdminProduct["kind"])} className={inputClass}>
            <option value="pack">{t("Kredi paketi (tek seferlik)", "Credit pack (one-off)")}</option>
            <option value="plan">{t("Plan (abonelik)", "Plan (subscription)")}</option>
          </select>
        </Field>
        {kind === "plan" ? (
          <Field label={t("Ödeme aralığı", "Billing interval")}>
            <select value={interval} onChange={(e) => setBillingInterval(e.target.value as "month" | "year")} className={inputClass}>
              <option value="month">{t("Aylık", "Monthly")}</option>
              <option value="year">{t("Yıllık", "Yearly")}</option>
            </select>
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label={t("Ad (Türkçe)", "Name (Turkish)")}>
          <input value={nameTr} onChange={(e) => setNameTr(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t("Ad (İngilizce)", "Name (English)")}>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t("Lemon varyant no.", "Lemon variant ID")}>
          <input inputMode="numeric" value={variant} onChange={(e) => setVariant(e.target.value)} className={`${inputClass} font-mono`} />
        </Field>
        <Field label={kind === "plan" ? t("Dönem başına kredi", "Credits per period") : t("Kredi", "Credits")}>
          <input inputMode="numeric" value={creditsValue} onChange={(e) => setCreditsValue(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t("Fiyat (gösterim)", "Price (display)")}>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="19.00" className={inputClass} />
        </Field>
        <Field label={t("Para birimi", "Currency")}>
          <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={`${inputClass} font-mono`} />
        </Field>
        <Field label={t("Sıra", "Order")} hint={t("Küçük sayı önce gösterilir.", "Lower numbers are shown first.")}>
          <input inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <Toggle checked={active} onChange={setActive} label={t("Satışta", "For sale")} />
          {t("Satışta", "For sale")}
        </span>
        <div className="flex gap-2">
          <Button onClick={onCancel}>{t("Vazgeç", "Cancel")}</Button>
          <Button tone="primary" busy={saving} disabled={!valid} onClick={() => void save()}>
            {t("Kaydet", "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

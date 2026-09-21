"use client";

import { useMemo, useState } from "react";
import { api, DestinationInput, ShippingProfile, ShippingProfileInput } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { COUNTRIES, countryName } from "./countries";
import { SectionHeader, errorText, iconBtn, inputCls, isPermissionError, labelCls, outlineBtn } from "./shared";

type Kind = "country" | "eu" | "non_eu" | "everywhere";

type FormDest = {
  key: string;
  id: number | null;
  kind: Kind;
  country: string;
  free: boolean;
  primary: string;
  secondary: string;
  min: string;
  max: string;
  /** Teslimat süresi kargo servisinden hesaplanıyor (gün alanı yok; dokunulmaz). */
  carrierBased: boolean;
};

type FormState = { title: string; origin: string; postal: string; dests: FormDest[] };

let keySeq = 0;
const nextKey = () => `d${++keySeq}`;

const money = (m: { amount: number; divisor: number } | null | undefined) => (m ? m.amount / m.divisor : 0);

function kindName(d: Pick<FormDest, "kind" | "country">): string {
  if (d.kind === "eu") return "Avrupa Birliği";
  if (d.kind === "non_eu") return "AB dışı Avrupa";
  if (d.kind === "everywhere") return "Diğer tüm ülkeler";
  return countryName(d.country);
}

function fromProfile(p: ShippingProfile, copy: boolean): FormState {
  const dests: FormDest[] = (p.shipping_profile_destinations ?? []).map((d) => {
    const kind: Kind = d.destination_country_iso ? "country" : d.destination_region === "eu" ? "eu" : d.destination_region === "non_eu" ? "non_eu" : "everywhere";
    const primary = money(d.primary_cost);
    const secondary = money(d.secondary_cost);
    const carrierBased = d.min_delivery_days == null;
    return {
      key: nextKey(),
      id: copy ? null : (d.shipping_profile_destination_id ?? null),
      kind,
      country: d.destination_country_iso ?? "",
      free: primary === 0 && secondary === 0,
      primary: String(primary),
      secondary: String(secondary),
      // Kopyada kargo servisi bilgisi taşınmaz; gün aralığı elle girilir.
      min: d.min_delivery_days != null ? String(d.min_delivery_days) : copy ? "1" : "",
      max: d.max_delivery_days != null ? String(d.max_delivery_days) : copy ? "7" : "",
      carrierBased: copy ? false : carrierBased,
    };
  });
  return {
    title: copy ? `${p.title} (kopya)` : p.title,
    origin: p.origin_country_iso ?? "TR",
    postal: p.origin_postal_code ?? "",
    dests,
  };
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

function validate(f: FormState): string | null {
  if (!f.title.trim()) return "Profil adı gerekli.";
  if (!f.origin) return "Çıkış ülkesi gerekli.";
  if (f.dests.length === 0) return "En az bir hedef gerekli.";
  for (const d of f.dests) {
    const name = kindName(d) || "Hedef";
    if (d.kind === "country" && !d.country) return "Bir hedef için ülke seçilmemiş.";
    if (!d.free && (!(num(d.primary) >= 0) || !(num(d.secondary) >= 0))) return `${name}: ücretleri gir (0 veya üzeri).`;
    if (!d.carrierBased) {
      const mn = num(d.min);
      const mx = num(d.max);
      if (!(mn >= 1) || !(mx >= mn)) return `${name}: teslimat günleri (en az ≥ 1, en fazla ≥ en az) geçersiz.`;
    }
  }
  return null;
}

function toInput(f: FormState): ShippingProfileInput {
  const destinations: DestinationInput[] = f.dests.map((d) => ({
    id: d.id,
    destination_country_iso: d.kind === "country" ? d.country : null,
    destination_region: d.kind === "eu" || d.kind === "non_eu" ? d.kind : null,
    primary_cost: d.free ? 0 : num(d.primary),
    secondary_cost: d.free ? 0 : num(d.secondary),
    min_delivery_days: d.carrierBased ? null : num(d.min),
    max_delivery_days: d.carrierBased ? null : num(d.max),
  }));
  return { title: f.title.trim(), origin_country_iso: f.origin, origin_postal_code: f.postal.trim() || null, destinations };
}

function ProfileForm({
  initial,
  title,
  currency,
  affectedListings,
  onCancel,
  onSave,
}: {
  initial: FormState;
  title: string;
  currency: string;
  affectedListings: number;
  onCancel: () => void;
  /** false döndürürse (kullanıcı onaydan vazgeçti) form açık kalır. */
  onSave: (v: ShippingProfileInput) => Promise<boolean>;
}) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const symbol = useMemo(
    () => new Intl.NumberFormat("tr-TR", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency,
    [currency]
  );

  const used = new Set(f.dests.map((d) => (d.kind === "country" ? `c:${d.country}` : d.kind)));
  const problem = validate(f);
  const patchDest = (key: string, p: Partial<FormDest>) => setF((prev) => ({ ...prev, dests: prev.dests.map((d) => (d.key === key ? { ...d, ...p } : d)) }));

  function addDest(value: string) {
    if (!value) return;
    const kind: Kind = value.startsWith("c:") ? "country" : (value as Kind);
    setF((prev) => ({
      ...prev,
      dests: [
        ...prev.dests,
        { key: nextKey(), id: null, kind, country: value.startsWith("c:") ? value.slice(2) : "", free: false, primary: "", secondary: "", min: "3", max: "10", carrierBased: false },
      ],
    }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const done = await onSave(toInput(f));
      if (!done) setBusy(false);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      z={95}
      widthClass="max-w-2xl"
      title={title}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            Vazgeç
          </button>
          <button onClick={submit} disabled={!!problem || busy} className={btnPrimary}>
            {busy ? "Kaydediliyor…" : affectedListings > 0 ? `Kaydet ve uygula (${affectedListings} listing)` : "Kaydet"}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {affectedListings > 0 && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Bu profil <b>{affectedListings} listing</b>&apos;de kullanılıyor; değişiklik hepsini anında etkiler.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className={labelCls}>Profil adı</label>
            <input value={f.title} maxLength={100} onChange={(e) => setF({ ...f, title: e.target.value })} className={`${inputCls} w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Çıkış ülkesi</label>
            <select value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} className={`${inputCls} w-full`}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Çıkış posta kodu</label>
            <input value={f.postal} onChange={(e) => setF({ ...f, postal: e.target.value })} className={`${inputCls} w-full`} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Standart kargo</p>
          <div className="space-y-4">
            {f.dests.map((d) => (
              <div key={d.key} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{kindName(d)}</p>
                  <button type="button" className={`${iconBtn} text-red-600`} disabled={f.dests.length <= 1} onClick={() => setF((prev) => ({ ...prev, dests: prev.dests.filter((x) => x.key !== d.key) }))}>
                    Kaldır
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Ne kadar ücret alacaksın</label>
                    <select value={d.free ? "free" : "fixed"} onChange={(e) => patchDest(d.key, { free: e.target.value === "free" })} className={`${inputCls} w-full`}>
                      <option value="free">Ücretsiz kargo</option>
                      <option value="fixed">Sabit ücret</option>
                    </select>
                  </div>
                  {!d.carrierBased ? (
                    <div>
                      <label className={labelCls}>Teslimat süresi (iş günü)</label>
                      <div className="flex items-center gap-2">
                        <input value={d.min} onChange={(e) => patchDest(d.key, { min: e.target.value })} inputMode="numeric" className={`${inputCls} w-full`} />
                        <span>–</span>
                        <input value={d.max} onChange={(e) => patchDest(d.key, { max: e.target.value })} inputMode="numeric" className={`${inputCls} w-full`} />
                      </div>
                    </div>
                  ) : (
                    <p className="self-end text-xs text-neutral-500">Teslimat süresi kargo servisinden hesaplanır (değiştirilmez).</p>
                  )}
                  {!d.free && (
                    <>
                      <div>
                        <label className={labelCls}>Bir ürün</label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-neutral-500">{symbol}</span>
                          <input value={d.primary} onChange={(e) => patchDest(d.key, { primary: e.target.value })} inputMode="decimal" className={`${inputCls} w-full`} />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Ek ürün</label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-neutral-500">{symbol}</span>
                          <input value={d.secondary} onChange={(e) => patchDest(d.key, { secondary: e.target.value })} inputMode="decimal" className={`${inputCls} w-full`} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <label className={labelCls}>Hedef ekle</label>
            <select value="" onChange={(e) => addDest(e.target.value)} className={`${inputCls} w-full sm:w-72`}>
              <option value="">Seç…</option>
              {!used.has("eu") && <option value="eu">Avrupa Birliği</option>}
              {!used.has("non_eu") && <option value="non_eu">AB dışı Avrupa</option>}
              {!used.has("everywhere") && <option value="everywhere">Diğer tüm ülkeler</option>}
              {COUNTRIES.filter((c) => !used.has(`c:${c.code}`)).map((c) => (
                <option key={c.code} value={`c:${c.code}`}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {problem && <p className="text-xs text-neutral-500">{problem}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

export default function ShippingProfilesSection({
  shopId,
  profiles,
  onChanged,
  onPermissionError,
}: {
  shopId: number;
  profiles: ShippingProfile[] | null;
  onChanged: () => void;
  onPermissionError: () => void;
}) {
  const [form, setForm] = useState<{ id: number | null; title: string; initial: FormState; affected: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();

  const currency = profiles?.flatMap((p) => p.shipping_profile_destinations ?? []).find((d) => d.primary_cost)?.primary_cost?.currency_code ?? "USD";

  async function save(v: ShippingProfileInput): Promise<boolean> {
    if (form?.id && form.affected > 0) {
      const ok = await confirm({
        title: `${form.affected} listing etkilenecek`,
        message: "Bu değişiklik profili kullanan tüm listing'lere anında uygulanır. Devam edilsin mi?",
        confirmLabel: "Kaydet ve uygula",
      });
      if (!ok) return false;
    }
    try {
      if (form?.id) await api.shops.updateShippingProfile(shopId, form.id, v);
      else await api.shops.createShippingProfile(shopId, v);
    } catch (e) {
      if (isPermissionError(e)) onPermissionError();
      throw e;
    }
    setForm(null);
    onChanged();
    return true;
  }

  async function remove(p: ShippingProfile) {
    const ok = await confirm({
      title: "Kargo profili silinsin mi?",
      message: `"${p.title}" Etsy'den silinecek.`,
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.shops.deleteShippingProfile(shopId, p.shipping_profile_id);
      onChanged();
    } catch (e) {
      if (isPermissionError(e)) onPermissionError();
      setError(errorText(e));
    }
  }

  const blankForm = (): FormState => ({
    title: "",
    origin: "TR",
    postal: "",
    dests: [{ key: nextKey(), id: null, kind: "everywhere", country: "", free: false, primary: "", secondary: "", min: "3", max: "10", carrierBased: false }],
  });

  return (
    <section>
      <SectionHeader
        title="Kargo profilleri"
        description="Benzer kargo ücretli listing'ler için ortak profiller. Bir profili düzenlemek, onu kullanan tüm listing'leri etkiler."
        action={
          <button onClick={() => setForm({ id: null, title: "Yeni kargo profili", initial: blankForm(), affected: 0 })} className={outlineBtn}>
            + Profil oluştur
          </button>
        }
      />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {profiles === null && <p className="text-sm text-neutral-400">Yükleniyor…</p>}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold text-neutral-500">
              <th className="px-4 py-3">Ad</th>
              <th className="px-4 py-3">Çıkış</th>
              <th className="px-4 py-3">Aktif listing</th>
              <th className="px-4 py-3 text-right">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p) => {
              const calculated = p.profile_type === "calculated";
              const n = p.active_listings_count ?? 0;
              return (
                <tr key={p.shipping_profile_id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                    {p.title}
                    <span className="ml-2 rounded-full border border-neutral-400 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
                      {calculated ? "Hesaplanan" : "Sabit"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">{p.origin_postal_code ?? p.origin_country_iso}</td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">{n}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        className={iconBtn}
                        disabled={calculated}
                        title={calculated ? "Hesaplanan profiller yalnızca Etsy panelinden düzenlenir" : "Düzenle"}
                        onClick={() => setForm({ id: p.shipping_profile_id, title: `Düzenle: ${p.title}`, initial: fromProfile(p, false), affected: n })}
                      >
                        Düzenle
                      </button>
                      <button
                        className={iconBtn}
                        disabled={calculated}
                        title="Kopyala"
                        onClick={() => setForm({ id: null, title: "Profili kopyala", initial: fromProfile(p, true), affected: 0 })}
                      >
                        Kopyala
                      </button>
                      <button
                        className={`${iconBtn} text-red-600`}
                        disabled={n > 0}
                        title={n > 0 ? "Listing'lerde kullanılıyor" : "Sil"}
                        onClick={() => remove(p)}
                      >
                        Sil
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Aktif listing sayısı yerel önbellekteki listing&apos;lerden hesaplanır; tam senkronizasyondan sonra Etsy ile aynı olur.</p>
      {form && (
        <ProfileForm
          initial={form.initial}
          title={form.title}
          currency={currency}
          affectedListings={form.affected}
          onCancel={() => setForm(null)}
          onSave={save}
        />
      )}
      {confirmElement}
    </section>
  );
}

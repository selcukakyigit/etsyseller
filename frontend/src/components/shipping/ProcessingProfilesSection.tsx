"use client";

import { useState } from "react";
import { api, ProcessingProfileInput, ReadinessStateDefinition } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Pager, SectionHeader, errorText, iconBtn, inputCls, isPermissionError, labelCls, outlineBtn } from "./shared";

const PAGE = 5;

export const processingTitle = (state: string) => (state === "made_to_order" ? "Sipariş üzerine üretim" : "Kargoya hazır");

/** Etsy etiketinden ("1-2 weeks", "3 days") süre ve birimi çıkarır; olmazsa gün değerlerine düşer. */
function parseDuration(p: ReadinessStateDefinition): { min: number; max: number; unit: "days" | "weeks" } {
  const m = p.processing_days_display_label?.match(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*(day|week)/i);
  if (m) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    return { min: a, max: b, unit: m[3].toLowerCase() === "week" ? "weeks" : "days" };
  }
  return { min: p.min_processing_days ?? 1, max: p.max_processing_days ?? 1, unit: "days" };
}

function ProfileForm({
  initial,
  editing,
  onCancel,
  onSave,
}: {
  initial: ProcessingProfileInput;
  editing: boolean;
  onCancel: () => void;
  onSave: (v: ProcessingProfileInput) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = v.min_processing_time >= 1 && v.max_processing_time >= v.min_processing_time;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSave(v);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      z={95}
      widthClass="max-w-md"
      title={editing ? "İşlem profilini düzenle" : "Yeni işlem profili"}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            Vazgeç
          </button>
          <button onClick={submit} disabled={!valid || busy} className={btnPrimary}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Tür</label>
          <select
            value={v.readiness_state}
            onChange={(e) => setV({ ...v, readiness_state: e.target.value as ProcessingProfileInput["readiness_state"] })}
            className={`${inputCls} w-full`}
          >
            <option value="ready_to_ship">Kargoya hazır</option>
            <option value="made_to_order">Sipariş üzerine üretim</option>
          </select>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>En az</label>
            <input type="number" min={1} value={v.min_processing_time} onChange={(e) => setV({ ...v, min_processing_time: Number(e.target.value) })} className={`${inputCls} w-full`} />
          </div>
          <div className="flex-1">
            <label className={labelCls}>En fazla</label>
            <input type="number" min={1} value={v.max_processing_time} onChange={(e) => setV({ ...v, max_processing_time: Number(e.target.value) })} className={`${inputCls} w-full`} />
          </div>
          <div className="flex-1">
            <label className={labelCls}>Birim</label>
            <select value={v.processing_time_unit} onChange={(e) => setV({ ...v, processing_time_unit: e.target.value as "days" | "weeks" })} className={`${inputCls} w-full`}>
              <option value="days">Gün</option>
              <option value="weeks">Hafta</option>
            </select>
          </div>
        </div>
        {editing && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Bu profili kullanan tüm listing&apos;ler yeni süreyle güncellenir.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

export default function ProcessingProfilesSection({
  shopId,
  profiles,
  onChanged,
  onPermissionError,
}: {
  shopId: number;
  profiles: ReadinessStateDefinition[] | null;
  onChanged: () => void;
  onPermissionError: () => void;
}) {
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ id: number | null; initial: ProcessingProfileInput } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();

  const list = profiles ?? [];
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const visible = list.slice(page * PAGE, (page + 1) * PAGE);

  const fail = (e: unknown) => {
    if (isPermissionError(e)) onPermissionError();
    throw e;
  };

  async function save(v: ProcessingProfileInput) {
    try {
      if (form?.id) await api.shops.updateProcessingProfile(shopId, form.id, v);
      else await api.shops.createProcessingProfile(shopId, v);
    } catch (e) {
      return fail(e);
    }
    setForm(null);
    onChanged();
  }

  async function remove(p: ReadinessStateDefinition) {
    const ok = await confirm({
      title: "İşlem profili silinsin mi?",
      message: `"${processingTitle(p.readiness_state)} (${p.processing_days_display_label})" Etsy'den silinecek.`,
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.shops.deleteProcessingProfile(shopId, p.readiness_state_id);
      onChanged();
    } catch (e) {
      if (isPermissionError(e)) onPermissionError();
      setError(errorText(e));
    }
  }

  return (
    <section>
      <SectionHeader
        title="İşlem profilleri"
        description="Siparişlerin ne kadar sürede hazırlanacağını belirleyen profiller. Listing'lere ya da varyasyonlara uygulanır."
        action={
          <button
            onClick={() =>
              setForm({ id: null, initial: { readiness_state: "made_to_order", min_processing_time: 1, max_processing_time: 3, processing_time_unit: "days" } })
            }
            className={outlineBtn}
          >
            + Yeni oluştur
          </button>
        }
      />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {profiles === null && <p className="text-sm text-neutral-400">Yükleniyor…</p>}
      <div className="space-y-2">
        {visible.map((p) => (
          <div key={p.readiness_state_id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {processingTitle(p.readiness_state)} ({p.processing_days_display_label})
              </p>
              <p className="text-xs text-neutral-500">{p.active_listings_count ?? 0} listing&apos;e uygulanmış</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                className={iconBtn}
                onClick={() => {
                  const d = parseDuration(p);
                  setForm({
                    id: p.readiness_state_id,
                    initial: {
                      readiness_state: p.readiness_state === "made_to_order" ? "made_to_order" : "ready_to_ship",
                      min_processing_time: d.min,
                      max_processing_time: d.max,
                      processing_time_unit: d.unit,
                    },
                  });
                }}
              >
                Düzenle
              </button>
              <button
                className={`${iconBtn} text-red-600`}
                disabled={(p.active_listings_count ?? 0) > 0}
                title={(p.active_listings_count ?? 0) > 0 ? "Listing'lerde kullanılıyor" : "Sil"}
                onClick={() => remove(p)}
              >
                Sil
              </button>
            </div>
          </div>
        ))}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
      {form && <ProfileForm initial={form.initial} editing={form.id !== null} onCancel={() => setForm(null)} onSave={save} />}
      {confirmElement}
    </section>
  );
}

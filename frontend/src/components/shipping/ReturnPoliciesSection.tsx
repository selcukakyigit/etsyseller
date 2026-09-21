"use client";

import { useState } from "react";
import { api, ReturnPolicy, ReturnPolicyInput } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SectionHeader, errorText, iconBtn, inputCls, isPermissionError, labelCls, outlineBtn } from "./shared";

const DEADLINES = [7, 14, 21, 30, 45, 60, 90];

export function returnTitle(p: Pick<ReturnPolicy, "accepts_returns" | "accepts_exchanges">): string {
  if (!p.accepts_returns && !p.accepts_exchanges) return "İade ve değişim kabul edilmiyor";
  return p.accepts_returns && p.accepts_exchanges ? "İade ve değişim" : p.accepts_returns ? "Yalnızca iade" : "Yalnızca değişim";
}

function PolicyForm({
  initial,
  editing,
  onCancel,
  onSave,
}: {
  initial: ReturnPolicyInput;
  editing: boolean;
  onCancel: () => void;
  onSave: (v: ReturnPolicyInput) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accepts = v.accepts_returns || v.accepts_exchanges;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...v, return_deadline: accepts ? v.return_deadline : null });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      z={95}
      widthClass="max-w-md"
      title={editing ? "İade politikasını düzenle" : "Yeni iade politikası"}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            Vazgeç
          </button>
          <button onClick={submit} disabled={busy || (accepts && !v.return_deadline)} className={btnPrimary}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
          <input type="checkbox" checked={v.accepts_returns} onChange={(e) => setV({ ...v, accepts_returns: e.target.checked })} className="h-4 w-4" />
          İade kabul ediyorum
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
          <input type="checkbox" checked={v.accepts_exchanges} onChange={(e) => setV({ ...v, accepts_exchanges: e.target.checked })} className="h-4 w-4" />
          Değişim kabul ediyorum
        </label>
        {accepts && (
          <div>
            <label className={labelCls}>İade süresi</label>
            <select value={v.return_deadline ?? ""} onChange={(e) => setV({ ...v, return_deadline: e.target.value ? Number(e.target.value) : null })} className={`${inputCls} w-full`}>
              <option value="">Seç…</option>
              {DEADLINES.map((d) => (
                <option key={d} value={d}>
                  {d} gün
                </option>
              ))}
            </select>
          </div>
        )}
        {editing && <p className="text-xs text-amber-700 dark:text-amber-300">Bu politikayı kullanan tüm listing&apos;ler güncellenir.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

export default function ReturnPoliciesSection({
  shopId,
  policies,
  onChanged,
  onPermissionError,
}: {
  shopId: number;
  policies: ReturnPolicy[] | null;
  onChanged: () => void;
  onPermissionError: () => void;
}) {
  const [form, setForm] = useState<{ id: number | null; initial: ReturnPolicyInput } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();

  async function save(v: ReturnPolicyInput) {
    try {
      if (form?.id) await api.shops.updateReturnPolicy(shopId, form.id, v);
      else await api.shops.createReturnPolicy(shopId, v);
    } catch (e) {
      if (isPermissionError(e)) onPermissionError();
      throw e;
    }
    setForm(null);
    onChanged();
  }

  async function remove(p: ReturnPolicy) {
    const ok = await confirm({
      title: "İade politikası silinsin mi?",
      message: `"${returnTitle(p)}${p.return_deadline ? ` · ${p.return_deadline} gün` : ""}" Etsy'den silinecek.`,
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.shops.deleteReturnPolicy(shopId, p.return_policy_id);
      onChanged();
    } catch (e) {
      if (isPermissionError(e)) onPermissionError();
      setError(errorText(e));
    }
  }

  return (
    <section>
      <SectionHeader
        title="İade ve değişim politikaları"
        description="Listing'lerde alıcıya gösterilen iade koşulları."
        action={
          <button onClick={() => setForm({ id: null, initial: { accepts_returns: true, accepts_exchanges: true, return_deadline: 14 } })} className={outlineBtn}>
            + Yeni oluştur
          </button>
        }
      />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {policies === null && <p className="text-sm text-neutral-400">Yükleniyor…</p>}
      <div className="space-y-2">
        {(policies ?? []).map((p) => (
          <div key={p.return_policy_id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {returnTitle(p)}
                {p.return_deadline ? ` · ${p.return_deadline} gün` : ""}
              </p>
              <p className="text-xs text-neutral-500">{p.active_listings_count ?? 0} listing&apos;e uygulanmış</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                className={iconBtn}
                onClick={() =>
                  setForm({ id: p.return_policy_id, initial: { accepts_returns: p.accepts_returns, accepts_exchanges: p.accepts_exchanges, return_deadline: p.return_deadline } })
                }
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
      {form && <PolicyForm initial={form.initial} editing={form.id !== null} onCancel={() => setForm(null)} onSave={save} />}
      {confirmElement}
    </section>
  );
}

"use client";

import { useState } from "react";
import { api, ReturnPolicy, ReturnPolicyInput } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SectionHeader, errorText, iconBtn, inputCls, isPermissionError, labelCls, outlineBtn } from "./shared";
import { tNow, useT } from "@/lib/i18n-client";
import { BlockSpinner } from "@/components/ui/Spinner";

const DEADLINES = [7, 14, 21, 30, 45, 60, 90];

export function returnTitle(p: Pick<ReturnPolicy, "accepts_returns" | "accepts_exchanges">): string {
  if (!p.accepts_returns && !p.accepts_exchanges) return tNow("İade ve değişim kabul edilmiyor", "No returns or exchanges");
  return p.accepts_returns && p.accepts_exchanges
    ? tNow("İade ve değişim", "Returns and exchanges")
    : p.accepts_returns
      ? tNow("Yalnızca iade", "Returns only")
      : tNow("Yalnızca değişim", "Exchanges only");
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
  const { t } = useT();
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
      title={editing ? t("İade politikasını düzenle", "Edit return policy") : t("Yeni iade politikası", "New return policy")}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button onClick={submit} disabled={busy || (accepts && !v.return_deadline)} className={btnPrimary}>
            {busy ? t("Kaydediliyor…", "Saving…") : t("Kaydet", "Save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
          <input type="checkbox" checked={v.accepts_returns} onChange={(e) => setV({ ...v, accepts_returns: e.target.checked })} className="h-4 w-4" />
          {t("İade kabul ediyorum", "I accept returns")}
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
          <input type="checkbox" checked={v.accepts_exchanges} onChange={(e) => setV({ ...v, accepts_exchanges: e.target.checked })} className="h-4 w-4" />
          {t("Değişim kabul ediyorum", "I accept exchanges")}
        </label>
        {accepts && (
          <div>
            <label className={labelCls}>{t("İade süresi", "Return window")}</label>
            <select value={v.return_deadline ?? ""} onChange={(e) => setV({ ...v, return_deadline: e.target.value ? Number(e.target.value) : null })} className={`${inputCls} w-full`}>
              <option value="">{t("Seç…", "Choose…")}</option>
              {DEADLINES.map((d) => (
                <option key={d} value={d}>
                  {d} {t("gün", "days")}
                </option>
              ))}
            </select>
          </div>
        )}
        {editing && <p className="text-xs text-amber-700 dark:text-amber-300">{t("Bu politikayı kullanan tüm listing'ler güncellenir.", "All listings using this policy are updated.")}</p>}
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
  const { t } = useT();
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
      title: t("İade politikası silinsin mi?", "Delete return policy?"),
      message: t(
        `"${returnTitle(p)}${p.return_deadline ? ` · ${p.return_deadline} gün` : ""}" Etsy'den silinecek.`,
        `"${returnTitle(p)}${p.return_deadline ? ` · ${p.return_deadline} days` : ""}" will be deleted from Etsy.`,
      ),
      confirmLabel: t("Sil", "Delete"),
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
        title={t("İade ve değişim politikaları", "Return and exchange policies")}
        description={t("Listing'lerde alıcıya gösterilen iade koşulları.", "The return terms shown to buyers on listings.")}
        action={
          <button onClick={() => setForm({ id: null, initial: { accepts_returns: true, accepts_exchanges: true, return_deadline: 14 } })} className={outlineBtn}>
            {t("+ Yeni oluştur", "+ Create new")}
          </button>
        }
      />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {policies === null && <BlockSpinner />}
      <div className="space-y-2">
        {(policies ?? []).map((p) => (
          <div key={p.return_policy_id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {returnTitle(p)}
                {p.return_deadline ? ` · ${p.return_deadline} ${t("gün", "days")}` : ""}
              </p>
              <p className="text-xs text-neutral-500">{t(`${p.active_listings_count ?? 0} listing'e uygulanmış`, `Used by ${p.active_listings_count ?? 0} listings`)}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                className={iconBtn}
                onClick={() =>
                  setForm({ id: p.return_policy_id, initial: { accepts_returns: p.accepts_returns, accepts_exchanges: p.accepts_exchanges, return_deadline: p.return_deadline } })
                }
              >
                {t("Düzenle", "Edit")}
              </button>
              <button
                className={`${iconBtn} text-red-600`}
                disabled={(p.active_listings_count ?? 0) > 0}
                title={(p.active_listings_count ?? 0) > 0 ? t("Listing'lerde kullanılıyor", "Used by listings") : t("Sil", "Delete")}
                onClick={() => remove(p)}
              >
                {t("Sil", "Delete")}
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

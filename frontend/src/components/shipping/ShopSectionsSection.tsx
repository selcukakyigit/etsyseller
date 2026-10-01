"use client";

import { useState } from "react";
import { api, ShopSection } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SectionHeader, errorText, iconBtn, inputCls, isPermissionError, outlineBtn } from "./shared";

const TITLE_MAX = 24; // Etsy'nin mağaza bölümü başlığı sınırı
const MAX_SECTIONS = 20; // Etsy: bir mağaza en fazla 20 bölüm kullanabilir

function SectionForm({
  initial,
  editing,
  onCancel,
  onSave,
}: {
  initial: string;
  editing: boolean;
  onCancel: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(t);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      z={95}
      widthClass="max-w-sm"
      title={editing ? "Bölümü yeniden adlandır" : "Yeni bölüm"}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            Vazgeç
          </button>
          <button onClick={submit} disabled={busy || !title.trim()} className={btnPrimary}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </>
      }
    >
      <div className="space-y-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Bölüm başlığı"
          className={`${inputCls} w-full`}
        />
        <p className="text-right text-xs text-neutral-400">
          {title.length}/{TITLE_MAX}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

/** Etsy Shop Manager'daki "Manage Sections" ekranının karşılığı. Tek fark: Etsy'nin genel API'si bölüm
 * sırasını (rank) yazdırmıyor — yalnızca sürükle-bırak sıralama burada yok, oluşturma/yeniden adlandırma/
 * silme Etsy'deki gibi çalışıyor. */
export default function ShopSectionsSection({
  shopId,
  sections,
  onChanged,
  onPermissionError,
  compact,
}: {
  shopId: number;
  sections: ShopSection[] | null;
  onChanged: () => void;
  onPermissionError: () => void;
  /** Bir Modal içinde ("Yönet" bağlantısından) gösterilirken kendi büyük başlığını basmaz — Modal'ın kendi
   * başlığıyla çakışmasın diye; "+ Yeni bölüm" üstte, sade bir satırda kalır. */
  compact?: boolean;
}) {
  const [form, setForm] = useState<{ id: number | null; initial: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const atLimit = (sections?.length ?? 0) >= MAX_SECTIONS;

  async function save(title: string) {
    try {
      if (form?.id) await api.shops.updateShopSection(shopId, form.id, title);
      else await api.shops.createShopSection(shopId, title);
    } catch (e) {
      if (isPermissionError(e)) onPermissionError();
      throw e;
    }
    setForm(null);
    onChanged();
  }

  async function remove(s: ShopSection) {
    const ok = await confirm({
      title: "Bölüm silinsin mi?",
      message: `"${s.title}" Etsy'den silinecek.`,
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.shops.deleteShopSection(shopId, s.shop_section_id);
      onChanged();
    } catch (e) {
      if (isPermissionError(e)) onPermissionError();
      setError(errorText(e));
    }
  }

  const addButton = (
    <button onClick={() => setForm({ id: null, initial: "" })} disabled={atLimit} title={atLimit ? `Etsy sınırı: en fazla ${MAX_SECTIONS} bölüm` : undefined} className={`${outlineBtn} disabled:opacity-40`}>
      + Yeni bölüm
    </button>
  );

  return (
    <section>
      {compact ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {sections?.length ?? 0}/{MAX_SECTIONS} bölüm kullanılıyor · sıralama Etsy&apos;nin kendi mantığına göre belirleniyor
          </p>
          {addButton}
        </div>
      ) : (
        <SectionHeader
          title="Mağaza bölümleri"
          description={`Listing'leri gruplamak için kullanılan bölümler (${sections?.length ?? 0}/${MAX_SECTIONS}). Etsy'nin API'si sıralamayı (rank) desteklemiyor; sıra Etsy'nin kendi mantığına göre belirleniyor.`}
          action={addButton}
        />
      )}
      {atLimit && (
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
          Etsy sınırı: en fazla {MAX_SECTIONS} bölüm kullanılabilir. Yeni eklemek için önce kullanılmayan bir bölümü sil.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {sections === null && <p className="text-sm text-neutral-400">Yükleniyor…</p>}
      <div className="space-y-2">
        {(sections ?? []).map((s) => (
          <div
            key={s.shop_section_id}
            className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{s.title}</p>
              <p className="text-xs text-neutral-500">{s.active_listing_count ?? 0} aktif listing</p>
            </div>
            <div className="flex items-center gap-1">
              <button className={iconBtn} onClick={() => setForm({ id: s.shop_section_id, initial: s.title })}>
                Yeniden adlandır
              </button>
              <button
                className={`${iconBtn} text-red-600`}
                disabled={(s.active_listing_count ?? 0) > 0}
                title={(s.active_listing_count ?? 0) > 0 ? "Listing'lerde kullanılıyor" : "Sil"}
                onClick={() => remove(s)}
              >
                Sil
              </button>
            </div>
          </div>
        ))}
        {sections && sections.length === 0 && <p className="text-sm text-neutral-400">Henüz bölüm yok.</p>}
      </div>
      {form && <SectionForm initial={form.initial} editing={form.id !== null} onCancel={() => setForm(null)} onSave={save} />}
      {confirmElement}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, DescriptionTemplate } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";
import { toast } from "@/lib/toast";

// Ürün yazısı her zaman üste gelir (sunucu `{product}` yoksa öyle yerleştirir); kutuda yalnızca sabit metin görünür.
// Eski/asistanın kaydettiği şablonların başındaki "{product}" satırı gösterilmez.
const visibleBody = (body: string) => body.replace(/^\s*\{product\}\s*/, "");

const EXAMPLE = `We offer free express shipping with FedEx and DHL.

SATISFACTION GUARANTEED, OR YOUR MONEY BACK:
If you are not completely satisfied, contact us within 30 days and we will resolve it.`;

type Draft = { id: number | null; name: string; body: string; is_default: boolean };

export default function DescriptionTemplatesPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  const shopId = activeShop?.id ?? null;
  const [items, setItems] = useCached<DescriptionTemplate[]>(shopId ? `desc-templates:${shopId}` : null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, confirmElement] = useConfirm();

  useEffect(() => {
    if (!shopId) return;
    api.descriptionTemplates
      .list(shopId)
      .then((r) => {
        setItems(r.templates);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("Yüklenemedi", "Could not load")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, setItems]);

  async function reload() {
    if (!shopId) return;
    const r = await api.descriptionTemplates.list(shopId);
    setItems(r.templates);
    setSelected((prev) => new Set([...prev].filter((id) => r.templates.some((x) => x.id === id))));
  }

  async function save() {
    if (!shopId || !draft) return;
    setSaving(true);
    try {
      const body = { name: draft.name, body: draft.body, is_default: draft.is_default };
      if (draft.id === null) await api.descriptionTemplates.create(shopId, body);
      else await api.descriptionTemplates.update(shopId, draft.id, body);
      await reload();
      setDraft(null);
      toast.success(t("Şablon kaydedildi", "Template saved"));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("Kaydedilemedi", "Could not save"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleDefault(item: DescriptionTemplate) {
    if (!shopId) return;
    try {
      await api.descriptionTemplates.update(shopId, item.id, { is_default: !item.is_default });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("Kaydedilemedi", "Could not save"));
    }
  }

  async function removeSelected(ids: number[]) {
    if (!shopId || ids.length === 0) return;
    const ok = await confirm({
      title: t(`${ids.length} şablon silinsin mi?`, `Delete ${ids.length} templates?`),
      message: t(
        "Listing'lere daha önce eklenmiş metinler değişmez. Silinen şablonun metni, başka bir şablon uygulanırken artık tanınmaz.",
        "Text already added to listings stays as it is. A deleted template's text is no longer recognized when another template is applied.",
      ),
      confirmLabel: t("Sil", "Delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.descriptionTemplates.remove(shopId, ids);
      await reload();
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("Silinemedi", "Could not delete"));
    }
  }



  const list = items ?? [];
  const allSelected = list.length > 0 && list.every((x) => selected.has(x.id));

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/templates">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("Açıklama şablonları", "Description templates")}</h1>
      {(bootError || error) && <p className="text-sm text-red-600 dark:text-red-400">{bootError ?? error}</p>}

      <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
        {t(
          "Kargo, garanti, iletişim gibi her listing'de tekrar eden metinleri bir kez yaz, kaydet. Ulagg yeni listing açarken varsayılan şablonu ekler; editörde ya da toplu düzenlemede istediğin şablonu uygulayabilirsin. Uygulanınca açıklamadaki eski şablon metni çıkarılır, yenisi konur; ürüne özel yazı korunur.",
          "Write the text that repeats in every listing (shipping, guarantee, contact) once and save it. Ulagg adds the default template to new listings, and you can apply any template in the editor or in bulk edit. When applied, the old template text in the description is removed and the new one is added; the product-specific text is kept.",
        )}
      </p>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
        {t(
          "İpucu: İlk şablonu oluştururken listing'lerindeki mevcut sabit metni aynen yapıştır. Böylece sonra şablonu düzenleyip uyguladığında eski metin tanınır ve yenisiyle değişir.",
          "Tip: when you create your first template, paste the fixed text your listings already have exactly as it is. Then, when you edit and apply the template later, the old text is recognized and replaced.",
        )}
      </p>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={list.length === 0}
              onChange={(e) => setSelected(e.target.checked ? new Set(list.map((x) => x.id)) : new Set())}
            />
            {selected.size > 0 ? t(`${selected.size} seçili`, `${selected.size} selected`) : t("Tümünü seç", "Select all")}
          </label>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => void removeSelected([...selected])}
                className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                {t("Seçilenleri sil", "Delete selected")}
              </button>
            )}
            <button
              type="button"
              disabled={!shopId}
              onClick={() => setDraft({ id: null, name: "", body: "", is_default: list.length === 0 })}
              className="rounded-full bg-[#D97757] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#C6613F] disabled:opacity-40"
            >
              + {t("Yeni şablon", "New template")}
            </button>
          </div>
        </div>

        {items === null && !error ? (
          <BlockSpinner />
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz şablon yok.", "No templates yet.")}</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {list.map((item) => (
              <li key={item.id} className="flex items-start gap-3 py-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(item.id)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDraft({ id: item.id, name: item.name, body: visibleBody(item.body), is_default: item.is_default })}>
                  <p className="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    <span className="truncate">{item.name}</span>
                    {item.is_default && (
                      <span className="shrink-0 rounded-full bg-[#D97757]/15 px-2 py-0.5 text-[11px] font-semibold text-[#C6613F] dark:text-[#E89A7F]">
                        {t("Varsayılan", "Default")}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-neutral-500 dark:text-neutral-400">{visibleBody(item.body)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleDefault(item)}
                  className="shrink-0 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {item.is_default ? t("Varsayılanı kaldır", "Unset default") : t("Varsayılan yap", "Make default")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {draft && (
        <Modal
          z={120}
          widthClass="max-w-2xl"
          title={draft.id === null ? t("Yeni şablon", "New template") : t("Şablonu düzenle", "Edit template")}
          onClose={saving ? undefined : () => setDraft(null)}
          footer={
            <>
              {draft.id !== null && (
                <button
                  type="button"
                  onClick={() => {
                    const id = draft.id as number;
                    setDraft(null);
                    void removeSelected([id]);
                  }}
                  className="mr-auto text-sm font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  {t("Sil", "Delete")}
                </button>
              )}
              <button type="button" onClick={() => setDraft(null)} disabled={saving} className={btnGhost}>
                {t("Vazgeç", "Cancel")}
              </button>
              <button type="button" onClick={() => void save()} disabled={saving || !draft.name.trim() || !draft.body.trim()} className={btnPrimary}>
                {saving ? t("Kaydediliyor…", "Saving…") : t("Kaydet", "Save")}
              </button>
            </>
          }
        >
          <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Şablon adı", "Template name")}</label>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 120) })}
            placeholder={t("Örn. Metal duvar sanatı", "E.g. Metal wall art")}
            className="mb-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t("Her açıklamanın sonuna eklenecek metin", "Text added to the end of every description")}
          </label>
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value.slice(0, 20000) })}
            rows={12}
            placeholder={EXAMPLE}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />
          <p className="mb-3 mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            {t(
              "Kargo, garanti, iletişim gibi her listing'de aynı kalan metni yapıştır. Ürüne özel yazı her zaman üstte kalır, bu metin altına eklenir.",
              "Paste the text that stays the same in every listing, such as shipping, guarantee and contact. The product-specific text always stays on top and this text is added below it.",
            )}
          </p>
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input type="checkbox" checked={draft.is_default} onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })} />
            {t("Varsayılan yap (Ulagg yeni listing'lere bunu ekler)", "Make default (Ulagg adds it to new listings)")}
          </label>
        </Modal>
      )}
      {confirmElement}
      </div>
    </AppShell>
  );
}

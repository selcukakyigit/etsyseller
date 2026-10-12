"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { errMsg } from "../core/errors";
import { badge, btnDanger, btnLink, btnOutline, btnPrimary, card, h2, muted, rowBorder, td, th } from "../core/ui";
import { money, qty as fmtQty } from "../core/units";
import { PackageApplyRow, PackageLine, PackageType, supplyApi } from "./api";
import PackageAssignments from "./PackageAssignments";
import PackageEditor, { draftOf, emptyLine, PackageDraft } from "./PackageEditor";
import { matchItem, PACKAGE_TEMPLATES } from "./packageTemplates";

/** Satırın kuralı okunur biçimde: "3 × uzun + 2 × kısa". */
function formula(l: PackageLine, t: (tr: string, en: string) => string, locale: string): string {
  const parts = [
    l.constant ? fmtQty(l.constant, locale) : "",
    l.per_long ? `${fmtQty(l.per_long, locale)} × ${t("uzun", "long")}` : "",
    l.per_short ? `${fmtQty(l.per_short, locale)} × ${t("kısa", "short")}` : "",
    l.per_area ? `${fmtQty(l.per_area, locale)} × ${t("alan", "area")}` : "",
  ].filter(Boolean);
  return parts.join(" + ");
}

/** "Paketler" sekmesi: bu tedarikçi kaydının paket türleri (ambalaj tarifleri), ürünlere atama ve ambalaj maliyetinin Finans'a yazılması. */
export default function PackagesTab({ entityId, currency }: { entityId: number; currency: string }) {
  const { t, locale } = useT();
  const { data, error, reload } = useApiData(`supply-packages:${entityId}`, () => supplyApi.packages.list(entityId));
  const { data: prices } = useApiData(`modkit-prices:${supplyApi.base}:${entityId}:false`, () => supplyApi.prices.list(entityId));
  const items = (prices?.items ?? []).filter((i) => (i.kind === "material" || i.kind === "service") && !i.archived);
  const [editing, setEditing] = useState<PackageDraft | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const own = (data?.items ?? []).filter((p) => p.own);

  function fromTemplate(id: string) {
    const tpl = PACKAGE_TEMPLATES.find((x) => x.id === id);
    if (!tpl) return;
    setEditing({
      id: null,
      name: t(tpl.tr, tpl.en),
      is_default: false,
      lines: tpl.lines.map((l) => ({
        ...emptyLine(),
        item: String(matchItem(l.hint, items)?.id ?? ""),
        constant: l.constant ? String(l.constant) : "",
        per_long: l.per_long ? String(l.per_long) : "",
        per_short: l.per_short ? String(l.per_short) : "",
        per_area: l.per_area ? String(l.per_area) : "",
      })),
    });
  }

  async function remove(p: PackageType) {
    if (!(await confirm({ title: t(`"${p.name}" silinsin mi?`, `Delete "${p.name}"?`), message: t("Ürünlere atanmış olduğu yerlerden de kalkar.", "It is also removed from the products it is assigned to."), destructive: true, confirmLabel: t("Sil", "Delete") }))) return;
    try {
      await supplyApi.packages.remove(entityId, p.id);
      reload();
    } catch (e) {
      toast.error(errMsg(e, t("Silinemedi", "Could not delete")));
    }
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className={h2}>{t("Paket türleri", "Package types")}</h2>
        <p className={`${muted} mb-3`}>
          {t(
            "Ambalaj tarifleri: her satır, fiyat listesindeki bir kalemin miktarını ürün ebadından hesaplar (ör. ahşap çerçeve: 3 × uzun + 2 × kısa kenar kadar çıta). Paket türünü ürünlere aşağıdan atarsın; ürünün ambalaj maliyeti Finans'ta ürünün birim maliyetine eklenir.",
            "Packaging recipes: each line works out the quantity of a price-list item from the product size (e.g. wooden frame: 3 × long + 2 × short side of slat). Assign a package type to products below; the packaging cost is added to the product's unit cost in Finance.",
          )}
        </p>
        {!editing && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setEditing({ id: null, name: "", is_default: false, lines: [emptyLine()] })} className={btnOutline}>
              + {t("Paket türü ekle", "Add package type")}
            </button>
            <select
              value=""
              onChange={(e) => fromTemplate(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              aria-label={t("Şablondan ekle", "Add from a template")}
            >
              <option value="">{t("Şablondan ekle…", "Add from a template…")}</option>
              {PACKAGE_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {t(tpl.tr, tpl.en)}
                </option>
              ))}
            </select>
          </div>
        )}
        {editing && (
          <div className="mb-4">
            <PackageEditor
              key={editing.id ?? `new-${editing.name}`}
              entityId={entityId}
              currency={currency}
              items={items}
              draft={editing}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
        {!data ? (
          error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <BlockSpinner />
          )
        ) : own.length === 0 ? (
          !editing && <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz paket türü yok. Bir şablondan başlayabilirsin.", "No package types yet. You can start from a template.")}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {own.map((p) => (
              <div key={p.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">
                    {p.name}
                    {p.is_default && <span className={`${badge} ml-2 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`}>{t("varsayılan", "default")}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setEditing(draftOf(p))} className={btnLink}>
                      {t("Düzenle", "Edit")}
                    </button>
                    <button type="button" onClick={() => void remove(p)} className={btnDanger}>
                      {t("Sil", "Delete")}
                    </button>
                  </div>
                </div>
                <ul className="space-y-0.5 text-xs text-neutral-600 dark:text-neutral-300">
                  {p.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3">
                      <span className="truncate">{l.item_name}</span>
                      <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{formula(l, t, locale)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {confirmEl}
      <PackageAssignments entityId={entityId} currency={currency} types={data?.items ?? []} />
      <ApplyCosts entityId={entityId} currency={currency} disabled={own.length === 0} />
    </div>
  );
}

/** Ambalaj maliyetlerini Finans'a yazma: önce önizleme (ürün başına eski ve yeni tutar), sonra onay. */
function ApplyCosts({ entityId, currency, disabled }: { entityId: number; currency: string; disabled: boolean }) {
  const { t, locale } = useT();
  const [rows, setRows] = useState<PackageApplyRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await supplyApi.packages.apply(entityId, dryRun);
      if (dryRun) {
        setRows(r.items);
        if (r.items.length === 0) toast.info(t("Değişen ambalaj maliyeti yok.", "No packaging cost has changed."));
      } else {
        toast.success(t(`${r.applied} ürünün ambalaj maliyeti Finans'a yazıldı`, `Packaging cost written to Finance for ${r.applied} product(s)`));
        setRows(null);
      }
    } catch (e) {
      toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
    }
    setBusy(false);
  }

  return (
    <section className={card}>
      <h2 className={h2}>{t("Finans'a uygula", "Apply to Finance")}</h2>
      <p className={`${muted} mb-3`}>
        {t(
          "Ürün başına ambalaj maliyeti, ürünün birim maliyetine bu tedarikçinin “Ambalaj” bileşeni olarak bugünden geçerli yazılır; eski siparişler değişmez. Fiyat listesini güncelleyince tekrar uygularsın.",
          "The packaging cost per product is written to the product's unit cost as this supplier's “Packaging” component, valid from today; older orders do not change. Apply again after updating the price list.",
        )}
      </p>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy || disabled} onClick={() => void run(true)} className={btnOutline}>
          {busy && !rows ? <Spinner size={14} /> : null}
          {t("Değişiklikleri önizle", "Preview changes")}
        </button>
      </div>
      {rows && rows.length > 0 && (
        <div className="mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className={rowBorder}>
                <th className={th}>{t("Ürün", "Product")}</th>
                <th className={`${th} text-right`}>{t("Şimdiki", "Current")}</th>
                <th className={`${th} text-right`}>{t("Yeni", "New")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.shop_id}-${r.listing_id}-${r.variant}`} className={rowBorder}>
                  <td className={td}>
                    <div className="line-clamp-1">{r.title || `#${r.listing_id}`}</div>
                    {r.variant && <div className="text-xs text-[#C6613F] dark:text-[#E8A48C]">{r.variant}</div>}
                  </td>
                  <td className={`${td} text-right text-neutral-500`}>{money(r.old, r.currency, locale)}</td>
                  <td className={`${td} text-right font-semibold text-emerald-700 dark:text-emerald-400`}>{money(r.new, r.currency, locale)}
                    {r.currency !== currency && <div className="text-[11px] font-normal text-neutral-400">{money(r.source_new, currency, locale)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" disabled={busy} onClick={() => void run(false)} className={btnPrimary}>
              {busy ? <Spinner size={14} /> : null}
              {t(`${rows.length} ürüne uygula`, `Apply to ${rows.length} product(s)`)}
            </button>
            <button type="button" disabled={busy} onClick={() => setRows(null)} className={btnLink}>
              {t("Vazgeç", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

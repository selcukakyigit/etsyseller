"use client";

import { useState } from "react";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import SubTabs from "../components/SubTabs";
import { errMsg } from "../core/errors";
import { btnDark, btnLink, card, h2, muted, rowBorder, td, th } from "../core/ui";
import { money } from "../core/units";
import { PackageType, ProductPackageRow, supplyApi } from "./api";

type Mode = "default" | "none" | "custom";

/** Ürünlerin paketleri: tanımlı her ürün için geçerli paket türleri (varsayılan dahil) ve ürün başına ambalaj maliyeti. "Düzenle" satırı üç seçenekli bir
 * karta açar: varsayılan paket türleri, ambalajsız ya da elle seçilen paket türleri. Tedarikçiden bağımsız ortak ürün listesidir. */
export default function PackageAssignments({ entityId, currency, types }: { entityId: number; currency: string; types: PackageType[] }) {
  const { t, locale } = useT();
  const { data, error, reload } = useApiData(`supply-product-packages:${entityId}`, () => supplyApi.productPackages.list(entityId));
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState<"new" | "done">("new");
  const names = new Map(types.map((p) => [p.id, p.name]));
  const keyOf = (r: ProductPackageRow) => `${r.shop_id}-${r.listing_id}-${r.variant}`;
  // İşlenmiş: pakete elle karar verilmiş (paket türü seçilmiş ya da ambalajsız); Yeni: hâlâ varsayılan paket türleriyle gidenler.
  const decided = (r: ProductPackageRow) => r.none || r.package_ids.length > 0;
  const all = data?.items ?? [];
  const shown = all.filter((r) => (view === "done") === decided(r));

  return (
    <section className={card}>
      <h2 className={h2}>{t("Ürünlerin paketleri", "Product packaging")}</h2>
      <p className={`${muted} mb-3`}>
        {t(
          "Ürün tanımlarındaki ürünler (tüm tedarikçilerde ortak). Paket atanmamış ürüne varsayılan paket türleri uygulanır; ambalaj maliyeti ürün ebadından hesaplanır.",
          "The products from the product definitions (shared by every supplier). Products with no package get the default package types; the packaging cost is worked out from the product size.",
        )}
      </p>
      {!data ? (
        error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <BlockSpinner />
        )
      ) : all.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          {t("Henüz ürün tanımı yok: Ürünler sekmesinden plaka DXF'i yükle.", "No product definitions yet: upload a sheet DXF in the Products tab.")}
        </p>
      ) : (
        <>
          <SubTabs
            tabs={[
              { id: "new", label: t("Yeni", "New"), count: all.filter((r) => !decided(r)).length },
              { id: "done", label: t("İşlenmiş", "Processed"), count: all.filter(decided).length },
            ]}
            value={view}
            onChange={setView}
          />
          {shown.length === 0 ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">
              {view === "new"
                ? t("Paketi belirlenmemiş ürün yok.", "No products waiting for a package.")
                : t("Henüz paketi belirlenmiş ürün yok. “Yeni”den bir ürünün paketini düzenle.", "No products with a package yet. Edit a product's package under “New”.")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className={rowBorder}>
                    <th className={th}>{t("Ürün", "Product")}</th>
                    <th className={th}>{t("Paket türleri", "Package types")}</th>
                    <th className={`${th} text-right`}>{t("Ambalaj", "Packaging")}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) =>
                    editing === keyOf(r) ? (
                      <Editor
                        key={keyOf(r)}
                        entityId={entityId}
                        row={r}
                        types={types}
                        onDone={() => {
                          setEditing(null);
                          reload();
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <tr key={keyOf(r)} className={`${rowBorder} odd:bg-neutral-50 dark:odd:bg-neutral-800/40`}>
                        <td className={td}>
                          <div className="line-clamp-1 max-w-xs font-medium text-neutral-900 dark:text-neutral-100">{r.title || `#${r.listing_id}`}</div>
                          {r.variant && <div className="max-w-xs truncate text-xs text-[#C6613F] dark:text-[#E8A48C]">{r.variant}</div>}
                        </td>
                        <td className={td}>
                          {r.resolved_ids.length > 0 ? (
                            r.resolved_ids.map((id) => names.get(id) ?? `#${id}`).join(" + ")
                          ) : (
                            <span className="text-neutral-400">{r.none ? t("ambalajsız", "no packaging") : "—"}</span>
                          )}
                          {r.package_ids.length === 0 && !r.none && r.resolved_ids.length > 0 && <span className="ml-1.5 text-[11px] text-neutral-400">({t("varsayılan", "default")})</span>}
                        </td>
                        <td className={`${td} whitespace-nowrap text-right`}>
                          {r.cost === null ? (
                            <span className="text-neutral-400" title={t("Ürün ebadı tanımlı değil", "The product size is not defined")}>
                              —
                            </span>
                          ) : (
                            money(r.cost, currency, locale)
                          )}
                        </td>
                        <td className={`${td} text-right`}>
                          <button type="button" onClick={() => setEditing(keyOf(r))} className={btnLink}>
                            {t("Düzenle", "Edit")}
                          </button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Editor({ entityId, row, types, onDone, onCancel }: { entityId: number; row: ProductPackageRow; types: PackageType[]; onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>(row.none ? "none" : row.package_ids.length > 0 ? "custom" : "default");
  const [picked, setPicked] = useState<number[]>(row.package_ids);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await supplyApi.productPackages.set(entityId, { shop_id: row.shop_id, listing_id: row.listing_id, variant: row.variant, package_ids: mode === "custom" ? picked : [], none: mode === "none" });
      onDone();
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
      setBusy(false);
    }
  }

  const option = (value: Mode, text: string) => (
    <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
      <input type="radio" checked={mode === value} onChange={() => setMode(value)} className="h-4 w-4 accent-[#D97757]" />
      {text}
    </label>
  );
  return (
    <tr className={rowBorder}>
      <td colSpan={4} className="py-3">
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
          <div className="font-medium text-neutral-900 dark:text-neutral-100">
            {row.title || `#${row.listing_id}`}
            {row.variant && <span className="ml-2 text-xs font-normal text-[#C6613F] dark:text-[#E8A48C]">{row.variant}</span>}
          </div>
          <div className="space-y-1.5">
            {option("default", t("Varsayılan paket türleri", "Default package types"))}
            {option("none", t("Ambalajsız", "No packaging"))}
            {option("custom", t("Paket türlerini seç", "Choose package types"))}
          </div>
          {mode === "custom" && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 pl-6">
              {types.length === 0 && <span className={muted}>{t("Henüz paket türü yok.", "No package types yet.")}</span>}
              {types.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                  <input
                    type="checkbox"
                    checked={picked.includes(p.id)}
                    onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((id) => id !== p.id)))}
                    className="h-4 w-4 accent-[#D97757]"
                  />
                  {p.name}
                  {!p.own && <span className="text-[11px] text-neutral-400">· {p.entity_name}</span>}
                </label>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            {busy && <Spinner size={14} />}
            <button type="button" disabled={busy} onClick={onCancel} className={btnLink}>
              {t("Vazgeç", "Cancel")}
            </button>
            <button type="button" disabled={busy || (mode === "custom" && picked.length === 0)} onClick={() => void save()} className={btnDark}>
              {t("Kaydet", "Save")}
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

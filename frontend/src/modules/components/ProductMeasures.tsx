"use client";

import { Fragment, useRef, useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { useUrlParam } from "../core/useUrlParam";
import { EntityApi, MeasureKey, MeasuresBody, ProductMeasureRow, SheetAnalysis } from "../core/api";
import { errMsg } from "../core/errors";
import { badge, btnDanger, btnDark, btnLink, btnOutline, card, h2, input, label as labelCls, muted, rowBorder, td, th } from "../core/ui";
import { qty as fmtQty } from "../core/units";
import DecimalInput from "@/components/ui/NumberInputs";
import { materialLabel } from "../core/materials";
import MaterialTypeSelect from "./MaterialTypeSelect";
import ProductPicker, { PickedProduct, ShopSelect, useShopChoice } from "./ProductPicker";
import SheetSplitter from "./SheetSplitter";
import SubTabs from "./SubTabs";

const MAX_DRAWING_MB = 15;
const DEFAULT_GAP = 60; // plaka gruplama hassasiyeti (mm); pencerede değiştirilebilir

/** Alanlar: anahtar → ekranda gösterilen değere çeviri. Kesim uzunluğu metre, yüzey alanı m² girilir; mm ve mm² saklanır. */
const FIELDS: { key: MeasureKey; tr: string; en: string; toView: (v: number) => string; fromView: (n: number) => number; width: string; placeholder?: string }[] = [
  { key: "thickness", tr: "Kalınlık (mm)", en: "Thickness (mm)", toView: String, fromView: (n) => n, width: "w-24" },
  { key: "cut_length", tr: "Kesim uzunluğu (m)", en: "Cut length (m)", toView: (v) => String(Math.round(v) / 1000), fromView: (n) => n * 1000, width: "w-28" },
  { key: "pierce_count", tr: "Delme (adet)", en: "Pierces", toView: String, fromView: (n) => n, width: "w-24" },
  { key: "width", tr: "En (mm)", en: "Width (mm)", toView: String, fromView: (n) => n, width: "w-24" },
  { key: "height", tr: "Boy (mm)", en: "Height (mm)", toView: String, fromView: (n) => n, width: "w-24" },
  { key: "surface", tr: "Yüzey alanı (m²)", en: "Surface (m²)", toView: (v) => String(Number((v / 1e6).toFixed(4))), fromView: (n) => n * 1e6, width: "w-28" },
  { key: "sides", tr: "Boyalı yüz (1-2)", en: "Painted sides (1-2)", toView: String, fromView: (n) => n, width: "w-20", placeholder: "1" },
  // Ölçüler tek parça içindir; ürün bu parçadan kaç tane gerektiriyorsa (ör. ana parçaya kaynaklanan 13 küçük parça) buraya yazılır.
  { key: "part_qty", tr: "Ürün başına adet", en: "Qty per product", toView: String, fromView: (n) => n, width: "w-24", placeholder: "1" },
];

/** Maliyet paylaştırması için gerekli olup ürün parçasında girilmemiş alanlar (ekranda "Eksik: …" olarak yazılır). */
const REQUIRED: { test: (r: ProductMeasureRow) => boolean; tr: string; en: string }[] = [
  { test: (r) => !!r.material, tr: "malzeme", en: "material" },
  { test: (r) => !!r.values.thickness, tr: "kalınlık", en: "thickness" },
  { test: (r) => !!r.values.cut_length, tr: "kesim", en: "cutting" },
  { test: (r) => !!(r.values.width && r.values.height), tr: "ebat", en: "size" },
];
const missingOf = (r: ProductMeasureRow) => REQUIRED.filter((x) => !x.test(r));

type Target = Pick<ProductMeasureRow, "shop_id" | "listing_id" | "variant" | "title"> & {
  part?: number; shop_name?: string; values?: ProductMeasureRow["values"]; material?: ProductMeasureRow["material"]; source?: ProductMeasureRow["source"] };

/** "Ürünler" sekmesi: bu kayıtta üretilen mağaza ürünlerinin üretim bilgisi (malzeme, kalınlık, kesim uzunluğu, delme, ebat). Elle
 * girilir ya da kesimcinin plakasının çiziminden (DXF, modal) ürünlere atanarak otomatik doldurulur; maliyet paylaştırması ve
 * belge satırı eşleştirme bu bilgilere göre yapılır. Yalnızca çalışma alanı üyesi görür. */
export default function ProductMeasures({ api, entityId }: { api: EntityApi; entityId: number }) {
  const { t } = useT();
  const { data, error, reload } = useApiData(`modkit-measures:${api.base}:${entityId}`, () => api.measures.list(entityId));
  const { shops, shopId, setShopId } = useShopChoice(api, entityId);
  const [adding, setAdding] = useState<PickedProduct | null>(null);
  const [addingPart, setAddingPart] = useState<{ row: ProductMeasureRow; part: number } | null>(null); // mevcut ürüne yeni parça
  const [sheet, setSheet] = useState<{ file: File; analysis: SheetAnalysis; stamp: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const sheetInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useUrlParam("products");
  const all = data?.items ?? null;
  const multiShop = (shops?.length ?? 0) > 1;

  function done() {
    setAdding(null);
    setAddingPart(null);
    reload();
  }

  const sameProduct = (a: Target, b: Target) => a.shop_id === b.shop_id && a.listing_id === b.listing_id && a.variant === b.variant;

  // "Eksik" sekmesi: herhangi bir parçasında gerekli alan girilmemiş ürünler (tüm parçalarıyla); "Hazır": hepsi tamam.
  const pendingRows = all?.filter((r) => all.some((x) => sameProduct(x, r) && missingOf(x).length > 0)) ?? null;
  const tab: "new" | "done" = view === "done" ? "done" : "new";
  const rows = all && pendingRows ? (tab === "new" ? pendingRows : all.filter((r) => !pendingRows.includes(r))) : null;
  // "Şundan kopyala": tanımı tamam olan ürünler, aynı ebat/malzemeli yeni ürünü baştan girmemek için kalıp olur (ürün başına ilk parça).
  const templates = (all ?? []).filter((r) => missingOf(r).length === 0 && r.part === 0);
  const productCount = (list: ProductMeasureRow[]) => list.filter((r, i) => i === 0 || !sameProduct(list[i - 1], r)).length;

  /** Plaka DXF'ini çözümler; pencere gruplar hazır olunca açılır (bu sürede yalnızca küçük bir spinner görünür). */
  function startSheet(file: File) {
    setSheet(null);
    setAnalyzing(true);
    api.measures
      .sheet(entityId, file, DEFAULT_GAP)
      .then((analysis) => setSheet({ file, analysis, stamp: Date.now() }))
      .catch((e) => toast.error(errMsg(e, t("Çizim okunamadı", "Could not read the drawing"))))
      .finally(() => setAnalyzing(false));
  }

  return (
    <section className={card}>
      <h2 className={h2}>{t("Ürünler", "Products")}</h2>
      <p className={`${muted} mb-3`}>
        {t(
          "Ürün tanımları: malzeme türü ve kalınlığı, kesim uzunluğu, delme, ebat, yüzey alanı ve boyalı yüz sayısı. Bir kez tanımlanır, bütün tedarikçilerde ortaktır; her tedarikçi malzemeyi kendi fiyat listesiyle eşler. Plaka DXF'i yüklersen ölçüler (yüzey alanı dahil) otomatik gelir; elle de yazabilirsin. Maliyeti ürünlere paylaştırmak ve belgedeki satırları ürünle eşlemek için kullanılır.",
          "Product definitions: material type and thickness, cut length, pierces, size, surface area and painted sides. Defined once and shared by every supplier; each supplier matches the material with its own price list. Upload a sheet DXF and the measures (including surface area) come in automatically, or type them. Used to split cost between products and to match document lines to products.",
        )}
      </p>

      <SubTabs
        tabs={[
          { id: "new", label: t("Yeni", "New"), count: pendingRows ? productCount(pendingRows) : undefined },
          { id: "done", label: t("İşlenmiş", "Processed"), count: all && pendingRows ? productCount(all.filter((r) => !pendingRows.includes(r))) : undefined },
        ]}
        value={tab}
        onChange={(id) => setView(id === "new" ? "" : id)}
      />

      {tab === "new" && (
        <div className="mb-4 flex flex-wrap items-start gap-2">
          <input
            ref={sheetInput}
            type="file"
            accept=".dxf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > MAX_DRAWING_MB * 1024 * 1024) {
                toast.error(t(`Dosya çok büyük (en fazla ${MAX_DRAWING_MB} MB)`, `File too large (max ${MAX_DRAWING_MB} MB)`));
                return;
              }
              startSheet(f);
            }}
          />
          <button type="button" disabled={analyzing} onClick={() => sheetInput.current?.click()} className={btnDark}>
            {t("Plaka DXF'i yükle", "Upload sheet DXF")}
          </button>
          {analyzing && (
            <span className="flex items-center gap-2 self-center text-xs text-neutral-500 dark:text-neutral-400">
              <Spinner size={16} />
              {t("Çizim okunuyor…", "Reading the drawing…")}
            </span>
          )}
          <ShopSelect shops={shops} shopId={shopId} onChange={setShopId} />
          <ProductPicker api={api} entityId={entityId} shopId={shopId} onPick={setAdding} asButton />
        </div>
      )}

      {!rows ? (
        error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <BlockSpinner />
      ) : rows.length === 0 && !adding ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          {tab === "new"
            ? t("Yeni ürün yok. Plaka DXF'i yükle ya da yukarıdan ürün ara; tanımı tamamlanan ürünler “İşlenmiş” sekmesine geçer.", "No new products. Upload a sheet DXF or search above; products whose definition is complete move to “Processed”.")
            : t("Henüz işlenmiş ürün yok.", "No processed products yet.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={rowBorder}>
                <th className={th}>{t("Ürün", "Product")}</th>
                <th className={th}>{t("Malzeme", "Material")}</th>
                <th className={th}>{t("Ebat", "Size")}</th>
                <th className={th}>{t("Kesim", "Cutting")}</th>
                <th className={th}>{t("Yüzey", "Surface")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {adding && !(all ?? []).some((r) => r.shop_id === adding.shop_id && r.listing_id === adding.listing_id && r.variant === adding.variant) && (
                <MeasureRow key={`new-${adding.shop_id}-${adding.listing_id}-${adding.variant}`} api={api} entityId={entityId} target={adding} templates={templates} multiShop={multiShop} onDone={done} onCancel={() => setAdding(null)} />
              )}
              {rows.map((r, i) => {
                const parts = rows.filter((x) => sameProduct(x, r));
                const last = i === rows.length - 1 || !sameProduct(rows[i + 1], r);
                return (
                  <Fragment key={`${r.shop_id}-${r.listing_id}-${r.variant}-${r.part}-${r.updated_at}`}>
                    <MeasureRow
                      api={api}
                      entityId={entityId}
                      target={r}
                      templates={templates}
                      missing={missingOf(r)}
                      multiShop={multiShop}
                      onDone={done}
                      partLabel={parts.length > 1 ? parts.indexOf(r) + 1 : 0}
                      continued={i > 0 && sameProduct(rows[i - 1], r)}
                      onAddPart={last && !addingPart ? () => setAddingPart({ row: r, part: Math.max(...parts.map((x) => x.part)) + 1 }) : undefined}
                    />
                    {last && addingPart && sameProduct(addingPart.row, r) && (
                      <MeasureRow
                        key={`part-${addingPart.part}`}
                        api={api}
                        entityId={entityId}
                        target={{ ...r, part: addingPart.part, values: undefined, material: null, source: undefined }}
                        multiShop={multiShop}
                        onDone={done}
                        onCancel={() => setAddingPart(null)}
                        partLabel={parts.length + 1}
                        continued
                      />
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sheet && (
        <Modal
          title={t("Plaka çizimi (birden çok ürün)", "Sheet drawing (several products)")}
          widthClass="max-w-6xl"
          footer={
            <button type="button" onClick={() => setSheet(null)} className={btnLink}>
              {t("Kapat", "Close")}
            </button>
          }
        >
          <SheetSplitter
            key={sheet.stamp}
            api={api}
            entityId={entityId}
            file={sheet.file}
            initial={sheet.analysis}
            existing={all ?? []}
            onPickOther={() => sheetInput.current?.click()}
            onSaved={() => {
              reload();
              setSheet(null);
            }}
          />
        </Modal>
      )}
    </section>
  );
}

/** Ürün parçası satırı: özet olarak gösterilir (malzeme, ebat, kesim, yüzey); "Düzenle" satırı etiketli alanlardan oluşan bir karta açar, böylece tablo
 * geniş ve kaydırmalı olmaz. `partLabel` > 0: üründe birden çok parça var (kaçıncı olduğu); `continued`: aynı ürünün ikinci ve sonraki parçası (ürün
 * adı tekrarlanmaz); `onAddPart`: ürünün son satırında "parça ekle" düğmesi; `onCancel` verilmişse satır yeni eklenmektedir ve düzenleme açık başlar. */
function MeasureRow({
  api,
  entityId,
  target,
  multiShop,
  onDone,
  onCancel,
  partLabel = 0,
  continued = false,
  onAddPart,
  missing = [],
  templates = [],
}: {
  api: EntityApi;
  entityId: number;
  target: Target;
  multiShop: boolean;
  onDone: () => void;
  onCancel?: () => void;
  partLabel?: number;
  continued?: boolean;
  onAddPart?: () => void;
  missing?: typeof REQUIRED;
  templates?: ProductMeasureRow[];
}) {
  const part = target.part ?? 0;
  const { t, locale } = useT();
  const isNew = onCancel !== undefined;
  const [editing, setEditing] = useState(isNew);
  const initial = Object.fromEntries(FIELDS.map((f) => [f.key, target.values?.[f.key] !== undefined ? f.toView(target.values[f.key]!) : ""])) as Record<MeasureKey, string>;
  const [fields, setFields] = useState(initial);
  const initialMaterial = target.material ?? "";
  const [material, setMaterial] = useState(initialMaterial);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const changed = FIELDS.filter((f) => fields[f.key].trim() !== initial[f.key]);
  const dirty = changed.length > 0 || material !== initialMaterial;
  const v = target.values ?? {};

  async function save() {
    const body: MeasuresBody = { values: {} };
    if (material !== initialMaterial) body.material = material || null;
    for (const f of changed) {
      const raw = fields[f.key].trim();
      const n = Number(raw.replace(",", "."));
      if (raw !== "" && !(Number.isFinite(n) && n > 0)) {
        toast.error(t(`${t(f.tr, f.en)}: geçerli bir sayı yaz`, `${f.en}: enter a valid number`));
        return;
      }
      body.values[f.key] = raw === "" ? null : f.fromView(n);
    }
    setBusy(true);
    try {
      await api.measures.set(entityId, target.shop_id, target.listing_id, body, "manual", target.variant, part);
      toast.success(t("Kaydedildi", "Saved"));
      onDone();
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
      setBusy(false);
    }
  }

  async function measure(f: File) {
    if (f.size > MAX_DRAWING_MB * 1024 * 1024) {
      toast.error(t(`Dosya çok büyük (en fazla ${MAX_DRAWING_MB} MB)`, `File too large (max ${MAX_DRAWING_MB} MB)`));
      return;
    }
    setBusy(true);
    try {
      const r = await api.measures.drawing(entityId, target.shop_id, target.listing_id, f, target.variant, part);
      toast.success(t(`Ölçüldü: ${fmtQty(r.cad.cut_length_mm / 1000, "tr")} m kesim, ${r.cad.pierce_count} delme`, `Measured: ${fmtQty(r.cad.cut_length_mm / 1000, "en")} m of cutting, ${r.cad.pierce_count} pierces`));
      if (r.cad.units_assumed) {
        toast.info(t("Çizimde birim yazmıyor; milimetre varsayıldı. Değerleri kontrol et.", "The drawing has no unit; millimetres were assumed. Check the values."));
      }
      onDone();
    } catch (e) {
      toast.error(errMsg(e, t("Çizim ölçülemedi", "Could not measure the drawing")));
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.measures.remove(entityId, target.shop_id, target.listing_id, target.variant, part);
      onDone();
    } catch (e) {
      toast.error(errMsg(e, t("Silinemedi", "Could not delete")));
      setBusy(false);
    }
  }

  const partName = partLabel === 0 ? "" : partLabel === 1 ? t("Ana parça", "Main part") : t(`Ek parça ${partLabel - 1}`, `Extra part ${partLabel - 1}`);
  const none = <span className="text-neutral-400">—</span>;

  if (editing) {
    return (
      <tr className={rowBorder}>
        <td colSpan={6} className="py-3">
          <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">{target.title || `#${target.listing_id}`}</div>
                <div className={muted}>
                  {[target.variant, partName].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  ref={file}
                  type="file"
                  accept=".dxf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void measure(f);
                  }}
                />
                {!isNew && (
                  <button type="button" disabled={busy} onClick={() => file.current?.click()} className={btnOutline}>
                    {t("DXF'ten ölç", "Measure from DXF")}
                  </button>
                )}
              </div>
            </div>
            {templates.length > 0 && (
              <label className="block">
                <span className={labelCls}>{t("Şundan kopyala (aynı malzeme ve ebat)", "Copy from (same material and size)")}</span>
                <select
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const src = templates.find((x) => `${x.shop_id}-${x.listing_id}-${x.variant}` === e.target.value);
                    if (!src) return;
                    setMaterial(src.material ?? "");
                    setFields(Object.fromEntries(FIELDS.map((f) => [f.key, src.values[f.key] !== undefined ? f.toView(src.values[f.key]!) : ""])) as Record<MeasureKey, string>);
                  }}
                  className={`${input} w-full sm:max-w-md`}
                >
                  <option value="">{t("Seç…", "Select…")}</option>
                  {templates.map((x) => (
                    <option key={`${x.shop_id}-${x.listing_id}-${x.variant}`} value={`${x.shop_id}-${x.listing_id}-${x.variant}`}>
                      {[x.title, x.variant].filter(Boolean).join(" · ")} — {materialLabel(x.material, t)} {x.values.thickness ?? ""} mm, {x.values.width}×{x.values.height}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <label className="block">
                <span className={labelCls}>{t("Malzeme türü", "Material type")}</span>
                <MaterialTypeSelect value={material} onChange={setMaterial} disabled={busy} className="w-full" />
              </label>
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className={labelCls}>{t(f.tr, f.en)}</span>
                  <DecimalInput
                    value={fields[f.key]}
                    onValue={(text) => setFields((x) => ({ ...x, [f.key]: text }))}
                    placeholder={f.placeholder}
                    disabled={busy}
                    className={`${input} w-full`}
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3">
              {busy && <Spinner size={14} />}
              <button type="button" disabled={busy} onClick={() => (isNew ? onCancel?.() : setEditing(false))} className={btnLink}>
                {t("Vazgeç", "Cancel")}
              </button>
              <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={btnDark}>
                {t("Kaydet", "Save")}
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`${rowBorder} odd:bg-neutral-50 dark:odd:bg-neutral-800/40`}>
      <td className={td}>
        {!continued && (
          <>
            <div className="line-clamp-2 max-w-xs font-medium text-neutral-900 dark:text-neutral-100">{target.title || `#${target.listing_id}`}</div>
            {target.variant && <div className="max-w-xs truncate text-xs text-[#C6613F] dark:text-[#E8A48C]">{target.variant}</div>}
            <div className="text-[11px] text-neutral-400">
              #{target.listing_id}
              {multiShop && target.shop_name ? ` · ${target.shop_name}` : ""}
            </div>
          </>
        )}
        <div className="text-[11px] text-neutral-400">
          {partName && <span className="mr-1.5">↳ {partName}</span>}
          {(v.part_qty ?? 1) > 1 && <span className="mr-1.5">× {v.part_qty}</span>}
          {missing.length > 0 && (
            <span className={`${badge} mr-1.5 bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300`}>
              {t("Eksik", "Missing")}: {missing.map((m) => t(m.tr, m.en)).join(", ")}
            </span>
          )}
          {target.source === "cad" && <span className={`${badge} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`}>{t("çizimden", "from drawing")}</span>}
        </div>
        {onAddPart && (
          <button type="button" disabled={busy} onClick={onAddPart} className={`${btnLink} text-xs`}>
            + {t("Parça ekle", "Add part")}
          </button>
        )}
      </td>
      <td className={td}>
        {target.material ? (
          <>
            {materialLabel(target.material, t)}
            {v.thickness ? <span className="text-neutral-500 dark:text-neutral-400"> · {fmtQty(v.thickness, locale)} mm</span> : null}
          </>
        ) : (
          none
        )}
      </td>
      <td className={`${td} whitespace-nowrap`}>{v.width && v.height ? `${fmtQty(v.width, locale)} × ${fmtQty(v.height, locale)} mm` : none}</td>
      <td className={`${td} whitespace-nowrap`}>
        {v.cut_length ? `${fmtQty(v.cut_length / 1000, locale)} m` : none}
        {v.pierce_count ? <span className="text-neutral-500 dark:text-neutral-400"> · {fmtQty(v.pierce_count, locale)} {t("delme", "pierces")}</span> : null}
      </td>
      <td className={`${td} whitespace-nowrap`}>
        {v.surface ? `${fmtQty(v.surface / 1e6, locale)} m²` : none}
        {v.surface && (v.sides ?? 1) > 1 ? <span className="text-neutral-500 dark:text-neutral-400"> · {fmtQty(v.sides ?? 1, locale)} {t("yüz", "sides")}</span> : null}
      </td>
      <td className={`${td} whitespace-nowrap text-right`}>
        <div className="flex items-center justify-end gap-3">
          {busy && <Spinner size={14} />}
          <button type="button" disabled={busy} onClick={() => setEditing(true)} className={btnLink}>
            {t("Düzenle", "Edit")}
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()} className={btnDanger} aria-label={t("Ürünü listeden çıkar", "Remove product from the list")}>
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

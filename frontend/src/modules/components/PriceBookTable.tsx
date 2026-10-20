"use client";

import { useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { EntityAccess, EntityApi, PriceItem, PriceKind, PriceVersion, StockPatch, can, isInternal, isMember } from "../core/api";
import { errMsg } from "../core/errors";
import { btnDanger, btnLink, btnOutline, btnPrimary, card, h2, input, label as labelCls, muted, rowBorder, th, td } from "../core/ui";
import { currencySymbol, money, PERCENT, perUnit, unitLabel, unitPrice } from "../core/units";
import DecimalInput from "@/components/ui/NumberInputs";
import { materialLabel, useMaterialCatalog } from "../core/materials";
import MaterialTypeSelect from "./MaterialTypeSelect";
import MaterialTypesModal from "./MaterialTypesModal";
import StockFields, { allowedUnits, applyType, emptyStock, missingFields, pruneStock, StockForm, stockOf, stockPayload, useMissingLabels } from "./StockFields";
import StockLine from "./StockGauge";
import StockModal from "./StockModal";
import UnitSelect from "./UnitSelect";

const SECTIONS: { kinds: PriceKind[]; tr: string; en: string; addTr: string; addEn: string; hintTr: string; hintEn: string; units?: string[]; addKind: PriceKind }[] = [
  {
    kinds: ["service"], addKind: "service", tr: "Hizmetler", en: "Services", addTr: "Hizmet ekle", addEn: "Add service", units: ["time", "count", "length", "area", "mass"],
    hintTr: "Ne için ödüyorsun: kesim süresi (dk), delik/pierce (adet), boyama (m²)…",
    hintEn: "What you pay for: cutting time (min), pierces (piece), painting (m²)…",
  },
  {
    kinds: ["material"], addKind: "material", tr: "Malzemeler", en: "Materials", addTr: "Malzeme ekle", addEn: "Add material", units: ["count", "mass", "length", "area", "volume"],
    hintTr: "Hammadde: 2 mm plaka (tabaka ya da kg), toz boya (kg)…",
    hintEn: "Raw materials: 2 mm sheet (per sheet or kg), powder paint (kg)…",
  },
  {
    kinds: ["fee", "minimum"], addKind: "fee", tr: "Sabit ücretler", en: "Fixed charges", addTr: "Sabit ücret ekle", addEn: "Add fixed charge",
    hintTr: "Her işe bir kez eklenen ücret (hazırlık), işin tutarının yüzdesi olan ücret ve iş başına minimum tutar.",
    hintEn: "A charge added once per job (setup), a charge that is a percentage of the job amount, and a per-job minimum.",
  },
];

/** Fiyat listesi: kalem + birim + fiyat; her fiyat değişikliği yeni sürümdür (geçmiş işler eski fiyatla kalır). */
export default function PriceBookTable({ api, entityId, currency, access }: { api: EntityApi; entityId: number; currency: string; access: EntityAccess | undefined }) {
  const { t, locale } = useT();
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, reload } = useApiData(`modkit-prices:${api.base}:${entityId}:${showArchived}`, () => api.prices.list(entityId, showArchived));
  const [history, setHistory] = useState<PriceItem | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [stockFor, setStockFor] = useState<number | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const editable = can(access, "prices.edit");
  const items = data?.items ?? [];
  const hasMinimum = items.some((i) => i.kind === "minimum" && !i.archived);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast.success(ok);
      reload();
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
    }
  }

  /** Stok takibini aç/kapat. Kapatmak onay ister (stok geçmişi saklanır ama iş onaylarında düşmez, uyarılar kapanır); açınca stok penceresi açılır (ilk alım girilsin). */
  async function setTracking(item: PriceItem, on: boolean) {
    if (!on && !(await confirm({
      title: t(`“${item.name}” için stok takibi kapatılsın mı?`, `Turn off stock tracking for “${item.name}”?`),
      message: t("Eldeki stok ve geçmiş saklanır, ama iş onaylarında stoktan düşülmez ve azalma uyarıları kapanır.", "The stock level and history are kept, but jobs no longer take from stock and low-stock alerts stop."),
      destructive: true,
      confirmLabel: t("Kapat", "Turn off"),
    }))) return;
    await run(() => api.prices.update(entityId, item.id, { track_stock: on }));
    if (on) setStockFor(item.id);
  }

  async function removeItem(item: PriceItem) {
    if (!(await confirm({ title: t(`"${item.name}" silinsin mi?`, `Delete "${item.name}"?`), destructive: true, confirmLabel: t("Sil", "Delete") }))) return;
    await run(() => api.prices.remove(entityId, item.id));
  }

  return (
    <div className="space-y-4">
      {!editable && (
        <p className={muted}>{t("Fiyat listesini görüntülüyorsun; değiştirme yetkin yok.", "You are viewing the price list; you cannot change it.")}</p>
      )}
      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data ? (
        <BlockSpinner />
      ) : (
        SECTIONS.map((sec) => {
          const rows = items.filter((i) => sec.kinds.includes(i.kind));
          return (
            <section key={sec.addKind} className={card}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className={h2}>{t(sec.tr, sec.en)}</h2>
                {sec.addKind === "material" && isMember(access) && (
                  <button type="button" onClick={() => setTypesOpen(true)} className={btnLink}>
                    {t("Malzeme türleri", "Material types")}
                  </button>
                )}
              </div>
              <p className={`${muted} mb-3`}>{t(sec.hintTr, sec.hintEn)}</p>
              {editable && (
                <AddRow
                  kinds={sec.addKind === "fee" ? (hasMinimum ? ["fee"] : ["fee", "minimum"]) : [sec.addKind]}
                  units={sec.units}
                  currency={currency}
                  api={api}
                  entityId={entityId}
                  canAuto={isMember(access)}
                  addLabel={t(sec.addTr, sec.addEn)}
                  onAdd={(v) => run(() => api.prices.add(entityId, v), t("Kalem eklendi", "Item added"))}
                />
              )}
              {rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className={rowBorder}>
                        <th className={th}>{t("Kalem", "Item")}</th>
                        <th className={th}>{t("Fiyat", "Price")}</th>
                        <th className={`${th} text-right`} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((item) => (
                        <PriceRow
                          key={item.id}
                          item={item}
                          currency={currency}
                          api={api}
                          entityId={entityId}
                          editable={editable && !item.archived}
                          member={isMember(access)}
                          units={sec.units}
                          onSaveMeta={(patch) => run(() => api.prices.update(entityId, item.id, patch))}
                          onSavePrice={(price, from) =>
                            run(
                              () => api.prices.setPrice(entityId, item.id, price, from),
                              from
                                ? t(`Fiyat ${new Date(from).toLocaleDateString(locale)} tarihinden itibaren geçerli olarak eklendi (Geçmiş'te görünür)`, `Price added as valid from ${new Date(from).toLocaleDateString(locale)} (see History)`)
                                : t("Fiyat güncellendi", "Price updated"),
                            )
                          }
                          onStock={() => setStockFor(item.id)}
                          onTrack={(on) => void setTracking(item, on)}
                          onHistory={() => setHistory(item)}
                          onArchive={(v) => run(() => api.prices.archive(entityId, item.id, v))}
                          onDelete={() => void removeItem(item)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {rows.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz kalem yok.", "No items yet.")}</p>}
            </section>
          );
        })
      )}
      {isInternal(access) && (
        <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-[#D97757]" />
          {t("Arşivlenmiş kalemleri de göster", "Show archived items too")}
        </label>
      )}
      {stockFor !== null && items.some((i) => i.id === stockFor) && (
        <StockModal api={api} entityId={entityId} item={items.find((i) => i.id === stockFor)!} currency={currency} onChanged={reload} onClose={() => setStockFor(null)} />
      )}
      {typesOpen && <MaterialTypesModal api={api} entityId={entityId} onClose={() => setTypesOpen(false)} />}
      {history && <HistoryModal api={api} entityId={entityId} item={history} currency={currency} onClose={() => setHistory(null)} />}
      {confirmEl}
      <p className={muted}>
        {t(
          "Fiyatı değiştirdiğinde eski fiyat silinmez: geçmiş tarihli işler o tarihteki fiyatla hesaplanır. ",
          "Changing a price does not erase the old one: past jobs are priced as of their own date. ",
        )}
      </p>
    </div>
  );
}

function PriceRow({
  item,
  currency,
  api,
  entityId,
  editable,
  member,
  units,
  onSaveMeta,
  onSavePrice,
  onStock,
  onTrack,
  onHistory,
  onArchive,
  onDelete,
}: {
  item: PriceItem;
  currency: string;
  api: EntityApi;
  entityId: number;
  editable: boolean;
  member: boolean;
  units?: string[];
  onSaveMeta: (patch: { name?: string; spec?: string; auto_qty?: number | null; unit?: string; min_amount?: number | null } & StockPatch) => Promise<void>;
  onSavePrice: (price: number, validFrom?: string) => Promise<void>;
  onStock: () => void;
  onTrack: (on: boolean) => void;
  onHistory: () => void;
  onArchive: (archived: boolean) => Promise<void>;
  onDelete: () => void;
}) {
  const { t, locale } = useT();
  const catalog = useMaterialCatalog();
  const missingLabels = useMissingLabels();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(item.name);
  const [spec, setSpec] = useState(item.spec);
  const [unit, setUnit] = useState(item.unit);
  const [price, setPrice] = useState(item.price !== null ? String(item.price) : "");
  const since = item.price_from ? item.price_from.slice(0, 10) : ""; // güncel fiyatın geçerlilik başlangıcı
  const [from, setFrom] = useState(since);
  const [auto, setAuto] = useState(item.auto_qty !== null ? String(item.auto_qty) : "");
  const [stock, setStock] = useState<StockForm>(() => stockOf(item));
  const [busy, setBusy] = useState(false);
  const ruleAllowed = member && (item.kind === "service" || item.kind === "material");
  const pct = item.unit === PERCENT;
  const [minAmount, setMinAmount] = useState(item.min_amount != null ? String(item.min_amount) : "");
  const kindTag = item.kind === "minimum" ? t("minimum", "minimum") : pct ? t("yüzde", "percent") : item.kind === "fee" ? t("iş başına", "per job") : "";

  async function save() {
    const p = Number(price.replace(",", "."));
    if (!name.trim() || !Number.isFinite(p) || p < 0) {
      toast.error(t("Ad ve geçerli bir fiyat gir.", "Enter a name and a valid price."));
      return;
    }
    const autoQty = auto.trim() === "" ? null : Number(auto.replace(",", "."));
    if (autoQty !== null && !(Number.isFinite(autoQty) && autoQty > 0)) {
      toast.error(t("Otomatik miktar sıfırdan büyük bir sayı olmalı.", "The automatic quantity must be a number above zero."));
      return;
    }
    const stockPatch = item.kind === "material" ? stockPayload(stock, stockOf(item)) : {};
    if (stockPatch === null) {
      toast.error(t("Kalınlık ve plaka değerleri sıfırdan büyük sayı olmalı.", "Thickness and plate values must be numbers above zero."));
      return;
    }
    // eski kalem yalnızca adı ya da fiyatı değişirken eksik sayılmaz; tür/alan/birim değişince sayılır (sunucu da aynı kuralla doğrular)
    const gaps = item.kind === "material" && (Object.keys(stockPatch).length > 0 || unit !== item.unit) ? missingFields(catalog, stock, unit) : [];
    if (gaps.length > 0) {
      toast.error(t(`Eksik bilgi: ${missingLabels(gaps)}.`, `Missing: ${missingLabels(gaps)}.`));
      return;
    }
    setBusy(true);
    const minV = pct && minAmount.trim() !== "" ? Number(minAmount.replace(",", ".")) : null;
    if (minV !== null && !(Number.isFinite(minV) && minV >= 0)) {
      toast.error(t("En az tutar sıfır ya da daha büyük bir sayı olmalı.", "The minimum amount must be zero or more."));
      return;
    }
    const patch: { name?: string; spec?: string; auto_qty?: number | null; unit?: string; min_amount?: number | null } & StockPatch = { ...stockPatch };
    if (pct && minV !== (item.min_amount ?? null)) patch.min_amount = minV;
    if (name.trim() !== item.name) patch.name = name.trim();
    if (unit !== item.unit) patch.unit = unit;
    if (spec.trim() !== item.spec) patch.spec = spec.trim();
    if (ruleAllowed && unit === item.unit && autoQty !== item.auto_qty) patch.auto_qty = autoQty;
    if (Object.keys(patch).length > 0) await onSaveMeta(patch);
    if (unit !== item.unit && p === item.price) {
      toast.info(t("Birim değişti: fiyatı yeni birime göre yazdığından emin ol.", "The unit changed: make sure the price is for the new unit."));
    }
    if (p !== item.price || from !== since) await onSavePrice(p, from !== since ? from : undefined);
    setBusy(false);
    setEdit(false);
  }

  if (edit) {
    const field = "block";
    return (
      <tr className={rowBorder}>
        <td colSpan={3} className="py-3">
          <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={field}>
                <span className={labelCls}>{t("Ad", "Name")}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={`${input} w-full`} />
              </label>
              {item.kind !== "material" && (
                <label className={field}>
                  <span className={labelCls}>{t("Açıklama", "Details")}</span>
                  <input value={spec} onChange={(e) => setSpec(e.target.value)} maxLength={200} className={`${input} w-full`} />
                </label>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {item.kind === "material" && (
                <label className={field}>
                  <span className={labelCls}>{t("Malzeme türü", "Material type")}</span>
                  <MaterialTypeSelect
                    api={api}
                    entityId={entityId}
                    value={stock.material}
                    onChange={(m) => {
                      const next = applyType(catalog, stock, unit, m);
                      setStock(next.form);
                      setUnit(next.unit);
                    }}
                    canAdd={member}
                    className="w-full"
                  />
                </label>
              )}
              {units && item.kind !== "fee" && item.kind !== "minimum" && (
                <label className={field}>
                  <span className={labelCls}>{t("Birim", "Unit")}</span>
                  <UnitSelect
                    value={unit}
                    onChange={(u) => {
                      setUnit(u);
                      setStock((st) => pruneStock(catalog, st, u));
                    }}
                    only={units}
                    allowed={item.kind === "material" ? allowedUnits(catalog, stock.material) : undefined}
                    className="w-full"
                  />
                </label>
              )}
              <label className={field}>
                <span className={labelCls}>{pct ? t("Yüzde (%)", "Percentage (%)") : `${t("Fiyat", "Price")} (${perUnit(currency, unit, t)})`}</span>
                <DecimalInput value={price} onValue={setPrice} unit={pct ? "%" : currencySymbol(currency, locale)} className={`${input} w-full`} />
              </label>
              {pct && (
                <label className={field}>
                  <span className={labelCls}>
                    {t("En az tutar", "Minimum amount")} ({currency}){" "}
                    <HelpTip>{t("Yüzde bundan küçük çıkarsa bu tutar alınır. Boşsa alt sınır yoktur.", "If the percentage comes out lower, this amount is charged. When empty there is no floor.")}</HelpTip>
                  </span>
                  <DecimalInput value={minAmount} onValue={setMinAmount} unit={currencySymbol(currency, locale)} placeholder="—" className={`${input} w-full`} />
                </label>
              )}
              {member && (
                <label className={field}>
                  <span className={labelCls}>{t("Geçerlilik başlangıcı", "Valid from")}</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} w-full`} />
                  {from && <span className={`${muted} mt-1 block`}>{new Date(`${from}T00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}</span>}
                </label>
              )}
              {ruleAllowed && unit === item.unit && (
                <label className={field}>
                  <span className={labelCls}>
                    {t("Her işe otomatik ekle", "Add to every job")} ({unitLabel(unit, t)})
                  </span>
                  <DecimalInput value={auto} onValue={setAuto} placeholder="—" className={`${input} w-full`} />
                </label>
              )}
            </div>
            {item.kind === "material" && <StockFields value={stock} unit={unit} onChange={setStock} />}
            <p className={muted}>
              {t(
                "Fiyat, “Geçerlilik başlangıcı” tarihinden itibaren geçerli olur; geçmiş tarihli işleri etkilemesi için işin tarihinden önceki bir gün seç.",
                "The price applies from the “Valid from” date; pick a day before a job's date for it to affect that job.",
              )}
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setEdit(false)} className={btnLink}>
                {t("Vazgeç", "Cancel")}
              </button>
              <button type="button" disabled={busy} onClick={() => void save()} className={btnPrimary}>
                {t("Kaydet", "Save")}
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`${rowBorder} odd:bg-neutral-50 dark:odd:bg-neutral-800/40 ${item.archived ? "opacity-50" : ""}`}>
      <td className={td}>
        <div className="font-medium text-neutral-900 dark:text-neutral-100">
          {item.name}
          {kindTag && <span className="ml-2 text-[11px] font-normal text-neutral-400">{kindTag}</span>}
        </div>
        {item.spec && <div className={muted}>{item.spec}</div>}
        {item.kind === "material" && <StockSummary item={item} currency={currency} />}
        {item.kind === "material" && member && !item.archived && <StockLine item={item} currency={currency} onOpen={onStock} onToggle={onTrack} />}
        {item.auto_qty !== null && (
          <div className="text-[11px] text-[#C6613F] dark:text-[#E8A48C]">
            {t("her işe otomatik eklenir", "added to every job")}: {item.auto_qty} {unitLabel(item.unit, t)}
          </div>
        )}
      </td>
      <td className={td}>
        <div className="font-medium text-neutral-900 dark:text-neutral-100">{unitPrice(item.price, item.unit, currency, locale, t)}</div>
        {pct && (
          <div className="text-[11px] text-neutral-400">
            {t("işin tutarının yüzdesi", "of the job amount")}
            {item.min_amount ? ` · ${t("en az", "min.")} ${money(item.min_amount, currency, locale)}` : ""}
          </div>
        )}
        <div className="text-[11px] text-neutral-400">
          {item.price_from ? new Date(item.price_from).toLocaleDateString(locale) : ""}
          {item.price_source === "guest" && <span className="ml-1 text-[#C6613F] dark:text-[#E8A48C]">· {t("tedarikçi güncelledi", "updated by supplier")}</span>}
        </div>
      </td>
      <td className={`${td} whitespace-nowrap text-right`}>
        {member && item.track_stock && (
          <button type="button" onClick={onStock} className={btnLink}>
            {t("Stok", "Stock")}
          </button>
        )}
        {item.versions > 1 && (
          <button type="button" onClick={onHistory} className={`${btnLink} ml-3`}>
            {t("Geçmiş", "History")}
          </button>
        )}
        {editable && (
          <button type="button" onClick={() => setEdit(true)} className={`${btnLink} ml-3`}>
            {t("Düzenle", "Edit")}
          </button>
        )}
        {member && (
          <button type="button" onClick={() => void onArchive(!item.archived)} className={`${btnLink} ml-3`}>
            {item.archived ? t("Geri al", "Restore") : t("Arşivle", "Archive")}
          </button>
        )}
        {member && (
          <button type="button" onClick={onDelete} className={`${btnDanger} ml-3`}>
            {t("Sil", "Delete")}
          </button>
        )}
      </td>
    </tr>
  );
}

/** Malzeme kaleminin tür / kalınlık / plaka özeti ve fiyattan türetilen kg ya da plaka fiyatı. */
function StockSummary({ item, currency }: { item: PriceItem; currency: string }) {
  const { t, locale } = useT();
  const missingLabels = useMissingLabels();
  const parts = [
    materialLabel(item.material ?? null, t),
    item.thickness_mm ? `${item.thickness_mm} mm` : "",
    item.plate_width && item.plate_height ? `${item.plate_width}×${item.plate_height} mm` : "",
    item.plate_kg ? `${item.plate_kg} kg` : "",
    item.roll_width ? `${item.roll_width} mm` : "",
    item.film_um ? (item.material === "bubble" ? `${item.film_um / 1000} mm` : `${item.film_um} µm`) : "",
    item.roll_length ? `${item.roll_length} m` : "",
  ].filter(Boolean);
  const other = item.unit === "sheet" ? { label: "kg", value: item.derived?.kg } : { label: t("plaka", "plate"), value: item.derived?.plate };
  const gaps = item.missing ?? [];
  if (parts.length === 0 && !other?.value && gaps.length === 0) return null;
  return (
    <>
      <div className={muted}>
        {parts.join(" · ")}
        {other?.value != null && ` ${parts.length ? "·" : ""} ${t("hesaplanan", "derived")} ${other.label}: ${money(other.value, currency, locale)}`}
      </div>
      {gaps.length > 0 && (
        <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          {t("Eksik", "Missing")}: {missingLabels(gaps)}
        </div>
      )}
    </>
  );
}

/** "+ … ekle" düğmesi; basınca etiketli alanlardan oluşan bir kart açılır (liste kalabalık görünmesin). */
function AddRow({
  kinds,
  units,
  currency,
  api,
  entityId,
  canAuto,
  addLabel,
  onAdd,
}: {
  kinds: PriceKind[];
  units?: string[];
  currency: string;
  api: EntityApi;
  entityId: number;
  canAuto: boolean;
  addLabel: string;
  onAdd: (v: { kind: PriceKind; name: string; unit: string; spec?: string; price: number; auto_qty?: number | null; min_amount?: number } & StockPatch) => Promise<void>;
}) {
  const { t, locale } = useT();
  const catalog = useMaterialCatalog();
  const missingLabels = useMissingLabels();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PriceKind>(kinds[0]);
  const [pct, setPct] = useState(false); // sabit ücret yüzdelik mi (işin tutarının %'si)
  const [minAmount, setMinAmount] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState(kinds[0] === "material" ? "sheet" : "min");
  const [price, setPrice] = useState("");
  const [auto, setAuto] = useState("");
  const [stock, setStock] = useState<StockForm>(emptyStock);
  const [busy, setBusy] = useState(false);
  const fixed = kind === "fee" || kind === "minimum";

  function close() {
    setOpen(false);
    setName("");
    setPct(false);
    setMinAmount("");
    setPrice("");
    setAuto("");
    setStock(emptyStock);
  }

  async function add() {
    const p = Number(price.replace(",", "."));
    if (!name.trim() || !Number.isFinite(p) || p < 0) {
      toast.error(t("Ad ve geçerli bir fiyat gir.", "Enter a name and a valid price."));
      return;
    }
    if (pct && p > 1000) {
      toast.error(t("Yüzde en fazla 1000 olabilir.", "The percentage can be at most 1000."));
      return;
    }
    const minV = pct && minAmount.trim() !== "" ? Number(minAmount.replace(",", ".")) : null;
    if (minV !== null && !(Number.isFinite(minV) && minV >= 0)) {
      toast.error(t("En az tutar sıfır ya da daha büyük bir sayı olmalı.", "The minimum amount must be zero or more."));
      return;
    }
    const autoQty = !fixed && canAuto && auto.trim() !== "" ? Number(auto.replace(",", ".")) : null;
    if (autoQty !== null && !(Number.isFinite(autoQty) && autoQty > 0)) {
      toast.error(t("Otomatik miktar sıfırdan büyük bir sayı olmalı.", "The automatic quantity must be a number above zero."));
      return;
    }
    const stockPatch = kind === "material" ? stockPayload(stock) : {};
    if (stockPatch === null) {
      toast.error(t("Kalınlık ve plaka değerleri sıfırdan büyük sayı olmalı.", "Thickness and plate values must be numbers above zero."));
      return;
    }
    const gaps = kind === "material" ? missingFields(catalog, stock, unit) : [];
    if (gaps.length > 0) {
      toast.error(t(`Eksik bilgi: ${missingLabels(gaps)}.`, `Missing: ${missingLabels(gaps)}.`));
      return;
    }
    setBusy(true);
    await onAdd({
      kind,
      name: name.trim(),
      unit: pct ? PERCENT : fixed ? "job" : unit,
      price: p,
      ...(minV !== null ? { min_amount: minV } : {}),
      ...(autoQty !== null ? { auto_qty: autoQty } : {}),
      ...stockPatch,
    });
    setBusy(false);
    close();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btnOutline} mb-4`}>
        + {addLabel}
      </button>
    );
  }

  return (
    <div className="mb-4 space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kinds.length > 1 && (
          <label className="block">
            <span className={labelCls}>{t("Tür", "Type")}</span>
            <select
              value={kind === "fee" && pct ? "pct" : kind}
              onChange={(e) => {
                setPct(e.target.value === "pct");
                setKind((e.target.value === "pct" ? "fee" : e.target.value) as PriceKind);
              }}
              className={`${input} w-full`}
            >
              <option value="fee">{t("İş başına ücret", "Per-job charge")}</option>
              <option value="pct">{t("Yüzde ücret (işin tutarının %'si)", "Percentage charge (% of the job)")}</option>
              <option value="minimum">{t("Minimum tutar", "Minimum amount")}</option>
            </select>
          </label>
        )}
        <label className="block lg:col-span-2">
          <span className={labelCls}>{t("Ad", "Name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder={kind === "material" ? t("Ör. 2 mm DKP plaka", "e.g. 2 mm steel sheet") : fixed ? t("Ör. Hazırlık", "e.g. Setup") : t("Ör. Lazer kesim", "e.g. Laser cutting")}
            className={`${input} w-full`}
            autoFocus
          />
        </label>
        {kind === "material" && (
          <label className="block">
            <span className={labelCls}>{t("Malzeme türü", "Material type")}</span>
            <MaterialTypeSelect
              api={api}
              entityId={entityId}
              value={stock.material}
              onChange={(m) => {
                const next = applyType(catalog, stock, unit, m);
                setStock(next.form);
                setUnit(next.unit);
              }}
              canAdd={canAuto}
              className="w-full"
            />
          </label>
        )}
        {!fixed && units && (
          <label className="block">
            <span className={labelCls}>{t("Birim", "Unit")}</span>
            <UnitSelect
              value={unit}
              onChange={(u) => {
                setUnit(u);
                setStock((st) => pruneStock(catalog, st, u));
              }}
              only={units}
              allowed={kind === "material" ? allowedUnits(catalog, stock.material) : undefined}
              className="w-full"
            />
          </label>
        )}
        <label className="block">
          <span className={labelCls}>{pct ? t("Yüzde (%)", "Percentage (%)") : `${t("Fiyat", "Price")} (${currency})`}</span>
          <DecimalInput value={price} onValue={setPrice} unit={pct ? "%" : currencySymbol(currency, locale)} placeholder="0" className={`${input} w-full`} />
        </label>
        {pct && (
          <label className="block">
            <span className={labelCls}>
              {t("En az tutar", "Minimum amount")} ({currency}){" "}
              <HelpTip>
                {t(
                  "İşin hizmet ve malzeme satırlarının toplamının bu yüzdesi eklenir; sonuç bu tutardan küçükse bu tutar alınır. Boşsa alt sınır yoktur. Sabit ücretler yüzdenin tabanına girmez.",
                  "This percentage of the job's service and material lines is added; if the result is lower than this amount, this amount is charged. When empty there is no floor. Fixed charges are not part of the base.",
                )}
              </HelpTip>
            </span>
            <DecimalInput value={minAmount} onValue={setMinAmount} unit={currencySymbol(currency, locale)} placeholder="—" className={`${input} w-full`} />
          </label>
        )}
        {!fixed && canAuto && (
          <label className="block">
            <span className={labelCls}>{t("Her işe otomatik miktar", "Auto qty per job")}</span>
            <DecimalInput
              value={auto}
              onValue={setAuto}
              placeholder="—"
              title={t("Doluysa bu kalem her yeni işe bu miktarla kendiliğinden eklenir.", "If set, this item is added to every new job with this quantity.")}
              className={`${input} w-full`}
            />
          </label>
        )}
      </div>
      {kind === "material" && <StockFields value={stock} unit={unit} onChange={setStock} />}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={close} className={btnLink}>
          {t("Vazgeç", "Cancel")}
        </button>
        <button type="button" disabled={busy} onClick={() => void add()} className={btnPrimary}>
          {t("Ekle", "Add")}
        </button>
      </div>
    </div>
  );
}

function HistoryModal({ api, entityId, item, currency, onClose }: { api: EntityApi; entityId: number; item: PriceItem; currency: string; onClose: () => void }) {
  const { t, locale } = useT();
  const { data } = useApiData<{ items: PriceVersion[] }>(`modkit-price-history:${api.base}:${entityId}:${item.id}`, () => api.prices.history(entityId, item.id));
  return (
    <Modal title={t(`Fiyat geçmişi: ${item.name}`, `Price history: ${item.name}`)} widthClass="max-w-lg" onClose={onClose}>
      {!data ? (
        <BlockSpinner />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className={rowBorder}>
              <th className={th}>{t("Geçerlilik", "Valid from")}</th>
              <th className={th}>{t("Fiyat", "Price")}</th>
              <th className={th}>{t("Değiştiren", "Changed by")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((v) => (
              <tr key={v.id} className={rowBorder}>
                <td className={td}>{new Date(v.valid_from).toLocaleDateString(locale)}</td>
                <td className={`${td} font-medium`}>{unitPrice(v.price, item.unit, currency, locale, t)}</td>
                <td className={td}>
                  {v.by || "—"}
                  {v.source === "guest" && <span className="ml-1 text-[11px] text-[#C6613F] dark:text-[#E8A48C]">({t("tedarikçi", "supplier")})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-4 text-right">
        <button type="button" onClick={onClose} className={btnOutline}>
          {t("Kapat", "Close")}
        </button>
      </div>
    </Modal>
  );
}

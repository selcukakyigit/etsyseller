"use client";

import { useState } from "react";
import { TrashIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { EntityApi, MeasuresBody, ProductMeasureRow, SheetAnalysis } from "../core/api";
import { errMsg } from "../core/errors";
import { badge, btnDark, btnLink, btnOutline, input, muted, rowBorder, td, th, warnBox } from "../core/ui";
import { qty as fmtQty } from "../core/units";
import DecimalInput from "./DecimalInput";
import MaterialTypeSelect from "./MaterialTypeSelect";
import ProductPicker, { PickedProduct, productName, ShopSelect, useShopChoice } from "./ProductPicker";

const COLORS = ["#D97757", "#3B82F6", "#10B981", "#A855F7", "#EAB308", "#EF4444", "#06B6D4", "#84CC16"];
const colorOf = (index: number) => COLORS[(index - 1) % COLORS.length];

/** Gruplama hassasiyeti: şekiller bu mesafeden yakınsa aynı grup sayılır. */
const GAPS = [
  { mm: 5, tr: "En sıkı", en: "Tightest" },
  { mm: 10, tr: "Çok sıkı", en: "Very tight" },
  { mm: 20, tr: "Sıkı", en: "Tight" },
  { mm: 60, tr: "Normal", en: "Normal" },
  { mm: 150, tr: "Gevşek", en: "Loose" },
];
const DEFAULT_GAP = 60;

type Assignment = {
  product: Pick<PickedProduct, "shop_id" | "listing_id" | "variant" | "title"> | null;
  /** Tanınan grubun ürünündeki parça no: grup o parçanın ölçüsünü günceller (yoksa yeni parça olur). */
  part: number | null;
  count: string;
  recognised: boolean;
  /** İsteğe bağlı: malzeme türü ve kalınlığı (mm, metin). Boş bırakılan, ürünün önceki tanımını silmez. */
  material: string;
  thickness: string;
};

const productKey = (p: { shop_id: number; listing_id: number; variant: string }) => `${p.shop_id}:${p.listing_id}:${p.variant}`;

/** Gruplara parça numarası verir: tanınan grup tanındığı parçayı günceller; diğerleri, ürünün kayıtlı parçalarından ve bu kayıttaki
 * önceki gruplardan sonraki boş numarayı alır (ürün hiç kayıtlı değilse en uzun kesimli grup 0. parça olur). */
function partNumbers(groups: { index: number; cut_length_mm: number }[], assign: Record<number, Assignment>, existing: ProductMeasureRow[]): Record<number, number> {
  const used = new Map<string, Set<number>>();
  const taken = (key: string) => {
    if (!used.has(key)) used.set(key, new Set(existing.filter((r) => productKey(r) === key).map((r) => r.part)));
    return used.get(key)!;
  };
  const out: Record<number, number> = {};
  const fresh = (key: string) => {
    let n = 0;
    while (taken(key).has(n)) n++;
    return n;
  };
  // önce tanınanlar: kendi parçalarını sabitler
  const claimed = new Set<string>();
  for (const g of groups) {
    const a = assign[g.index];
    const key = a.product ? productKey(a.product) : "";
    if (a.product && a.part !== null && !claimed.has(`${key}#${a.part}`)) {
      claimed.add(`${key}#${a.part}`);
      out[g.index] = a.part;
    }
  }
  // yeni parçalar büyükten küçüğe numaralanır: en uzun kesimli grup ürünün ana parçası (0. parça) olur
  for (const g of [...groups].sort((x, y) => y.cut_length_mm - x.cut_length_mm)) {
    const a = assign[g.index];
    if (!a.product || g.index in out) continue;
    const key = productKey(a.product);
    const n = fresh(key);
    taken(key).add(n);
    out[g.index] = n;
  }
  return out;
}

/** Önceden tanıtılmış ürünle uyuşan gruplar kendiliğinden atanır (kullanıcı değiştirebilir). */
const assignFrom = (r: SheetAnalysis, existing: ProductMeasureRow[]): Record<number, Assignment> =>
  Object.fromEntries(
    r.groups.map((g) => {
      // Tanınan grubun malzemesi, tanındığı parçanın kayıtlı malzemesiyle dolu gelir.
      const row = g.known && existing.find((x) => productKey(x) === productKey(g.known!) && x.part === g.known!.part);
      return [g.index, { product: g.known, part: g.known?.part ?? null, count: "1", recognised: !!g.known, material: row?.material ?? "", thickness: row?.values.thickness != null ? String(row.values.thickness) : "" }];
    }),
  );

/** Plaka çizimi (birden çok ürün; modal içeriği): çözümlenmiş DXF konumlarına göre gruplara ayrılmış gelir, her grup çizim üzerinde
 * renkli gösterilir; kullanıcı grubu bir ürüne atar ve "kaç adet" olduğunu yazar. Ölçüler ürün başınadır (grup ÷ adet) ve ürüne
 * yazılır: aynı ürün sonraki plakalarda ebat ve uzunluğundan tanınır. Çözümleme pencere açılmadan önce yapılır (bkz.
 * ProductMeasures). Yalnızca çalışma alanı üyesi kullanır. */
export default function SheetSplitter({
  api,
  entityId,
  file,
  initial,
  existing,
  onPickOther,
  onSaved,
}: {
  api: EntityApi;
  entityId: number;
  file: File;
  initial: SheetAnalysis;
  /** Bu kayıtta zaten tanımlı ürün parçaları (yeni grupların parça numarasını belirler). */
  existing: ProductMeasureRow[];
  onPickOther: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useT();
  const { shops, shopId, setShopId } = useShopChoice(api, entityId);
  const [gap, setGap] = useState(DEFAULT_GAP);
  const [sheet, setSheet] = useState(initial);
  const [assign, setAssign] = useState(() => assignFrom(initial, existing));
  const [hot, setHot] = useState<number | null>(null);
  const [off, setOff] = useState<number[]>([]); // hariç tutulan gruplar (ör. not yazısı): ne toplama girer ne kaydedilir
  const [busy, setBusy] = useState(false);
  const isOff = (index: number) => off.includes(index);
  const toggleOff = (index: number) => setOff((o) => (o.includes(index) ? o.filter((x) => x !== index) : [...o, index]));

  function regroup(mm: number) {
    setGap(mm);
    setBusy(true);
    api.measures
      .sheet(entityId, file, mm)
      .then((r) => {
        setSheet(r);
        setAssign(assignFrom(r, existing));
        setOff([]);
      })
      .catch((e) => toast.error(errMsg(e, t("Çizim okunamadı", "Could not read the drawing"))))
      .finally(() => setBusy(false));
  }

  const kept = sheet.groups.filter((g) => !isOff(g.index));
  const chosen = kept.filter((g) => assign[g.index]?.product);
  // Aynı ürüne birden çok grup atandıysa her grup ürünün bir parçasıdır: ölçüler olduğu gibi (bölünmeden, ebatla) yazılır ve adet
  // kutusu "ürün başına bu parçadan kaç tane" anlamına gelir. Tek grupluysa adet, gruptaki kopya sayısıdır (ölçü ona bölünür).
  const perProduct = new Map<string, number>();
  for (const g of chosen) perProduct.set(productKey(assign[g.index].product!), (perProduct.get(productKey(assign[g.index].product!)) ?? 0) + 1);
  const isPart = (a: Assignment) => !!a.product && (perProduct.get(productKey(a.product)) ?? 0) > 1;
  const typed = (a: Assignment) => Math.max(1, Math.floor(Number(a.count) || 1));
  const pieces = (a: Assignment) => (isPart(a) ? 1 : typed(a));

  async function save() {
    if (!sheet) return;
    const parts = partNumbers(chosen, assign, existing);
    setBusy(true);
    try {
      for (const g of chosen) {
        const a = assign[g.index];
        const n = pieces(a);
        const body: MeasuresBody = {
          values: {
            cut_length: Math.round((g.cut_length_mm / n) * 10) / 10,
            pierce_count: Math.max(1, Math.round(g.pierce_count / n)),
          },
        };
        if (g.area_mm2 != null) body.values.surface = Math.round((g.area_mm2 / n) * 10) / 10; // alan kopyalara bölünür, kesim gibi
        // Boş bırakılan malzeme ve kalınlık, ürünün önceki tanımını silmez.
        if (a.material) body.material = a.material;
        const thickness = Number(a.thickness.replace(",", "."));
        if (a.thickness.trim() !== "") {
          if (!(Number.isFinite(thickness) && thickness > 0)) throw new Error(t("Kalınlık sıfırdan büyük bir sayı olmalı", "Thickness must be a number above zero"));
          body.values.thickness = thickness;
        }
        if (isPart(a)) body.values.part_qty = typed(a);
        // Ebat yalnızca grup tek ürünse ürünün ebadıdır; birden çok kopyada grubun kutusu ürünün boyutu değildir.
        if (n === 1) Object.assign(body.values, { width: g.width_mm, height: g.height_mm });
        await api.measures.set(entityId, a.product!.shop_id, a.product!.listing_id, body, "cad", a.product!.variant, parts[g.index]);
      }
      toast.success(t(`${chosen.length} grubun ölçüsü kaydedildi`, `Saved measures for ${chosen.length} groups`));
      onSaved();
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
    }
    setBusy(false);
  }

  return (
    <div>
      <p className={`${muted} mb-3`}>
        <span className="font-medium text-neutral-700 dark:text-neutral-200">{file.name}</span>
        {" · "}
        {t(
          "Şekiller konumlarına göre gruplandı. Her grubu bir ürüne ata; ölçü ürüne yazılır ve aynı ürün sonraki plakalarda kendiliğinden tanınır. Birden çok grubu aynı ürüne atayabilirsin: her biri kendi ebadı ve malzemesiyle ürünün bir parçası olur. Malzeme türü ve kalınlık isteğe bağlıdır (malzeme maliyeti hesaplanacaksa gerekir).",
          "Shapes are grouped by position. Assign each group to a product; the measures are saved on the product and the same product is recognised on later sheets. Several groups can go to one product: each becomes a part with its own size and material. Material type and thickness are optional (needed when material cost is worked out).",
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={onPickOther} className={btnOutline}>
          {t("Başka plaka seç", "Choose another sheet")}
        </button>
        {sheet && (
          <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t("Grup hassasiyeti", "Grouping")}
            <select
              value={gap}
              disabled={busy}
              onChange={(e) => regroup(Number(e.target.value))}
              className={`${input} py-1 text-xs`}
            >
              {GAPS.map((g) => (
                <option key={g.mm} value={g.mm}>
                  {t(g.tr, g.en)} ({g.mm} mm)
                </option>
              ))}
            </select>
          </label>
        )}
        <ShopSelect shops={shops} shopId={shopId} onChange={setShopId} />
        {busy && <Spinner size={16} />}
      </div>

      {sheet && (
        <div className="mt-4 space-y-4">
          <svg
            viewBox={sheet.viewbox.join(" ")}
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"
            style={{ aspectRatio: `${sheet.viewbox[2]} / ${sheet.viewbox[3]}`, maxHeight: 420 }}
            role="img"
            aria-label={t("Plaka çizimi önizlemesi", "Sheet drawing preview")}
          >
            {sheet.groups.map((g) => (
              <g key={g.index} opacity={isOff(g.index) ? 0.12 : hot === null || hot === g.index ? 1 : 0.25}>
                <path d={g.path} fill="none" stroke={colorOf(g.index)} strokeWidth={hot === g.index ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
                <text x={(g.box[0] + g.box[2]) / 2} y={g.box[1] - sheet.viewbox[2] / 120} textAnchor="middle" fontSize={sheet.viewbox[2] / 45} fontWeight={700} fill={colorOf(g.index)}>
                  {g.index}
                </text>
              </g>
            ))}
          </svg>

          <p className={muted}>
            {t("Toplam", "Total")}: {fmtQty(kept.reduce((s, g) => s + g.cut_length_mm, 0) / 1000, locale)} m · {kept.reduce((s, g) => s + g.pierce_count, 0)} {t("delme", "pierces")} · {kept.length} {t("grup", "groups")}
            {off.length > 0 && (
              <span className="ml-2">
                ({t("hariç tutulan", "excluded")}: {off.length} {t("grup", "groups")}, {fmtQty(sheet.groups.filter((g) => isOff(g.index)).reduce((s, g) => s + g.cut_length_mm, 0) / 1000, locale)} m)
              </span>
            )}
          </p>
          {sheet.total.units_assumed && (
            <p className={warnBox}>{t("Çizimde birim yazmıyor; milimetre varsayıldı. Rapordaki toplamla karşılaştırıp kontrol et.", "The drawing has no unit; millimetres were assumed. Compare with the report's total to check.")}</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className={rowBorder}>
                  <th className={th}>{t("Grup", "Group")}</th>
                  <th className={th}>{t("Ebat (mm)", "Size (mm)")}</th>
                  <th className={th}>{t("Kesim", "Cut")}</th>
                  <th className={th}>{t("Delme", "Pierces")}</th>
                  <th className={th}>{t("Ürün", "Product")}</th>
                  <th className={th}>{t("Malzeme", "Material")}</th>
                  <th className={th}>{t("Adet", "Qty")}</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {sheet.groups.map((g) => {
                  const a = assign[g.index] ?? { product: null, part: null, count: "1", recognised: false, material: "", thickness: "" };
                  const n = pieces(a);
                  const set = (patch: Partial<Assignment>) => setAssign((m) => ({ ...m, [g.index]: { ...a, ...patch } }));
                  const excluded = isOff(g.index);
                  const dim = excluded ? "opacity-40" : ""; // satırın içeriği solar; geri alma düğmesi canlı kalır
                  return (
                    <tr key={g.index} className={rowBorder} onMouseEnter={() => setHot(g.index)} onMouseLeave={() => setHot(null)}>
                      <td className={`${td} ${dim}`}>
                        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: colorOf(g.index) }}>
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(g.index) }} />#{g.index}
                        </span>
                        <div className="text-[11px] text-neutral-400">{g.shapes} {t("şekil", "shapes")}</div>
                      </td>
                      <td className={`${td} ${dim}`}>
                        {fmtQty(g.width_mm, locale)} × {fmtQty(g.height_mm, locale)}
                      </td>
                      <td className={`${td} ${dim} whitespace-nowrap`}>{fmtQty(g.cut_length_mm / 1000, locale)} m</td>
                      <td className={`${td} ${dim}`}>{g.pierce_count}</td>
                      <td className={`${td} ${dim}`}>
                        {a.product ? (
                          <div className="flex items-center gap-2">
                            <span className="line-clamp-2 max-w-xs text-neutral-900 dark:text-neutral-100">{productName(a.product.title || `#${a.product.listing_id}`, a.product.variant)}</span>
                            {a.recognised && <span className={`${badge} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`}>{t("tanındı", "recognised")}</span>}
                            <button type="button" disabled={excluded} onClick={() => set({ product: null, part: null, recognised: false })} className={btnLink} aria-label={t("Atamayı kaldır", "Remove assignment")}>
                              ✕
                            </button>
                          </div>
                        ) : (
                          <ProductPicker api={api} entityId={entityId} shopId={shopId} disabled={excluded} onPick={(p) => set({ product: p, part: null, recognised: false })} />
                        )}
                        {a.product && n > 1 && (
                          <div className="text-[11px] text-neutral-400">
                            {t("ürün başına", "per unit")}: {fmtQty(g.cut_length_mm / n / 1000, locale)} m, {Math.max(1, Math.round(g.pierce_count / n))} {t("delme", "pierces")}
                          </div>
                        )}
                      </td>
                      <td className={`${td} ${dim}`}>
                        <div className="flex items-center gap-1.5">
                          <MaterialTypeSelect value={a.material} onChange={(m) => set({ material: m })} disabled={excluded} className="w-36 py-1.5" />
                          <DecimalInput value={a.thickness} onValue={(v) => set({ thickness: v })} disabled={excluded} placeholder="mm" className={`${input} w-16 py-1.5`} aria-label={t("Kalınlık (mm)", "Thickness (mm)")} />
                        </div>
                      </td>
                      <td className={`${td} ${dim}`}>
                        <input
                          value={a.count}
                          onChange={(e) => set({ count: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                          inputMode="numeric"
                          disabled={excluded}
                          title={isPart(a) ? t("Aynı ürüne birden çok grup atandı: bu kutu, ürünün bu parçasından kaç tane gerektiğidir.", "Several groups are assigned to this product: this is how many of this part the product needs.") : undefined}
                          className={`${input} w-20`}
                          aria-label={isPart(a) ? t("Ürün başına bu parçadan adet", "Quantity of this part per product") : t("Gruptaki adet", "Pieces in the group")}
                        />
                      </td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        <button
                          type="button"
                          onClick={() => toggleOff(g.index)}
                          title={excluded ? t("Geri al", "Restore") : t("Bu grubu hariç tut (ör. not yazısı)", "Exclude this group (e.g. a note text)")}
                          aria-label={excluded ? t("Grubu geri al", "Restore the group") : t("Grubu hariç tut", "Exclude the group")}
                          className="inline-flex items-center gap-1 rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800 dark:hover:text-red-400"
                        >
                          {excluded ? <span className="text-xs font-medium">{t("Geri al", "Restore")}</span> : <TrashIcon />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || chosen.length === 0} onClick={() => void save()} className={btnDark}>
              {t(`Seçilen ürünlere yaz (${chosen.length})`, `Save to selected products (${chosen.length})`)}
            </button>
            <span className={muted}>{t("Çöp kutusu grubu toplamdan çıkarır ve kaydetmez. Gruptaki adet birden büyükse ölçü ürün başına (grup ÷ adet) yazılır.", "The bin excludes a group from the total and from saving. If a group holds several pieces, the per-unit measure (group ÷ quantity) is saved.")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

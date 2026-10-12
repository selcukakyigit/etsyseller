"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import DecimalInput from "@/components/ui/NumberInputs";
import { PriceItem } from "../core/api";
import { errMsg } from "../core/errors";
import { btnDark, btnLink, btnOutline, input, label, muted, rowBorder, td, th } from "../core/ui";
import { money, qty as fmtQty, unitLabel } from "../core/units";
import { PackageLine, PackageLineBody, PackagePreview, supplyApi } from "./api";

/** Düzenlenen satır: sayılar metin olarak tutulur (boş = 0 / aralık yok). */
export interface LineDraft {
  item: string;
  constant: string;
  per_long: string;
  per_short: string;
  per_area: string;
}

export interface PackageDraft {
  id: number | null;
  name: string;
  is_default: boolean;
  lines: LineDraft[];
}

export const emptyLine = (): LineDraft => ({ item: "", constant: "", per_long: "", per_short: "", per_area: "" });

const text = (n: number | null) => (n === null || n === 0 ? "" : String(n));

export const draftOf = (p: { id: number; name: string; is_default: boolean; lines: PackageLine[] }): PackageDraft => ({
  id: p.id,
  name: p.name,
  is_default: p.is_default,
  lines: p.lines.map((l) => ({ item: String(l.price_item_id), constant: text(l.constant), per_long: text(l.per_long), per_short: text(l.per_short), per_area: text(l.per_area) })),
});

const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")));

/** Taslak satırın sunucuya gidecek hâli; malzeme seçilmemiş ya da hiçbir katsayı yoksa null (satır henüz tamamlanmamış). */
export function bodyOf(l: LineDraft): PackageLineBody | null {
  const body = { price_item_id: Number(l.item), constant: num(l.constant), per_long: num(l.per_long), per_short: num(l.per_short), per_area: num(l.per_area) };
  const values = [body.constant, body.per_long, body.per_short, body.per_area];
  if (!l.item || values.some((v) => !Number.isFinite(v) || v < 0) || !values.some((v) => v > 0)) return null;
  return body;
}

/** Paket türü düzenleyici: ad, "varsayılan" işareti ve satırlar; altta örnek bir ürün ebadı için anlık miktar/maliyet önizlemesi. */
export default function PackageEditor({ entityId, currency, items, draft: initial, onSaved, onCancel }: { entityId: number; currency: string; items: PriceItem[]; draft: PackageDraft; onSaved: () => void; onCancel: () => void }) {
  const { t, locale } = useT();
  const [draft, setDraft] = useState(initial);
  const [size, setSize] = useState({ long: "100", short: "50" });
  const [preview, setPreview] = useState<PackagePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const bodies = draft.lines.map(bodyOf);
  const complete = bodies.length > 0 && bodies.every((b) => b !== null);
  const key = JSON.stringify([bodies, size]);
  const longCm = num(size.long);
  const shortCm = num(size.short);
  const lines = bodies.filter((b): b is PackageLineBody => b !== null);
  const previewable = lines.length > 0 && longCm > 0 && shortCm > 0; // eksik satır ya da ebat varsa önizleme gösterilmez

  useEffect(() => {
    if (!previewable) return;
    const timer = setTimeout(() => {
      supplyApi.packages.preview(entityId, lines, longCm, shortCm).then(setPreview).catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, entityId]);

  const setLine = (index: number, patch: Partial<LineDraft>) => setDraft((d) => ({ ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));

  async function save() {
    if (!draft.name.trim() || !complete) {
      toast.error(t("Ad yaz; her satırda malzeme seç ve en az bir katsayı gir.", "Enter a name; every line needs an item and at least one coefficient."));
      return;
    }
    setBusy(true);
    try {
      await supplyApi.packages.save(entityId, draft.id, { name: draft.name.trim(), is_default: draft.is_default, lines: bodies as PackageLineBody[] });
      toast.success(t("Paket türü kaydedildi", "Package type saved"));
      onSaved();
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
      setBusy(false);
    }
  }

  const cell = `${input} w-full py-1 text-sm`;
  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block min-w-[14rem] flex-1">
          <span className={label}>{t("Paket türü adı", "Package type name")}</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} placeholder={t("Ör. Ahşap çerçeve", "e.g. Wooden frame")} className={`${input} w-full`} autoFocus />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700 dark:text-neutral-200">
          <input type="checkbox" checked={draft.is_default} onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })} className="h-4 w-4 accent-[#D97757]" />
          {t("Varsayılan (paket atanmamış her ürüne)", "Default (for every product with no package)")}
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className={rowBorder}>
              <th className={th}>{t("Malzeme / hizmet", "Material / service")}</th>
              <th className={th}>{t("Sabit", "Constant")}</th>
              <th className={th}>{t("× uzun kenar", "× long side")}</th>
              <th className={th}>{t("× kısa kenar", "× short side")}</th>
              <th className={th}>{t("× alan", "× area")}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((l, i) => (
              <tr key={i} className={rowBorder}>
                <td className={td}>
                  <select value={l.item} onChange={(e) => setLine(i, { item: e.target.value })} className={`${cell} min-w-[12rem]`} aria-label={t("Malzeme", "Material")}>
                    <option value="">{t("Seç…", "Select…")}</option>
                    {items.map((it) => (
                      <option key={it.id} value={String(it.id)}>
                        {it.name} ({it.by_length ? t("metre", "metres") : unitLabel(it.unit, t)})
                      </option>
                    ))}
                  </select>
                </td>
                {(["constant", "per_long", "per_short", "per_area"] as const).map((k) => (
                  <td key={k} className={td}>
                    <DecimalInput value={l[k]} onValue={(v) => setLine(i, { [k]: v })} placeholder="0" className={cell} />
                  </td>
                ))}
                <td className={`${td} text-right`}>
                  <button type="button" onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, x) => x !== i) }))} className="text-sm text-red-600 hover:underline dark:text-red-400" aria-label={t("Satırı kaldır", "Remove line")}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))} className={btnOutline}>
          + {t("Satır ekle", "Add line")}
        </button>
        <p className={`${muted} max-w-xl`}>
          {t(
            "Miktar = sabit + a × uzun kenar + b × kısa kenar + c × alan. Uzunluk kaleminde (m, cm) metre, alan kaleminde (m², cm²) m², hacim kaleminde (m³, litre) alan × kalınlık, tabaka kaleminde alan ÷ plaka alanı olarak hesaplanır; adet kaleminde sayıdır.",
            "Quantity = constant + a × long side + b × short side + c × area. Length items (m, cm) are in metres, area items (m², cm²) in m², volume items (m³, litres) are area × thickness, sheet items are area ÷ plate area; count items are a plain number.",
          )}
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-600">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-neutral-700 dark:text-neutral-200">
          <span className="font-medium">{t("Örnek ürün (cm)", "Sample product (cm)")}:</span>
          <label className="flex items-center gap-1.5">
            {t("uzun", "long")}
            <DecimalInput value={size.long} onValue={(v) => setSize((x) => ({ ...x, long: v }))} className={`${input} w-20 py-1`} />
          </label>
          <label className="flex items-center gap-1.5">
            {t("kısa", "short")}
            <DecimalInput value={size.short} onValue={(v) => setSize((x) => ({ ...x, short: v }))} className={`${input} w-20 py-1`} />
          </label>
        </div>
        {previewable && preview && preview.lines.length > 0 ? (
          <table className="w-full text-sm">
            <tbody>
              {preview.lines.map((r) => (
                <tr key={r.item_id + r.name + r.qty} className={rowBorder}>
                  <td className="py-1 pr-3">{r.name}</td>
                  <td className="py-1 pr-3 text-right text-neutral-600 dark:text-neutral-300">
                    {r.missing ? (
                      <span className="text-amber-700 dark:text-amber-400">{r.missing === "plate" ? t("Kalemde plaka boyutu eksik", "Plate size missing on the item") : t("Kalemde kalınlık eksik", "Thickness missing on the item")}</span>
                    ) : (
                      <>
                        {r.metres != null ? `${fmtQty(r.metres, locale)} m ≈ ` : ""}
                        {fmtQty(r.qty, locale)} {unitLabel(r.unit, t)}
                      </>
                    )}
                  </td>
                  <td className="py-1 pr-3 text-right text-neutral-500">{money(r.unit_price, currency, locale)}</td>
                  <td className="py-1 text-right font-medium">{money(r.cost, currency, locale)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 font-semibold" colSpan={3}>
                  {t("Ürün başına ambalaj", "Packaging per product")}
                </td>
                <td className="py-1.5 text-right font-semibold text-emerald-700 dark:text-emerald-400">{money(preview.total, currency, locale)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className={muted}>{t("Satırları tamamlayınca örnek ürün için miktar ve maliyet burada görünür.", "Complete the lines to see quantities and cost for the sample product here.")}</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        {busy && <Spinner size={14} />}
        {!busy && !complete && <span className="mr-auto text-xs text-amber-700 dark:text-amber-400">{t("Her satırda malzeme seç ve en az bir katsayı gir; kullanmayacağın satırı ✕ ile kaldır.", "Pick an item and enter at least one coefficient on every line; remove unused lines with ✕.")}</span>}
        <button type="button" disabled={busy} onClick={onCancel} className={btnLink}>
          {t("Vazgeç", "Cancel")}
        </button>
        <button type="button" disabled={busy || !complete || !draft.name.trim()} onClick={() => void save()} className={btnDark}>
          {t("Kaydet", "Save")}
        </button>
      </div>
    </div>
  );
}

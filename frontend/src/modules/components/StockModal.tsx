"use client";

import { useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import DecimalInput, { MoneyInput } from "@/components/ui/NumberInputs";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { EntityApi, PriceItem, StockMovement } from "../core/api";
import { errMsg } from "../core/errors";
import { btnLink, btnPrimary, input, label, muted, rowBorder, td, th } from "../core/ui";
import { currencySymbol, money, qty, unitLabel } from "../core/units";

type Tab = "in" | "count" | "history";

const today = () => new Date().toISOString().slice(0, 10);

/** Bir malzeme kaleminin stok penceresi: alım gir (miktar + toplam tutar ya da birim fiyat), sayım düzelt, hareket geçmişi. Miktar kalemin biriminde, paket
 * ya da (plaka kaleminde) kg olarak da yazılabilir; sunucu kalemin birimine çevirir ve toplam tutarı bölerek birim fiyatı bulur. */
export default function StockModal({
  api,
  entityId,
  item,
  currency,
  onChanged,
  onClose,
}: {
  api: EntityApi;
  entityId: number;
  item: PriceItem;
  currency: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const [tab, setTab] = useState<Tab>("in");
  const units = item.entry_units ?? [item.unit];
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState(item.pack_size ? "pack" : item.unit);
  const [priceMode, setPriceMode] = useState<"total" | "unit">("total");
  const [price, setPrice] = useState("");
  const [vat, setVat] = useState(false);
  const [updatePrice, setUpdatePrice] = useState(true);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: hist, reload } = useApiData<{ items: StockMovement[] }>(`modkit-stock-history:${api.base}:${entityId}:${item.id}`, () => api.prices.stockHistory(entityId, item.id));
  const n = Number(amount.replace(",", "."));
  const p = price.trim() === "" ? null : Number(price.replace(",", "."));
  const perEntryUnit = priceMode === "total" && p !== null && n > 0 ? p / n : null;
  const itemUnit = unitLabel(item.unit, t);
  const entryLabel = (u: string) => (u === "pack" ? t("paket", "pack") : unitLabel(u, t));

  async function submit() {
    if (!(Number.isFinite(n) && (tab === "count" ? amount.trim() !== "" && n >= 0 : n > 0))) {
      toast.error(t("Geçerli bir miktar yaz.", "Enter a valid quantity."));
      return;
    }
    if (p !== null && !(Number.isFinite(p) && p >= 0)) {
      toast.error(t("Geçerli bir tutar yaz.", "Enter a valid amount."));
      return;
    }
    setBusy(true);
    try {
      if (tab === "in") {
        await api.prices.stockIn(entityId, item.id, { qty: n, unit, ...(p !== null ? (priceMode === "total" ? { total: p } : { unit_price: p }) : {}), vat_included: vat, update_price: updatePrice && p !== null, date, note });
        toast.success(t("Stok girişi eklendi", "Stock entry added"));
      } else {
        await api.prices.stockCount(entityId, item.id, { counted: n, unit, date, note });
        toast.success(t("Sayım düzeltmesi kaydedildi", "Count correction saved"));
      }
      setAmount("");
      setPrice("");
      setNote("");
      reload();
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
    }
    setBusy(false);
  }

  const kindLabel = (m: StockMovement) =>
    ({ opening: t("Açılış", "Opening"), purchase: t("Alım", "Purchase"), use: m.ref_type ? t("İş kullanımı", "Used in job") : t("Kullanım", "Use"), adjust: t("Sayım düzeltmesi", "Count correction") })[m.kind];
  const tabLabel = { in: t("Alım gir", "Add purchase"), count: t("Sayım düzelt", "Correct count"), history: t("Geçmiş", "History") };

  return (
    <Modal title={t(`Stok: ${item.name}`, `Stock: ${item.name}`)} widthClass="max-w-2xl" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-800 dark:text-neutral-200">
          <span>
            {t("Eldeki", "On hand")}:{" "}
            <b>
              {qty(item.on_hand ?? 0, locale)} {itemUnit}
            </b>
          </span>
          {item.avg_cost != null && (
            <span>
              {t("Ortalama maliyet", "Average cost")}:{" "}
              <b>
                {money(item.avg_cost, currency, locale)} / {itemUnit}
              </b>
            </span>
          )}
        </div>
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
          {(["in", "count", "history"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === k ? "border-[#D97757] font-semibold text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"}`}
            >
              {tabLabel[k]}
            </button>
          ))}
        </div>

        {tab !== "history" && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className={label}>{tab === "in" ? t("Miktar", "Quantity") : t("Gerçekte eldeki miktar", "Actual quantity on hand")}</span>
                <div className="flex gap-2">
                  <DecimalInput value={amount} onValue={setAmount} placeholder="0" className={`${input} min-w-0 flex-1`} autoFocus />
                  <select value={unit} onChange={(e) => setUnit(e.target.value)} className={input} aria-label={t("Birim", "Unit")}>
                    {units.map((u) => (
                      <option key={u} value={u}>
                        {u === "pack" ? `${entryLabel(u)} (${qty(item.pack_size ?? 0, locale)} ${itemUnit})` : entryLabel(u)}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="block">
                <span className={label}>{t("Tarih", "Date")}</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${input} w-full`} />
              </label>
            </div>
            {tab === "in" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className={label}>
                    {t("Tutar", "Amount")}{" "}
                    <HelpTip>
                      {t(
                        "Faturadaki toplamı yaz, birim fiyat sistem tarafından bölünerek bulunur. İstersen birim başına fiyat da yazabilirsin. Boş bırakırsan ortalama maliyet kullanılır.",
                        "Enter the invoice total and the unit price is worked out by dividing. You can also enter a price per unit. If left empty, the average cost is used.",
                      )}
                    </HelpTip>
                  </span>
                  <MoneyInput value={price} onValue={setPrice} unit={currencySymbol(currency, locale)} placeholder="0.00" className={`${input} w-full`} />
                </label>
                <label className="block">
                  <span className={label}>{t("Tutar türü", "Amount type")}</span>
                  <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as "total" | "unit")} className={`${input} w-full`}>
                    <option value="total">{t("Toplam ödenen", "Total paid")}</option>
                    <option value="unit">{t("Birim başına", "Per unit")}</option>
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <input type="checkbox" checked={vat} onChange={(e) => setVat(e.target.checked)} className="h-4 w-4 accent-[#D97757]" />
                  {t("Tutar KDV dahil", "Amount includes VAT")}
                </label>
              </div>
            )}
            {tab === "in" && p !== null && (
              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input type="checkbox" checked={updatePrice} onChange={(e) => setUpdatePrice(e.target.checked)} className="h-4 w-4 accent-[#D97757]" />
                {t("Fiyat listesindeki fiyatı da bu alışa göre güncelle", "Also update the price-list price to this purchase")}
                <HelpTip>
                  {t(
                    "Açıksa kalemin güncel fiyatı bu alışın KDV hariç birim fiyatı olur; eski fiyat Geçmiş'te kalır. Alış kayıtları sonradan fiyat düzenlemesinden etkilenmez.",
                    "When on, the item's current price becomes this purchase's unit price excluding VAT; the old price stays in History. Purchase records are not affected by later price edits.",
                  )}
                </HelpTip>
              </label>
            )}
            {perEntryUnit !== null && (
              <p className={muted}>
                {t("Birim fiyat", "Unit price")}: {money(perEntryUnit, currency, locale)} / {entryLabel(unit)}
              </p>
            )}
            <label className="block">
              <span className={label}>{t("Not", "Note")}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={`${input} w-full`} />
            </label>
            <div className="text-right">
              <button type="button" disabled={busy} onClick={() => void submit()} className={btnPrimary}>
                {tab === "in" ? t("Girişi ekle", "Add entry") : t("Düzeltmeyi kaydet", "Save correction")}
              </button>
            </div>
          </div>
        )}

        {tab === "history" &&
          (!hist ? (
            <BlockSpinner />
          ) : hist.items.length === 0 ? (
            <p className={muted}>{t("Henüz hareket yok.", "No movements yet.")}</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={rowBorder}>
                    <th className={th}>{t("Tarih", "Date")}</th>
                    <th className={th}>{t("Hareket", "Movement")}</th>
                    <th className={`${th} text-right`}>{t("Miktar", "Quantity")}</th>
                    <th className={`${th} text-right`}>{t("Birim maliyet", "Unit cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {hist.items.map((m) => (
                    <tr key={m.id} className={rowBorder}>
                      <td className={td}>{new Date(`${m.moved_on}T00:00`).toLocaleDateString(locale)}</td>
                      <td className={td}>
                        {kindLabel(m)}
                        <div className={muted}>{[m.by, m.note].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className={`${td} text-right font-medium ${m.qty < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {m.qty > 0 ? "+" : ""}
                        {qty(m.qty, locale)} {itemUnit}
                      </td>
                      <td className={`${td} text-right`}>{money(m.unit_cost, currency, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        <div>
          <button type="button" onClick={onClose} className={btnLink}>
            {t("Kapat", "Close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { Order } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useT } from "@/lib/i18n-client";
import { DEFAULT_PRINT_OPTIONS, PrintOptions, printOrders } from "./printOrders";

const KEY = "orders.printOptions";

function load(): PrintOptions {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PRINT_OPTIONS, ...JSON.parse(raw) } : DEFAULT_PRINT_OPTIONS;
  } catch {
    return DEFAULT_PRINT_OPTIONS;
  }
}

/** Etsy'deki "You're about to print N order(s)" penceresinin karşılığı: paket fişi ve/veya sipariş fişi, her biri için özelleştirme seçenekleri. */
export default function PrintOrdersModal({ orders, shopName, onClose }: { orders: Order[]; shopName: string; onClose: () => void }) {
  const { t } = useT();
  const [opt, setOpt] = useState<PrintOptions>(load);
  const [remember, setRemember] = useState(false);
  const [open, setOpen] = useState<"slip" | "receipt" | null>(null);
  const set = <K extends keyof PrintOptions>(k: K, v: PrintOptions[K]) => setOpt((cur) => ({ ...cur, [k]: v }));

  function print() {
    if (remember) {
      try {
        localStorage.setItem(KEY, JSON.stringify(opt));
      } catch {
        /* kayıt yapılamazsa yazdırma yine çalışır */
      }
    }
    printOrders(orders, opt, shopName, t);
    onClose();
  }

  const box = "h-4 w-4 accent-[#D97757]";
  const check = (label: string, k: "shopName" | "buyerNotes" | "listingPhotos" | "costBreakdown") => (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
      <input type="checkbox" checked={opt[k]} onChange={(e) => set(k, e.target.checked)} className={box} />
      {label}
    </label>
  );
  const toggle = (which: "slip" | "receipt") => (
    <button type="button" onClick={() => setOpen(open === which ? null : which)} className="text-sm text-neutral-700 hover:underline dark:text-neutral-300" aria-expanded={open === which}>
      {t("Seçenekleri özelleştir", "Customize options")} {open === which ? "▴" : "▾"}
    </button>
  );
  const panel = "mt-2 space-y-2 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-800/60";

  return (
    <Modal
      title={t(`${orders.length} sipariş yazdırılacak`, `You're about to print ${orders.length} order(s)`)}
      widthClass="max-w-xl"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button onClick={print} disabled={!opt.packingSlips && !opt.orderReceipts} className={btnPrimary}>
            {t("Yazdır", "Print")}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">{t("Neyi yazdırmak istiyorsun?", "What would you like to print?")}</p>

      <div className="border-b border-neutral-100 pb-4 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-3">
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" checked={opt.packingSlips} onChange={(e) => set("packingSlips", e.target.checked)} className={`${box} mt-0.5`} />
            <span>
              <b className="text-sm text-neutral-900 dark:text-neutral-100">{t("Paket fişi", "Packing slips")}</b>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">{t("Alıcı için hazırlanır; hediye siparişlerde fiyat yazılmaz, hediye mesajı eklenir.", "Made for buyers; gift orders print without the price and include the gift message.")}</span>
            </span>
          </label>
          {toggle("slip")}
        </div>
        {open === "slip" && (
          <div className={panel}>
            {check(t("Mağaza adı", "Shop name"), "shopName")}
            {check(t("Alıcı notları", "Buyer notes"), "buyerNotes")}
            {check(t("Ürün fotoğrafları", "Listing photos"), "listingPhotos")}
            {check(t("Maliyet dökümü (hediyelerde yok)", "Cost breakdown (not on gifts)"), "costBreakdown")}
            <label className="block text-sm text-neutral-800 dark:text-neutral-100">
              {t("Kişisel not (isteğe bağlı)", "Personalized note (optional)")}
              <textarea
                value={opt.personalNote}
                onChange={(e) => set("personalNote", e.target.value)}
                rows={2}
                maxLength={300}
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </label>
          </div>
        )}
      </div>

      <div className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" checked={opt.orderReceipts} onChange={(e) => set("orderReceipts", e.target.checked)} className={`${box} mt-0.5`} />
            <span>
              <b className="text-sm text-neutral-900 dark:text-neutral-100">{t("Sipariş fişi", "Order receipts")}</b>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">{t("Senin için: siparişi hazırlama ve kayıt tutma.", "For you: order fulfillment and record-keeping.")}</span>
            </span>
          </label>
          {toggle("receipt")}
        </div>
        {open === "receipt" && (
          <div className={panel}>
            {check(t("Mağaza adı", "Shop name"), "shopName")}
            {check(t("Alıcı notları", "Buyer notes"), "buyerNotes")}
            {check(t("Ürün fotoğrafları", "Listing photos"), "listingPhotos")}
            {check(t("Maliyet dökümü", "Cost breakdown"), "costBreakdown")}
          </div>
        )}
      </div>

      <label className="mt-5 flex cursor-pointer items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className={box} />
        {t("Bu ayarları bir sonraki sefer için kaydet", "Save these settings for next time")}
      </label>
    </Modal>
  );
}

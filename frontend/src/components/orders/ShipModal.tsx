"use client";

import { useState } from "react";
import { api, Order } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useT } from "@/lib/i18n-client";

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

/** Siparişi Etsy'de "gönderildi" olarak işaretler (takip kodu isteğe bağlı). Alıcıya Etsy bildirimi gider. */
export default function ShipModal({
  shopId,
  order,
  onClose,
  onShipped,
}: {
  shopId: number;
  order: Order;
  onClose: () => void;
  onShipped: (updated: Order) => void;
}) {
  const { t } = useT();
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onShipped(await api.orders.ship(shopId, order.receipt_id, tracking.trim(), carrier.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
      setBusy(false);
    }
  }

  return (
    <Modal
      z={95}
      widthClass="max-w-md"
      title={`${t("Kargoya ver", "Mark as shipped")} · ${order.buyer_name}`}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button onClick={submit} disabled={busy} className={btnPrimary}>
            {busy ? t("Gönderiliyor…", "Sending…") : t("Gönderildi olarak işaretle", "Mark as shipped")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t("Kargo firması (isteğe bağlı)", "Carrier (optional)")}</label>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="FedEx, DHL, USPS…" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t("Takip kodu (isteğe bağlı)", "Tracking code (optional)")}</label>
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={inputCls} />
        </div>
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("Bu işlem Etsy'ye doğrudan yazılır ve alıcıya kargo bildirimi gider. Geri alınamaz.", "This is written directly to Etsy and the buyer gets a shipping notification. It cannot be undone.")}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

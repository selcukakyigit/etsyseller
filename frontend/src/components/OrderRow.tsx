"use client";

import { useState } from "react";
import { api, Order } from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

function shipUrgency(order: Order): "overdue" | "today" | "ok" | null {
  if (order.is_shipped || !order.expected_ship_date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const shipBy = new Date(order.expected_ship_date);
  shipBy.setHours(0, 0, 0, 0);
  if (shipBy < today) return "overdue";
  if (shipBy.getTime() === today.getTime()) return "today";
  return "ok";
}

export default function OrderRow({
  shopId,
  order,
  onShipped,
}: {
  shopId: number;
  order: Order;
  onShipped: (order: Order) => void;
}) {
  const [showShipForm, setShowShipForm] = useState(false);
  const [trackingCode, setTrackingCode] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urgency = shipUrgency(order);

  async function handleShip() {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.orders.ship(shopId, order.receipt_id, trackingCode, carrierName);
      onShipped(updated);
      setShowShipForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-neutral-900 dark:text-neutral-100">{order.buyer_name || "İsimsiz alıcı"}</p>
            <span className="text-xs text-neutral-400 dark:text-neutral-500">#{order.receipt_id}</span>
            {order.is_shipped ? (
              <span className="text-xs font-medium text-green-600 px-2 py-0.5 rounded-full bg-green-50">
                Kargolandı
              </span>
            ) : urgency === "overdue" ? (
              <span className="text-xs font-medium text-red-600 px-2 py-0.5 rounded-full bg-red-50">Gecikti</span>
            ) : urgency === "today" ? (
              <span className="text-xs font-medium text-amber-600 px-2 py-0.5 rounded-full bg-amber-50">
                Bugün kargoya ver
              </span>
            ) : null}
          </div>

          <ul className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400 space-y-0.5">
            {order.items.map((item, i) => (
              <li key={i}>
                {item.title} × {item.quantity}
              </li>
            ))}
          </ul>

          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1.5">
            {formatDate(order.created_at)} · {order.total}
            {order.expected_ship_date && ` · son kargo tarihi: ${formatDate(order.expected_ship_date)}`}
          </p>

          {order.tracking_codes.length > 0 && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Takip no: {order.tracking_codes.join(", ")}</p>
          )}
        </div>

        {!order.is_shipped && (
          <div className="flex-shrink-0">
            {!showShipForm ? (
              <button
                onClick={() => setShowShipForm(true)}
                className="text-sm font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition"
              >
                Kargoya Ver
              </button>
            ) : (
              <div className="flex flex-col gap-1.5 w-48">
                <input
                  value={trackingCode}
                  onChange={(e) => setTrackingCode(e.target.value)}
                  placeholder="Takip no (opsiyonel)"
                  className="text-sm rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1 outline-none focus:border-[#F1641E]"
                />
                <input
                  value={carrierName}
                  onChange={(e) => setCarrierName(e.target.value)}
                  placeholder="Kargo firması (opsiyonel)"
                  className="text-sm rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1 outline-none focus:border-[#F1641E]"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setShowShipForm(false)}
                    className="flex-1 text-xs font-medium px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                  >
                    Vazgeç
                  </button>
                  <button
                    onClick={handleShip}
                    disabled={loading}
                    className="flex-1 text-xs font-medium px-2 py-1 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition disabled:opacity-50"
                  >
                    {loading ? "…" : "Onayla"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}

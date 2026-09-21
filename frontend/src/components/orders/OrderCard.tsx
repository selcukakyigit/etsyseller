"use client";

import { useState } from "react";
import { Order } from "@/lib/api";
import { addressText, copyText, fmtDate, shipBucket, shipByLabel } from "./orderUtils";

const btn =
  "rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800";

/** Etsy Shop Manager'daki sipariş kartının karşılığı: alıcı, kalemler (varyasyon + kişiselleştirme), gönderim tarihi, adres. */
export default function OrderCard({
  order,
  selected,
  onSelect,
  onShip,
  onGift,
}: {
  order: Order;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onShip: () => void;
  onGift: () => void;
}) {
  const [addrOpen, setAddrOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const bucket = shipBucket(order);
  const urgent = !order.is_shipped && !order.is_canceled && (bucket === "overdue" || bucket === "today");

  async function copy(text: string, key: string) {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    }
  }

  return (
    <article
      className={`rounded-xl border bg-white p-5 dark:bg-neutral-900 ${
        selected ? "border-[#F1641E]" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex flex-col gap-5 lg:flex-row">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`${order.buyer_name} siparişini seç`}
          className="mt-1 h-4 w-4 shrink-0 accent-[#F1641E]"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{order.buyer_name || "İsimsiz alıcı"}</p>
            {order.is_gift && (
              <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[11px] font-semibold text-pink-800 dark:bg-pink-950/50 dark:text-pink-300">🎁 Hediye</span>
            )}
            {order.channel === "pattern" && (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-950/50 dark:text-violet-300">Pattern</span>
            )}
            {order.is_canceled && (
              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">İptal / iade</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            <a
              href={`https://www.etsy.com/your/orders/sold/${order.receipt_id}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              #{order.receipt_id}
            </a>{" "}
            ({order.channel === "pattern" ? "Pattern" : "Etsy"}) · {order.total}
          </p>
          {order.coupon && <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">🏷 Kupon indirimi: −{order.coupon}</p>}

          {order.buyer_note && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <b>Alıcı notu:</b> {order.buyer_note}
            </p>
          )}
          {order.is_gift && order.gift_message && (
            <p className="mt-2 rounded-lg bg-pink-50 p-2 text-xs text-pink-900 dark:bg-pink-950/40 dark:text-pink-200">
              <b>Hediye mesajı:</b> {order.gift_message}
            </p>
          )}

          <div className="mt-3 space-y-4">
            {order.items.map((item, i) => (
              <div key={i} className="flex gap-4">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image_url} alt="" className="h-24 w-24 shrink-0 rounded-lg border border-neutral-100 object-cover dark:border-neutral-800" />
                ) : (
                  <div className="h-24 w-24 shrink-0 rounded-lg bg-neutral-100 dark:bg-neutral-800" />
                )}
                <div className="min-w-0 text-xs text-neutral-600 dark:text-neutral-300">
                  <p className="text-sm text-neutral-900 dark:text-neutral-100">{item.title}</p>
                  <p className="mt-1">
                    Adet <b className="text-neutral-900 dark:text-neutral-100">{item.quantity}</b>
                    {item.sku ? ` · SKU ${item.sku}` : ""}
                  </p>
                  {(item.variations ?? []).map((v, j) => (
                    <p key={j} className="mt-0.5 break-words">
                      <span className="text-neutral-500">{v.name}</span>{" "}
                      <b className={v.personalization ? "text-neutral-900 dark:text-neutral-50" : "text-neutral-800 dark:text-neutral-200"}>{v.value}</b>
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full shrink-0 space-y-3 text-xs text-neutral-600 dark:text-neutral-300 lg:w-72">
          {order.is_shipped ? (
            <div>
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">Gönderildi</p>
              {order.shipments.length === 0 && <p>Takip bilgisi yok</p>}
              {order.shipments.map((s, i) => (
                <p key={i} className="mt-0.5">
                  {s.carrier ?? "Kargo"}
                  {s.tracking_code && (
                    <>
                      {" · "}
                      <button type="button" onClick={() => copy(s.tracking_code ?? "", `t${i}`)} className="underline underline-offset-2" title="Takip kodunu kopyala">
                        {s.tracking_code}
                      </button>
                      {copied === `t${i}` && <span className="ml-1 text-green-700">kopyalandı</span>}
                    </>
                  )}
                  {s.notified_at && <span className="block text-neutral-500">{fmtDate(s.notified_at)}</span>}
                </p>
              ))}
            </div>
          ) : (
            <p className={`text-sm font-semibold ${urgent ? "text-red-600" : "text-neutral-900 dark:text-neutral-100"}`}>{shipByLabel(order)}</p>
          )}
          <p>Sipariş tarihi: {fmtDate(order.created_at)}</p>
          <p>
            {order.shipping_upgrade ? `${order.shipping_upgrade} · ` : ""}
            {order.shipping_method ?? "Kargo"} {order.shipping_cost ? `(${order.shipping_cost})` : ""}
          </p>

          <div>
            <button type="button" onClick={() => setAddrOpen((v) => !v)} className="flex w-full items-center justify-between font-semibold text-neutral-900 dark:text-neutral-100" aria-expanded={addrOpen}>
              Teslimat adresi <span aria-hidden>{addrOpen ? "▴" : "▾"}</span>
            </button>
            {addrOpen ? (
              <div className="mt-1.5">
                <p className="whitespace-pre-line">{addressText(order)}</p>
                <button type="button" onClick={() => copy(addressText(order), "addr")} className="mt-1 underline underline-offset-2">
                  {copied === "addr" ? "Kopyalandı ✓" : "Adresi kopyala"}
                </button>
                <p className="mt-1.5 text-neutral-500">
                  E-posta: {order.buyer_email ?? "Etsy bu uygulamaya alıcı e-postasını vermiyor"}
                </p>
              </div>
            ) : (
              <p className="mt-0.5 text-neutral-500">
                {[order.address.city, order.address.state, order.address.country_iso].filter(Boolean).join(", ")}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {!order.is_shipped && !order.is_canceled && (
              <button type="button" onClick={onShip} className="rounded-full bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900">
                Kargoya ver
              </button>
            )}
            <button type="button" onClick={onGift} className={btn}>
              🎁 Hediye kartı
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

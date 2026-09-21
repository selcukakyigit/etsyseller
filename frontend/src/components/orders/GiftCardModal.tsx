"use client";

import { useMemo, useState } from "react";
import { Order } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import {
  Align,
  CardSize,
  DEFAULT_CONFIG,
  FONTS,
  FontId,
  GiftCardConfig,
  SIZES,
  TEMPLATES,
  TemplateId,
  VAlign,
  cardDims,
  cardsDocument,
  loadConfig,
  printCards,
  saveConfig,
} from "./giftCard";

const MM = 3.7795; // 1 mm = 3.7795 px (96 dpi)

/** Bir siparişin hediye kartı için başlangıç ayarları: kayıtlı ayar varsa o, yoksa siparişin verileri. */
export function configForOrder(order: Order): GiftCardConfig {
  const base: GiftCardConfig = {
    ...DEFAULT_CONFIG,
    message: order.gift_message ?? "",
    sender: order.gift_sender ?? "",
    recipient: order.address.name || order.buyer_name,
  };
  if (typeof window === "undefined") return base;
  return loadConfig(order.receipt_id, base);
}

const labelCls = "mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-200";
const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#F1641E] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-xs font-medium ${
            value === v ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Hediye kartı: tasarım seç, metni düzenle, konumlandır, yazdır. Ayarlar sipariş başına tarayıcıda saklanır. */
export default function GiftCardModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [cfg, setCfg] = useState<GiftCardConfig>(() => configForOrder(order));

  const update = (patch: Partial<GiftCardConfig>) =>
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveConfig(order.receipt_id, next);
      return next;
    });

  const { w, h } = cardDims(cfg);
  const pxW = w * MM;
  const pxH = h * MM;
  const scale = Math.min(1, 380 / pxW, 520 / pxH);
  const doc = useMemo(() => cardsDocument([cfg]), [cfg]);

  return (
    <Modal
      z={95}
      widthClass="max-w-5xl"
      title={`Hediye kartı · ${order.address.name || order.buyer_name}`}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            Kapat
          </button>
          <button onClick={() => printCards([cfg])} disabled={!cfg.message.trim()} className={btnPrimary}>
            Yazdır
          </button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Tasarım</label>
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-10 w-8 shrink-0 rounded border border-neutral-300 dark:border-neutral-700"
                style={{ background: TEMPLATES.find((t) => t.id === cfg.template)?.background }}
              />
              <select value={cfg.template} onChange={(e) => update({ template: e.target.value as TemplateId })} className={inputCls}>
                {(["Genel", "Özel günler"] as const).map((group) => (
                  <optgroup key={group} label={group}>
                    {TEMPLATES.filter((t) => t.group === group).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Mesaj</label>
            <textarea
              value={cfg.message}
              onChange={(e) => update({ message: e.target.value })}
              rows={5}
              placeholder="Hediye mesajını buraya yaz ya da düzenle…"
              className={inputCls}
            />
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
              {order.gift_message && (
                <button type="button" onClick={() => update({ message: order.gift_message ?? "" })} className="text-[#c94f16] hover:underline">
                  Hediye mesajından doldur
                </button>
              )}
              {order.buyer_note && (
                <button type="button" onClick={() => update({ message: order.buyer_note ?? "" })} className="text-[#c94f16] hover:underline">
                  Alıcı notundan doldur
                </button>
              )}
              {TEMPLATES.find((t) => t.id === cfg.template)?.sample && (
                <button
                  type="button"
                  onClick={() => update({ message: TEMPLATES.find((t) => t.id === cfg.template)?.sample ?? "" })}
                  className="text-[#c94f16] hover:underline"
                >
                  Tema için örnek mesaj ekle
                </button>
              )}
              {!order.gift_message && (
                <span className="text-neutral-500">Etsy bu siparişte hediye mesajı göndermedi; mesajı elle yazabilirsin.</span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                <input type="checkbox" checked={cfg.showRecipient} onChange={(e) => update({ showRecipient: e.target.checked })} /> Kime
              </label>
              <input value={cfg.recipient} onChange={(e) => update({ recipient: e.target.value })} className={inputCls} disabled={!cfg.showRecipient} />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                <input type="checkbox" checked={cfg.showSender} onChange={(e) => update({ showSender: e.target.checked })} /> Kimden
              </label>
              <input value={cfg.sender} onChange={(e) => update({ sender: e.target.value })} className={inputCls} disabled={!cfg.showSender} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Yazı tipi</label>
              <select value={cfg.font} onChange={(e) => update({ font: e.target.value as FontId })} className={inputCls}>
                {(Object.keys(FONTS) as FontId[]).map((f) => (
                  <option key={f} value={f}>
                    {FONTS[f].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Yazı rengi</label>
              <div className="flex items-center gap-2">
                <input type="color" value={cfg.color ?? "#333333"} onChange={(e) => update({ color: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-neutral-300" />
                <button type="button" onClick={() => update({ color: null })} className="text-xs text-neutral-600 hover:underline dark:text-neutral-300">
                  Tasarımın rengi
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>Yazı boyutu: {cfg.fontSize} pt</label>
            <input type="range" min={10} max={48} value={cfg.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} className="w-full accent-[#F1641E]" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Yatay hizalama</label>
              <Seg<Align> value={cfg.align} options={[["left", "Sol"], ["center", "Orta"], ["right", "Sağ"]]} onChange={(align) => update({ align })} />
            </div>
            <div>
              <label className={labelCls}>Dikey konum</label>
              <Seg<VAlign> value={cfg.vAlign} options={[["top", "Üst"], ["middle", "Orta"], ["bottom", "Alt"]]} onChange={(vAlign) => update({ vAlign })} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className={labelCls}>İnce dikey kaydırma: {cfg.offsetY}%</label>
              <button type="button" onClick={() => update({ align: "center", vAlign: "middle", offsetY: 0 })} className="text-xs text-[#c94f16] hover:underline">
                Ortala
              </button>
            </div>
            <input type="range" min={-30} max={30} value={cfg.offsetY} onChange={(e) => update({ offsetY: Number(e.target.value) })} className="w-full accent-[#F1641E]" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Kart boyutu</label>
              <select value={cfg.size} onChange={(e) => update({ size: e.target.value as CardSize })} className={inputCls}>
                {(Object.keys(SIZES) as CardSize[]).map((s) => (
                  <option key={s} value={s}>
                    {SIZES[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Yön</label>
              <Seg<"portrait" | "landscape">
                value={cfg.landscape ? "landscape" : "portrait"}
                options={[["portrait", "Dikey"], ["landscape", "Yatay"]]}
                onChange={(v) => update({ landscape: v === "landscape" })}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-center text-xs font-semibold text-neutral-500">Ön izleme (yazdırılacak görünüm)</p>
          <div className="rounded-xl bg-neutral-200 p-3 dark:bg-neutral-800">
            <div style={{ width: pxW * scale, height: pxH * scale }} className="mx-auto overflow-hidden shadow-lg">
              <iframe
                title="Hediye kartı önizleme"
                srcDoc={doc}
                style={{ width: pxW, height: pxH, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", background: "#fff" }}
              />
            </div>
          </div>
          <p className="mt-2 max-w-[380px] text-center text-[11px] text-neutral-500">
            Yazdırma penceresinde &quot;Kenar boşluğu: yok&quot; ve &quot;Arka plan grafikleri&quot; seçeneklerini aç.
          </p>
        </div>
      </div>
    </Modal>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Order } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import {
  Align,
  CardSize,
  CustomSizeEntry,
  DEFAULT_CONFIG,
  FONTS,
  FontId,
  GiftCardConfig,
  SIZES,
  TEMPLATES,
  TemplateId,
  VAlign,
  addCustomSize,
  cardDims,
  cardsDocument,
  loadConfig,
  loadCustomSizes,
  printCards,
  removeCustomSize,
  saveConfig,
} from "./giftCard";
import { useT } from "@/lib/i18n-client";

/** Şablon, yazı tipi ve boyut adlarının İngilizcesi (giftCard.ts'teki Türkçe adlar anahtar). */
const EN_LABELS: Record<string, string> = {
  Genel: "General",
  "Özel günler": "Special occasions",
  Klasik: "Classic",
  Çiçek: "Floral",
  "Kraft kağıt": "Kraft paper",
  Gece: "Night",
  Minimal: "Minimal",
  "Noel / Yılbaşı": "Christmas / Holidays",
  "Cadılar Bayramı": "Halloween",
  "Sevgililer Günü": "Valentine's Day",
  "Anneler Günü": "Mother's Day",
  "Babalar Günü": "Father's Day",
  Paskalya: "Easter",
  "Şükran Günü": "Thanksgiving",
  "Doğum günü": "Birthday",
  "Yeni Yıl": "New Year",
  "Düğün / Evlilik": "Wedding",
  "Klasik (serif)": "Classic (serif)",
  "El yazısı (script)": "Script",
  "Sade (sans)": "Simple (sans)",
  "Kalem (handwritten)": "Handwritten",
  "4 × 6 inç (102 × 152 mm)": "4 × 6 in (102 × 152 mm)",
  "5 × 7 inç (127 × 178 mm)": "5 × 7 in (127 × 178 mm)",
};

const ADD_CUSTOM = "__add_custom__";

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
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

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
  const { t: tx } = useT();
  const L = (label: string) => tx(label, EN_LABELS[label] ?? label);
  const [cfg, setCfg] = useState<GiftCardConfig>(() => configForOrder(order));
  // Kullanıcının kaydettiği özel kart boyutları — bu siparişe değil, tarayıcıya kayıtlı; her hediye kartında yeniden kullanılır.
  const [customSizes, setCustomSizes] = useState<CustomSizeEntry[]>(() => loadCustomSizes());
  const [addingSize, setAddingSize] = useState(false);
  const [newW, setNewW] = useState("100");
  const [newH, setNewH] = useState("150");
  const [newLabel, setNewLabel] = useState("");

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

  function handleSizeChange(v: string) {
    if (v === ADD_CUSTOM) {
      setNewLabel("");
      setAddingSize(true);
      return;
    }
    update({ size: v });
  }

  function saveNewSize() {
    const w2 = Number(newW.replace(",", "."));
    const h2 = Number(newH.replace(",", "."));
    if (!(w2 > 0) || !(h2 > 0)) return;
    const entry = addCustomSize(w2, h2, newLabel);
    setCustomSizes((prev) => [...prev, entry]);
    update({ size: entry.id });
    setAddingSize(false);
  }

  function deleteCurrentCustomSize() {
    removeCustomSize(cfg.size);
    setCustomSizes((prev) => prev.filter((s) => s.id !== cfg.size));
    update({ size: "4x6" });
  }

  const isCustomSelected = customSizes.some((s) => s.id === cfg.size);

  return (
    <Modal
      z={95}
      widthClass="max-w-5xl"
      title={`${tx("Hediye kartı", "Gift card")} · ${order.address.name || order.buyer_name}`}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            {tx("Kapat", "Close")}
          </button>
          <button onClick={() => printCards([cfg])} disabled={!cfg.message.trim()} className={btnPrimary}>
            {tx("Yazdır", "Print")}
          </button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <div className="space-y-5">
          <div>
            <label className={labelCls}>{tx("Tasarım", "Design")}</label>
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-10 w-8 shrink-0 rounded border border-neutral-300 dark:border-neutral-700"
                style={{ background: TEMPLATES.find((t) => t.id === cfg.template)?.background }}
              />
              <select value={cfg.template} onChange={(e) => update({ template: e.target.value as TemplateId })} className={inputCls}>
                {(["Genel", "Özel günler"] as const).map((group) => (
                  <optgroup key={group} label={L(group)}>
                    {TEMPLATES.filter((t) => t.group === group).map((t) => (
                      <option key={t.id} value={t.id}>
                        {L(t.label)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>{tx("Mesaj", "Message")}</label>
            <textarea
              value={cfg.message}
              onChange={(e) => update({ message: e.target.value })}
              rows={5}
              placeholder={tx("Hediye mesajını buraya yaz ya da düzenle…", "Write or edit the gift message here…")}
              className={inputCls}
            />
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
              {order.gift_message && (
                <button type="button" onClick={() => update({ message: order.gift_message ?? "" })} className="text-[#B4553A] hover:underline">
                  {tx("Hediye mesajından doldur", "Use the gift message")}
                </button>
              )}
              {order.buyer_note && (
                <button type="button" onClick={() => update({ message: order.buyer_note ?? "" })} className="text-[#B4553A] hover:underline">
                  {tx("Alıcı notundan doldur", "Use the buyer note")}
                </button>
              )}
              {TEMPLATES.find((t) => t.id === cfg.template)?.sample && (
                <button
                  type="button"
                  onClick={() => update({ message: TEMPLATES.find((t) => t.id === cfg.template)?.sample ?? "" })}
                  className="text-[#B4553A] hover:underline"
                >
                  {tx("Tema için örnek mesaj ekle", "Add a sample message for this theme")}
                </button>
              )}
              {!order.gift_message && (
                <span className="text-neutral-500">{tx("Etsy bu siparişte hediye mesajı göndermedi; mesajı elle yazabilirsin.", "Etsy did not send a gift message for this order; you can write one yourself.")}</span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                <input type="checkbox" checked={cfg.showRecipient} onChange={(e) => update({ showRecipient: e.target.checked })} /> {tx("Kime", "To")}
              </label>
              <input value={cfg.recipient} onChange={(e) => update({ recipient: e.target.value })} className={inputCls} disabled={!cfg.showRecipient} />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                <input type="checkbox" checked={cfg.showSender} onChange={(e) => update({ showSender: e.target.checked })} /> {tx("Kimden", "From")}
              </label>
              <input value={cfg.sender} onChange={(e) => update({ sender: e.target.value })} className={inputCls} disabled={!cfg.showSender} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{tx("Yazı tipi", "Font")}</label>
              <select value={cfg.font} onChange={(e) => update({ font: e.target.value as FontId })} className={inputCls}>
                {(Object.keys(FONTS) as FontId[]).map((f) => (
                  <option key={f} value={f}>
                    {L(FONTS[f].label)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{tx("Yazı rengi", "Text color")}</label>
              <div className="flex items-center gap-2">
                <input type="color" value={cfg.color ?? "#333333"} onChange={(e) => update({ color: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-neutral-300" />
                <button type="button" onClick={() => update({ color: null })} className="text-xs text-neutral-600 hover:underline dark:text-neutral-300">
                  {tx("Tasarımın rengi", "Design color")}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>{tx("Yazı boyutu", "Font size")}: {cfg.fontSize} pt</label>
            <input type="range" min={10} max={48} value={cfg.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} className="w-full accent-[#D97757]" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{tx("Yatay hizalama", "Horizontal alignment")}</label>
              <Seg<Align> value={cfg.align} options={[["left", tx("Sol", "Left")], ["center", tx("Orta", "Center")], ["right", tx("Sağ", "Right")]]} onChange={(align) => update({ align })} />
            </div>
            <div>
              <label className={labelCls}>{tx("Dikey konum", "Vertical position")}</label>
              <Seg<VAlign> value={cfg.vAlign} options={[["top", tx("Üst", "Top")], ["middle", tx("Orta", "Middle")], ["bottom", tx("Alt", "Bottom")]]} onChange={(vAlign) => update({ vAlign })} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className={labelCls}>{tx("İnce dikey kaydırma", "Fine vertical offset")}: {cfg.offsetY}%</label>
              <button type="button" onClick={() => update({ align: "center", vAlign: "middle", offsetY: 0 })} className="text-xs text-[#B4553A] hover:underline">
                {tx("Ortala", "Center")}
              </button>
            </div>
            <input type="range" min={-30} max={30} value={cfg.offsetY} onChange={(e) => update({ offsetY: Number(e.target.value) })} className="w-full accent-[#D97757]" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{tx("Kart boyutu", "Card size")}</label>
              {addingSize ? (
                <div className="space-y-2 rounded-lg border border-neutral-300 p-2.5 dark:border-neutral-700">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={newW}
                      onChange={(e) => setNewW(e.target.value)}
                      inputMode="decimal"
                      placeholder={tx("Genişlik", "Width")}
                      className={`${inputCls} px-2 py-1.5`}
                    />
                    <span className="text-xs text-neutral-500">×</span>
                    <input
                      value={newH}
                      onChange={(e) => setNewH(e.target.value)}
                      inputMode="decimal"
                      placeholder={tx("Yükseklik", "Height")}
                      className={`${inputCls} px-2 py-1.5`}
                    />
                    <span className="text-xs text-neutral-500">mm</span>
                  </div>
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={tx("İsim (opsiyonel, ör. Matbaacımın boyutu)", "Name (optional, e.g. My printer's size)")}
                    className={`${inputCls} px-2 py-1.5`}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setAddingSize(false)} className="text-xs text-neutral-500 hover:underline">
                      {tx("Vazgeç", "Cancel")}
                    </button>
                    <button type="button" onClick={saveNewSize} className="rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#C6613F]">
                      {tx("Kaydet", "Save")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select value={cfg.size} onChange={(e) => handleSizeChange(e.target.value)} className={inputCls}>
                    {(Object.keys(SIZES) as CardSize[]).map((s) => (
                      <option key={s} value={s}>
                        {L(SIZES[s].label)}
                      </option>
                    ))}
                    {customSizes.length > 0 && (
                      <optgroup label={tx("Kayıtlı özel boyutlar", "Saved custom sizes")}>
                        {customSizes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <option value={ADD_CUSTOM}>{tx("+ Özel boyut ekle…", "+ Add custom size…")}</option>
                  </select>
                  {isCustomSelected && (
                    <button type="button" onClick={deleteCurrentCustomSize} title={tx("Bu özel boyutu sil", "Delete this custom size")} className="shrink-0 text-xs text-red-600 hover:underline">
                      {tx("Sil", "Delete")}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>{tx("Yön", "Orientation")}</label>
              <Seg<"portrait" | "landscape">
                value={cfg.landscape ? "landscape" : "portrait"}
                options={[["portrait", tx("Dikey", "Portrait")], ["landscape", tx("Yatay", "Landscape")]]}
                onChange={(v) => update({ landscape: v === "landscape" })}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-center text-xs font-semibold text-neutral-500">{tx("Ön izleme (yazdırılacak görünüm)", "Preview (as printed)")}</p>
          <div className="rounded-xl bg-neutral-200 p-3 dark:bg-neutral-800">
            <div style={{ width: pxW * scale, height: pxH * scale }} className="mx-auto overflow-hidden shadow-lg">
              <iframe
                title={tx("Hediye kartı önizleme", "Gift card preview")}
                srcDoc={doc}
                scrolling="no"
                style={{ width: pxW, height: pxH, border: 0, overflow: "hidden", transform: `scale(${scale})`, transformOrigin: "top left", background: "#fff" }}
              />
            </div>
          </div>
          <p className="mt-2 max-w-[380px] text-center text-[11px] text-neutral-500">
            {tx(
              'Yazdırma penceresinde "Kenar boşluğu: yok" ve "Arka plan grafikleri" seçeneklerini aç.',
              'In the print dialog, set "Margins: none" and turn on "Background graphics".',
            )}
          </p>
        </div>
      </div>
    </Modal>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { api, BulkChanges, BulkTextOp, ReadinessStateDefinition, ReturnPolicy, ShippingProfile, ShopSection } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";

export type BulkOp = "title" | "description" | "tags" | "price" | "section" | "shipping" | "returns" | "processing" | "renewal";

const OPS: [BulkOp, string][] = [
  ["title", "Başlıkları düzenle"],
  ["tags", "Etiketleri düzenle"],
  ["description", "Açıklamaları düzenle"],
  ["price", "Fiyatları düzenle"],
  ["section", "Bölümü değiştir"],
  ["shipping", "Kargo profilini değiştir"],
  ["returns", "İade ve değişim politikasını değiştir"],
  ["processing", "İşlem profilini değiştir"],
  ["renewal", "Yenileme seçeneklerini değiştir"],
];

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#F1641E] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const labelCls = "mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-200";

function TextForm({ value, onChange, what }: { value: BulkTextOp; onChange: (v: BulkTextOp) => void; what: string }) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Ne yapılsın?</label>
        <select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as BulkTextOp["mode"] })} className={inputCls}>
          <option value="prefix">{what} başına ekle</option>
          <option value="suffix">{what} sonuna ekle</option>
          <option value="find_replace">Bul ve değiştir</option>
          <option value="set">Tümünü şununla değiştir</option>
        </select>
      </div>
      {value.mode === "find_replace" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Bulunacak</label>
            <input value={value.find ?? ""} onChange={(e) => onChange({ ...value, find: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Yerine</label>
            <input value={value.replace ?? ""} onChange={(e) => onChange({ ...value, replace: e.target.value })} className={inputCls} />
          </div>
        </div>
      ) : (
        <div>
          <label className={labelCls}>Metin</label>
          <textarea value={value.text ?? ""} onChange={(e) => onChange({ ...value, text: e.target.value })} rows={3} className={inputCls} />
        </div>
      )}
    </div>
  );
}

/** Etsy'nin "Editing options" penceresinin karşılığı. Değişiklikler yerelde hazırlanır; Etsy'ye "Yayınla" ile gider. */
export default function BulkEditModal({
  shopId,
  count,
  only,
  onCancel,
  onApply,
}: {
  shopId: number;
  count: number;
  /** Verilirse yalnızca bu işlem gösterilir (ör. tek listing'de "Bölümü değiştir"). */
  only?: BulkOp;
  onCancel: () => void;
  onApply: (changes: BulkChanges) => Promise<void>;
}) {
  const [op, setOp] = useState<BulkOp>(only ?? "title");
  const [text, setText] = useState<BulkTextOp>({ mode: "suffix", text: "" });
  const [tagsAdd, setTagsAdd] = useState("");
  const [tagsRemove, setTagsRemove] = useState("");
  const [priceMode, setPriceMode] = useState<"percent" | "amount" | "set">("percent");
  const [priceValue, setPriceValue] = useState("");
  const [rounding, setRounding] = useState<"none" | "x.99" | "x.00">("none");
  const [pick, setPick] = useState("");
  const [renew, setRenew] = useState<"auto" | "manual">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<ShopSection[]>([]);
  const [shipping, setShipping] = useState<ShippingProfile[]>([]);
  const [returns, setReturns] = useState<ReturnPolicy[]>([]);
  const [processing, setProcessing] = useState<ReadinessStateDefinition[]>([]);

  useEffect(() => {
    api.shops.sections(shopId).then(setSections).catch(() => undefined);
    api.shops.shippingProfiles(shopId).then(setShipping).catch(() => undefined);
    api.shops.returnPolicies(shopId).then(setReturns).catch(() => undefined);
    api.shops.readinessStateDefinitions(shopId).then(setProcessing).catch(() => undefined);
  }, [shopId]);

  const splitTags = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

  const changes: BulkChanges | null = useMemo(() => {
    switch (op) {
      case "title":
        return text.mode === "find_replace" ? (text.find ? { title: text } : null) : text.text?.trim() ? { title: text } : null;
      case "description":
        return text.mode === "find_replace" ? (text.find ? { description: text } : null) : text.text?.trim() ? { description: text } : null;
      case "tags": {
        const add = splitTags(tagsAdd);
        const remove = splitTags(tagsRemove);
        return add.length || remove.length ? { tags: { add, remove } } : null;
      }
      case "price": {
        const v = Number(priceValue.replace(",", "."));
        return priceValue.trim() !== "" && Number.isFinite(v) ? { price: { mode: priceMode, value: v, rounding } } : null;
      }
      case "section":
        return pick ? { shop_section_id: Number(pick) } : null;
      case "shipping":
        return pick ? { shipping_profile_id: Number(pick) } : null;
      case "returns":
        return pick ? { return_policy_id: Number(pick) } : null;
      case "processing":
        return pick ? { readiness_state_id: Number(pick) } : null;
      case "renewal":
        return { should_auto_renew: renew === "auto" };
    }
  }, [op, text, tagsAdd, tagsRemove, priceMode, priceValue, rounding, pick, renew]);

  async function submit() {
    if (!changes) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      setBusy(false);
    }
  }

  const select = (options: { id: number; label: string }[]) => (
    <select value={pick} onChange={(e) => setPick(e.target.value)} className={inputCls}>
      <option value="">Seç…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <Modal
      z={95}
      widthClass="max-w-lg"
      title={only ? OPS.find(([k]) => k === only)?.[1] ?? "Düzenle" : "Düzenleme seçenekleri"}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            Vazgeç
          </button>
          <button onClick={submit} disabled={!changes || busy} className={btnPrimary}>
            {busy ? "Hazırlanıyor…" : `${count} listing'e uygula`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {!only && (
          <div>
            <label className={labelCls}>İşlem</label>
            <select
              value={op}
              onChange={(e) => {
                setOp(e.target.value as BulkOp);
                setPick("");
              }}
              className={inputCls}
            >
              {OPS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}

        {op === "title" && <TextForm value={text} onChange={setText} what="Başlığın" />}
        {op === "description" && <TextForm value={text} onChange={setText} what="Açıklamanın" />}
        {op === "tags" && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Eklenecek etiketler (virgülle ayır)</label>
              <input value={tagsAdd} onChange={(e) => setTagsAdd(e.target.value)} placeholder="metal wall art, home decor" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Kaldırılacak etiketler (virgülle ayır)</label>
              <input value={tagsRemove} onChange={(e) => setTagsRemove(e.target.value)} className={inputCls} />
            </div>
            <p className="text-xs text-neutral-500">Etiket başına en fazla 20 karakter, listing başına en fazla 13 etiket.</p>
          </div>
        )}
        {op === "price" && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Ne yapılsın?</label>
              <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as "percent" | "amount" | "set")} className={inputCls}>
                <option value="percent">Yüzde değiştir (artır / azalt)</option>
                <option value="amount">Tutar ekle / çıkar</option>
                <option value="set">Hepsini şu fiyata ayarla</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>{priceMode === "percent" ? "Yüzde (ör. 10 ya da -5)" : priceMode === "amount" ? "Tutar (ör. 5 ya da -2)" : "Fiyat"}</label>
                <input value={priceValue} onChange={(e) => setPriceValue(e.target.value)} inputMode="decimal" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Yuvarlama</label>
                <select value={rounding} onChange={(e) => setRounding(e.target.value as "none" | "x.99" | "x.00")} className={inputCls}>
                  <option value="none">Yok</option>
                  <option value="x.99">.99&apos;a yuvarla</option>
                  <option value="x.00">Tam sayıya yuvarla</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-neutral-500">Tüm varyasyon fiyatlarına aynı dönüşüm uygulanır. En düşük fiyat 0,20.</p>
          </div>
        )}
        {op === "section" && select(sections.map((s) => ({ id: s.shop_section_id, label: s.title })))}
        {op === "shipping" && select(shipping.map((s) => ({ id: s.shipping_profile_id, label: s.title })))}
        {op === "returns" &&
          select(
            returns.map((r) => ({
              id: r.return_policy_id,
              label: `${r.accepts_returns ? "İade" : ""}${r.accepts_returns && r.accepts_exchanges ? " + " : ""}${r.accepts_exchanges ? "Değişim" : ""}${r.return_deadline ? ` · ${r.return_deadline} gün` : ""}` || "İade yok",
            }))
          )}
        {op === "processing" &&
          select(processing.map((p) => ({ id: p.readiness_state_id, label: `${p.readiness_state === "made_to_order" ? "Sipariş üzerine üretim" : "Kargoya hazır"} (${p.processing_days_display_label})` })))}
        {op === "renewal" && (
          <div className="space-y-2">
            {(["auto", "manual"] as const).map((v) => (
              <label key={v} className="flex items-start gap-2 text-sm text-neutral-800 dark:text-neutral-100">
                <input type="radio" checked={renew === v} onChange={() => setRenew(v)} className="mt-1 accent-[#F1641E]" />
                <span>
                  {v === "auto" ? "Otomatik yenile" : "Elle yenile"}
                  <span className="block text-xs text-neutral-500">
                    {v === "auto" ? "Süresi dolunca 4 ay için kendiliğinden yenilenir (yenileme ücreti alınır)." : "Süresi dolunca yenilemeyi sen yaparsın."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <p className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
          Değişiklikler önce <b>yerelde</b> hazırlanır ve listede &quot;Yayınlanmadı&quot; olarak işaretlenir. Etsy&apos;ye, sen
          &quot;Etsy&apos;de yayınla&quot; deyince gider. Beğenmezsen listing&apos;de &quot;Değişiklikleri at&quot; ile geri alabilirsin.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

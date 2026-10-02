"use client";

import { useEffect, useMemo, useState } from "react";
import { api, BulkChanges, BulkTextOp, ReadinessStateDefinition, ReturnPolicy, ShippingProfile, ShopSection } from "@/lib/api";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { useT } from "@/lib/i18n-client";

export type BulkOp = "title" | "description" | "tags" | "price" | "section" | "shipping" | "returns" | "processing" | "renewal";

const OPS: [BulkOp, string, string][] = [
  ["title", "Başlıkları düzenle", "Edit titles"],
  ["tags", "Etiketleri düzenle", "Edit tags"],
  ["description", "Açıklamaları düzenle", "Edit descriptions"],
  ["price", "Fiyatları düzenle", "Edit prices"],
  ["section", "Bölümü değiştir", "Change section"],
  ["shipping", "Kargo profilini değiştir", "Change shipping profile"],
  ["returns", "İade ve değişim politikasını değiştir", "Change return and exchange policy"],
  ["processing", "İşlem profilini değiştir", "Change processing profile"],
  ["renewal", "Yenileme seçeneklerini değiştir", "Change renewal options"],
];

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const labelCls = "mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-200";

function TextForm({ value, onChange, field }: { value: BulkTextOp; onChange: (v: BulkTextOp) => void; field: "title" | "description" }) {
  const { t } = useT();
  const what = field === "title" ? t("Başlığın", "the title") : t("Açıklamanın", "the description");
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>{t("Ne yapılsın?", "What should happen?")}</label>
        <select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as BulkTextOp["mode"] })} className={inputCls}>
          <option value="prefix">{t(`${what} başına ekle`, `Add to the start of ${what}`)}</option>
          <option value="suffix">{t(`${what} sonuna ekle`, `Add to the end of ${what}`)}</option>
          <option value="find_replace">{t("Bul ve değiştir", "Find and replace")}</option>
          <option value="set">{t("Tümünü şununla değiştir", "Replace all with")}</option>
        </select>
      </div>
      {value.mode === "find_replace" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("Bulunacak", "Find")}</label>
            <input value={value.find ?? ""} onChange={(e) => onChange({ ...value, find: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("Yerine", "Replace with")}</label>
            <input value={value.replace ?? ""} onChange={(e) => onChange({ ...value, replace: e.target.value })} className={inputCls} />
          </div>
        </div>
      ) : (
        <div>
          <label className={labelCls}>{t("Metin", "Text")}</label>
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
  const { t } = useT();
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

  const splitTags = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

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
      setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
      setBusy(false);
    }
  }

  const select = (options: { id: number; label: string }[]) => (
    <select value={pick} onChange={(e) => setPick(e.target.value)} className={inputCls}>
      <option value="">{t("Seç…", "Choose…")}</option>
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
      title={(() => {
        const found = only ? OPS.find(([k]) => k === only) : undefined;
        return found ? t(found[1], found[2]) : t("Düzenleme seçenekleri", "Editing options");
      })()}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button onClick={submit} disabled={!changes || busy} className={btnPrimary}>
            {busy ? t("Hazırlanıyor…", "Preparing…") : t(`${count} listing'e uygula`, `Apply to ${count} listings`)}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {!only && (
          <div>
            <label className={labelCls}>{t("İşlem", "Action")}</label>
            <select
              value={op}
              onChange={(e) => {
                setOp(e.target.value as BulkOp);
                setPick("");
              }}
              className={inputCls}
            >
              {OPS.map(([k, tr, en]) => (
                <option key={k} value={k}>
                  {t(tr, en)}
                </option>
              ))}
            </select>
          </div>
        )}

        {op === "title" && <TextForm value={text} onChange={setText} field="title" />}
        {op === "description" && <TextForm value={text} onChange={setText} field="description" />}
        {op === "tags" && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t("Eklenecek etiketler (virgülle ayır)", "Tags to add (comma separated)")}</label>
              <input value={tagsAdd} onChange={(e) => setTagsAdd(e.target.value)} placeholder="metal wall art, home decor" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("Kaldırılacak etiketler (virgülle ayır)", "Tags to remove (comma separated)")}</label>
              <input value={tagsRemove} onChange={(e) => setTagsRemove(e.target.value)} className={inputCls} />
            </div>
            <p className="text-xs text-neutral-500">{t("Etiket başına en fazla 20 karakter, listing başına en fazla 13 etiket.", "Up to 20 characters per tag and 13 tags per listing.")}</p>
          </div>
        )}
        {op === "price" && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t("Ne yapılsın?", "What should happen?")}</label>
              <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as "percent" | "amount" | "set")} className={inputCls}>
                <option value="percent">{t("Yüzde değiştir (artır / azalt)", "Change by percent (up / down)")}</option>
                <option value="amount">{t("Tutar ekle / çıkar", "Add / subtract an amount")}</option>
                <option value="set">{t("Hepsini şu fiyata ayarla", "Set all to this price")}</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>{priceMode === "percent" ? t("Yüzde (ör. 10 ya da -5)", "Percent (e.g. 10 or -5)") : priceMode === "amount" ? t("Tutar (ör. 5 ya da -2)", "Amount (e.g. 5 or -2)") : t("Fiyat", "Price")}</label>
                <input value={priceValue} onChange={(e) => setPriceValue(e.target.value)} inputMode="decimal" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("Yuvarlama", "Rounding")}</label>
                <select value={rounding} onChange={(e) => setRounding(e.target.value as "none" | "x.99" | "x.00")} className={inputCls}>
                  <option value="none">{t("Yok", "None")}</option>
                  <option value="x.99">{t(".99'a yuvarla", "Round to .99")}</option>
                  <option value="x.00">{t("Tam sayıya yuvarla", "Round to whole number")}</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-neutral-500">{t("Tüm varyasyon fiyatlarına aynı dönüşüm uygulanır. En düşük fiyat 0,20.", "The same change is applied to all variation prices. The minimum price is 0.20.")}</p>
          </div>
        )}
        {op === "section" && select(sections.map((s) => ({ id: s.shop_section_id, label: s.title })))}
        {op === "shipping" && select(shipping.map((s) => ({ id: s.shipping_profile_id, label: s.title })))}
        {op === "returns" &&
          select(
            returns.map((r) => ({
              id: r.return_policy_id,
              label:
                `${r.accepts_returns ? t("İade", "Returns") : ""}${r.accepts_returns && r.accepts_exchanges ? " + " : ""}${r.accepts_exchanges ? t("Değişim", "Exchanges") : ""}${r.return_deadline ? ` · ${r.return_deadline} ${t("gün", "days")}` : ""}` ||
                t("İade yok", "No returns"),
            }))
          )}
        {op === "processing" &&
          select(processing.map((p) => ({ id: p.readiness_state_id, label: `${p.readiness_state === "made_to_order" ? t("Sipariş üzerine üretim", "Made to order") : t("Kargoya hazır", "Ready to ship")} (${p.processing_days_display_label})` })))}
        {op === "renewal" && (
          <div className="space-y-2">
            {(["auto", "manual"] as const).map((v) => (
              <label key={v} className="flex items-start gap-2 text-sm text-neutral-800 dark:text-neutral-100">
                <input type="radio" checked={renew === v} onChange={() => setRenew(v)} className="mt-1 accent-[#D97757]" />
                <span>
                  {v === "auto" ? t("Otomatik yenile", "Renew automatically") : t("Elle yenile", "Renew manually")}
                  <span className="block text-xs text-neutral-500">
                    {v === "auto"
                      ? t("Süresi dolunca 4 ay için kendiliğinden yenilenir (yenileme ücreti alınır).", "Renews itself for 4 months when it expires (a renewal fee applies).")
                      : t("Süresi dolunca yenilemeyi sen yaparsın.", "You renew it yourself when it expires.")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <p className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
          {t(
            "Değişiklikler önce yerelde hazırlanır ve listede \"Yayınlanmadı\" olarak işaretlenir. Etsy'ye, sen \"Etsy'de yayınla\" deyince gider. Beğenmezsen listing'de \"Değişiklikleri at\" ile geri alabilirsin.",
            "Changes are prepared locally first and marked \"Unpublished\" in the list. They go to Etsy when you use \"Publish to Etsy\". If you don't like them, use \"Discard changes\" on the listing.",
          )}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

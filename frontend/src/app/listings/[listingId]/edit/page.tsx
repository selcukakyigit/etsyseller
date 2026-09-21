"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, PublishResult, Suggestion } from "@/lib/api";
import { useListingWorkingCopy } from "@/lib/useListingWorkingCopy";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import MediaManager from "@/components/listing-editor/MediaManager";
import CategoryPicker from "@/components/listing-editor/CategoryPicker";
import PropertyFields from "@/components/listing-editor/PropertyFields";
import VariationTable from "@/components/listing-editor/VariationTable";
import ShippingAndReturns from "@/components/listing-editor/ShippingAndReturns";
import HowItsMade from "@/components/listing-editor/HowItsMade";
import ListingSettings from "@/components/listing-editor/ListingSettings";
import PhysicalDetails from "@/components/listing-editor/PhysicalDetails";
import PersonalizationEditor from "@/components/listing-editor/PersonalizationEditor";
import StringListEditor from "@/components/listing-editor/StringListEditor";

export default function ListingEditPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const router = useRouter();
  const params = useParams<{ listingId: string }>();
  const listingId = Number(params.listingId);

  const wc = useListingWorkingCopy(activeShop?.id, listingId);
  const edit = wc.work;
  const [confirm, confirmElement] = useConfirm();
  const [result, setResult] = useState<PublishResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ai, setAi] = useState<{
    suggestion: Suggestion;
    previous: { title: string; tags: string[]; description: string; materials: string[] };
  } | null>(null);

  // Eski backend (taslak route'ları yok) "Not Found" döner; kullanıcıya ne yapacağını söyle.
  const friendly = (msg: string | null) =>
    msg === "Not Found"
      ? "Yerel kayıt servisi bulunamadı — backend'i yeniden başlat (backend klasöründe: uvicorn app.main:app --reload --port 8000)."
      : msg;

  /** AI, formdaki güncel değerleri iyileştirir ve sonucu doğrudan forma yazar; Etsy'ye gitmez. */
  async function handleAi() {
    if (!edit || !activeShop) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const previous = { title: edit.title, tags: edit.tags, description: edit.description, materials: edit.materials };
      const s = await api.listings.suggest(activeShop.id, listingId, previous);
      wc.patch({
        title: s.suggested_title,
        tags: s.suggested_tags,
        description: s.suggested_description,
        ...(s.suggested_materials && s.suggested_materials.length > 0 ? { materials: s.suggested_materials } : {}),
      });
      setAi({ suggestion: s, previous });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI önerisi üretilemedi");
    } finally {
      setAiBusy(false);
    }
  }

  async function handleUndoAi() {
    if (!ai || !activeShop) return;
    wc.patch(ai.previous);
    await api.listings.dismiss(activeShop.id, ai.suggestion.id).catch(() => undefined);
    setAi(null);
  }

  async function handlePublish() {
    const ok = await confirm({
      title: "Etsy'de yayınlansın mı?",
      message:
        "Kaydettiğin tüm değişiklikler Etsy'deki canlı listing'e uygulanacak. Yayındaki listing hemen güncellenir.",
      confirmLabel: "Etsy'de yayınla",
    });
    if (!ok) return;
    setResult(null);
    setResult(await wc.publish());
  }

  async function handleDiscard() {
    const ok = await confirm({
      title: "Değişiklikler atılsın mı?",
      message: "Yerel kayıt ve taslaktaki tüm değişiklikler (yeni fotoğraflar dahil) atılır; listing Etsy'deki hâline döner.",
      confirmLabel: "Değişiklikleri at",
      destructive: true,
    });
    if (!ok) return;
    setResult(null);
    await wc.discard();
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso + "Z").toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "";
  const statusLabel = wc.unsaved
    ? "Kaydedilmemiş değişiklikler var" + (wc.draftCurrent ? ` · taslak ${fmt(wc.draftAt)}` : "")
    : wc.hasLocal
      ? `Kaydedildi (yerel) · ${fmt(wc.localAt)} · Etsy'ye yayınlanmadı`
      : "Etsy ile aynı — değişiklik yok";

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition mb-4"
        >
          ← Listing&apos;lere dön
        </button>

        {(bootError || wc.error) && <p className="text-sm text-red-600 mb-4">{friendly(bootError ?? wc.error)}</p>}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center">
            <p className="text-neutral-600 dark:text-neutral-300 mb-4">
              Listing düzenlemek için önce Etsy mağazanı bağlaman gerekiyor.
            </p>
            <a
              href={api.shops.connectUrl()}
              className="inline-block text-sm font-medium px-4 py-2 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition"
            >
              Etsy&apos;ye Bağlan
            </a>
          </div>
        )}

        {activeShop && !edit && !wc.error && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Yükleniyor…</p>
        )}

        {edit && activeShop && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Listing&apos;i Düzenle</h1>
              <button
                onClick={handleAi}
                disabled={aiBusy}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {aiBusy ? "Üretiliyor…" : "✨ AI Önerisi Üret"}
              </button>
            </div>

            {aiError && <p className="text-sm text-red-600">{aiError}</p>}
            {ai && (
              <div className="rounded-xl border border-[#F1641E]/40 bg-[#F1641E]/5 p-4 text-sm">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    AI önerisi forma uygulandı (başlık, etiketler, açıklama{ai.suggestion.suggested_materials?.length ? ", malzemeler" : ""})
                  </p>
                  <button onClick={handleUndoAi} className="text-xs font-medium text-neutral-600 hover:underline dark:text-neutral-300">
                    Geri al
                  </button>
                </div>
                {ai.suggestion.rationale && <p className="text-neutral-600 dark:text-neutral-300">{ai.suggestion.rationale}</p>}
                <p className="mt-1 text-xs text-neutral-400">Değişiklikler taslakta; beğenmezsen geri al ya da yayınlamadan düzenle.</p>
              </div>
            )}

            <MediaManager
              shopId={activeShop.id}
              listingId={listingId}
              images={edit.images}
              videos={edit.videos}
              onImagesChange={(images) => wc.patch({ images })}
              onVideosChange={(videos) => wc.patch({ videos })}
              onImageReplaced={wc.remapImageRefs}
            />

            <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Ürün Detayları</h2>

              <CategoryPicker shopId={activeShop?.id} taxonomyId={edit.taxonomy_id} onChange={(id) => wc.patch({ taxonomy_id: id })} />

              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  Başlık
                </label>
                <input
                  value={edit.title}
                  maxLength={140}
                  onChange={(e) => wc.patch({ title: e.target.value })}
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  Açıklama
                </label>
                <textarea
                  value={edit.description}
                  onChange={(e) => wc.patch({ description: e.target.value })}
                  rows={6}
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
                />
              </div>

              <StringListEditor label="Etiketler" values={edit.tags} maxItems={13} onChange={(tags) => wc.patch({ tags })} />
              <StringListEditor label="Materyaller" values={edit.materials} onChange={(materials) => wc.patch({ materials })} />
            </section>

            <PropertyFields
              key={`props-${wc.version}`}
              taxonomyId={edit.taxonomy_id}
              properties={edit.properties}
              onChange={wc.setProperty}
            />

            <VariationTable
              key={`variations-${wc.version}`}
              shopId={activeShop.id}
              inventory={edit.inventory}
              links={edit.variation_links}
              taxonomyId={edit.taxonomy_id}
              images={edit.images}
              onChange={(inventory, variation_links) => wc.patch({ inventory, variation_links })}
            />

            <ShippingAndReturns
              shopId={activeShop.id}
              shippingProfileId={edit.shipping_profile_id}
              returnPolicyId={edit.return_policy_id}
              onChange={(p) => wc.patch(p)}
            />

            <HowItsMade
              whoMade={edit.who_made}
              whenMade={edit.when_made}
              isSupply={edit.is_supply}
              onChange={(p) => wc.patch(p)}
            />

            <PhysicalDetails
              itemWeight={edit.item_weight}
              itemLength={edit.item_length}
              itemWidth={edit.item_width}
              itemHeight={edit.item_height}
              itemWeightUnit={edit.item_weight_unit}
              itemDimensionsUnit={edit.item_dimensions_unit}
              isTaxable={edit.is_taxable}
              ecgtGaranBrand={edit.ecgt_garan_brand}
              ecgtGaranYears={edit.ecgt_garan_years}
              ecgtGaranModel={edit.ecgt_garan_model}
              ecgtGaranGuaranteeDetails={edit.ecgt_garan_guarantee_details}
              ecgtOtherCommercialGuaranteeDetails={edit.ecgt_other_commercial_guarantee_details}
              ecgtAfterSalesServiceInfo={edit.ecgt_after_sales_service_info}
              onChange={(p) => wc.patch(p)}
            />

            <ListingSettings
              shopId={activeShop.id}
              shopSectionId={edit.shop_section_id}
              featuredRank={edit.featured_rank}
              shouldAutoRenew={edit.should_auto_renew}
              productionPartnerIds={edit.production_partner_ids}
              onChange={(p) => wc.patch(p)}
            />

            <PersonalizationEditor
              key={`pers-${wc.version}`}
              value={edit.personalization}
              onChange={(personalization) => wc.patch({ personalization })}
            />

            {result && !result.ok && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
                <p className="mb-2 font-semibold text-red-700 dark:text-red-300">Yayın tamamlanamadı</p>
                <ul className="space-y-1">
                  {result.steps.map((st) => (
                    <li key={st.name} className={st.ok ? "text-neutral-600 dark:text-neutral-300" : "text-red-700 dark:text-red-300"}>
                      {st.ok ? "✓" : "✗"} {st.name}
                      {st.error ? ` — ${st.error}` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-neutral-500">
                  Yerel kaydın korunuyor; sorunu düzeltip tekrar yayınlayınca kalan farklar tamamlanır.
                </p>
              </div>
            )}
            {result?.ok && (
              <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                Etsy&apos;de yayınlandı ✓
              </p>
            )}

            <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              <span className="flex-1 text-sm text-neutral-600 dark:text-neutral-300">{statusLabel}</span>
              {(wc.unsaved || wc.hasLocal || wc.hasDraft) && (
                <button
                  onClick={handleDiscard}
                  disabled={wc.publishing}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:underline disabled:opacity-50 dark:text-neutral-200"
                >
                  Değişiklikleri at
                </button>
              )}
              <button
                onClick={wc.saveDraft}
                disabled={!wc.unsaved || wc.draftCurrent || wc.publishing || wc.saveState === "saving"}
                title="Ara kayıt alır; liste sayfası değişmez, editörü tekrar açınca kaldığın yerden devam edersin"
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                {wc.draftCurrent ? "Taslak kaydedildi ✓" : "Taslak kaydet"}
              </button>
              <button
                onClick={wc.saveLocal}
                disabled={!wc.unsaved || wc.publishing || wc.saveState === "saving"}
                title="Değişiklikleri yerel listing'e kaydeder; liste sayfası güncellenir, Etsy'ye gönderilmez"
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                {wc.saveState === "saving" ? "Kaydediliyor…" : "Kaydet"}
              </button>
              <button
                onClick={handlePublish}
                disabled={(!wc.unsaved && !wc.hasLocal) || wc.publishing || wc.saveState === "saving"}
                className="rounded-lg bg-[#F1641E] px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-[#d9560f] disabled:opacity-50"
              >
                {wc.publishing ? "Yayınlanıyor…" : "Etsy'de yayınla"}
              </button>
            </div>
          </div>
        )}
      </div>
      {confirmElement}
    </AppShell>
  );
}

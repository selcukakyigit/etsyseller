"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, Suggestion } from "@/lib/api";
import { useListingWorkingCopy } from "@/lib/useListingWorkingCopy";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { dismissPublishJob, startPublish, usePublishJobs } from "@/lib/publishJobs";
import ProgressBar from "@/components/ui/ProgressBar";
import SectionNav, { EDIT_SECTIONS } from "@/components/listing-editor/SectionNav";
import SectionCard from "@/components/listing-editor/SectionCard";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import MediaManager from "@/components/listing-editor/MediaManager";
import CategoryPicker from "@/components/listing-editor/CategoryPicker";
import PropertyFields from "@/components/listing-editor/PropertyFields";
import VariationTable from "@/components/listing-editor/VariationTable";
import ListingStatusBar from "@/components/listing-editor/ListingStatusBar";
import ShippingAndReturns from "@/components/listing-editor/ShippingAndReturns";
import HowItsMade from "@/components/listing-editor/HowItsMade";
import ListingSettings from "@/components/listing-editor/ListingSettings";
import PhysicalDetails from "@/components/listing-editor/PhysicalDetails";
import PersonalizationEditor from "@/components/listing-editor/PersonalizationEditor";
import StringListEditor from "@/components/listing-editor/StringListEditor";
import TagsEditor from "@/components/listing-editor/TagsEditor";

export default function ListingEditPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const router = useRouter();
  const params = useParams<{ listingId: string }>();
  const listingId = Number(params.listingId);

  const wc = useListingWorkingCopy(activeShop?.id, listingId);
  const edit = wc.work;
  const isNew = listingId < 0;
  const [confirm, confirmElement] = useConfirm();
  // Yayın arka planda sürer (bkz. lib/publishJobs); önceki bir yayının hata/çakışma sonucu burada gösterilir.
  const job = usePublishJobs().get(listingId);
  const conflict = job?.phase === "error" ? job.conflicts : undefined;
  const publishError = job?.phase === "error" && !job.conflicts ? job.error : undefined;
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => !closed[id];
  const toggle = (id: string) => setClosed((c) => ({ ...c, [id]: !c[id] }));
  const allOpen = EDIT_SECTIONS.every(([id]) => isOpen(id));
  const toggleAll = () => setClosed(allOpen ? Object.fromEntries(EDIT_SECTIONS.map(([id]) => [id, true])) : {});
  function goTo(id: string) {
    setClosed((c) => ({ ...c, [id]: false }));
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
  const [invKey, setInvKey] = useState(0); // işlem profili kartı envanteri değiştirince varyasyon tablosunu yeniden kurar
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ai, setAi] = useState<{
    suggestion: Suggestion;
    previous: { title: string; tags: string[]; description: string; materials: string[] };
  } | null>(null);

  // Eski backend (taslak route'ları yok) "Not Found" döner; kullanıcıya ne yapacağını söyle.
  const friendly = (msg: string | null) =>
    msg === "Failed to fetch"
      ? "Sunucuya ulaşılamıyor (yeniden başlıyor olabilir). Birkaç saniye sonra tekrar dene."
      : msg === "Not Found"
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
    const activating = isNew && edit?.state === "active";
    const ok = await confirm({
      title: isNew ? "Etsy'de listing oluşturulsun mu?" : "Etsy'de yayınlansın mı?",
      message: isNew
        ? activating
          ? "Listing Etsy'de oluşturulup aktif edilecek; Etsy listing ücreti (0,20 $) alır."
          : "Listing Etsy'de taslak olarak oluşturulacak (ücretsiz). Aktif etmeyi sonra sen yaparsın."
        : "Kaydettiğin tüm değişiklikler Etsy'deki canlı listing'e uygulanacak. Yayındaki listing hemen güncellenir.",
      confirmLabel: isNew ? "Oluştur" : "Etsy'de yayınla",
    });
    if (!ok || !activeShop) return;
    if (wc.unsaved && !(await wc.saveLocal())) return;
    startPublish(activeShop.id, listingId);
    router.push("/listings"); // yayın arkada sürer; listede kartın üzerinde doluluk çubuğu görünür
  }

  async function forcePublish() {
    const ok = await confirm({
      title: "Etsy'deki değişiklikler ezilsin mi?",
      message: `Şu alanlarda Etsy'deki değerin yerine senin değerin yazılacak: ${conflict?.map((c) => c.label).join(", ")}. Bu geri alınamaz.`,
      confirmLabel: "Benimkiyle ez",
      destructive: true,
    });
    if (!ok || !activeShop) return;
    startPublish(activeShop.id, listingId, true);
    router.push("/listings");
  }

  async function handleDiscard() {
    const ok = await confirm({
      title: isNew ? "Yeni listing silinsin mi?" : "Değişiklikler atılsın mı?",
      message: isNew
        ? "Bu listing henüz Etsy'de yok; yerel kopya ve yüklenen fotoğraflar silinir."
        : "Yerel kayıt ve taslaktaki tüm değişiklikler (yeni fotoğraflar dahil) atılır; listing Etsy'deki hâline döner.",
      confirmLabel: isNew ? "Sil" : "Değişiklikleri at",
      destructive: true,
    });
    if (!ok) return;
    dismissPublishJob(listingId);
    await wc.discard();
    if (isNew) router.push("/listings");
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso + "Z").toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "";
  const statusLabel = wc.unsaved
    ? "Kaydedilmemiş değişiklikler var" + (wc.draftCurrent ? ` · taslak ${fmt(wc.draftAt)}` : "")
    : wc.hasLocal
      ? `Kaydedildi (yerel) · ${fmt(wc.localAt)} · Etsy'ye yayınlanmadı`
      : "Etsy ile aynı — değişiklik yok";

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/listings">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <button
          onClick={() => router.push("/listings")}
          className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition mb-4"
        >
          ← Listing&apos;lere dön
        </button>

        {(bootError || wc.error) && (
          <p className="mb-4 text-sm text-red-600">
            {friendly(bootError ?? wc.error)}{" "}
            <button type="button" onClick={() => wc.reload()} className="font-medium underline">
              Yeniden dene
            </button>
          </p>
        )}

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
          <div className="min-h-[20px]">
            <p className="text-sm text-neutral-400 dark:text-neutral-500">Yükleniyor…</p>
          </div>
        )}

        {edit && activeShop && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{isNew ? "Yeni listing" : "Listing'i Düzenle"}</h1>
              <button
                onClick={handleAi}
                disabled={aiBusy}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {aiBusy ? "Üretiliyor…" : "✨ AI Önerisi Üret"}
              </button>
            </div>

            <ProgressBar
              busy={aiBusy}
              stages={[
                [0, "Listing ve mevcut değerler analiz ediliyor…"],
                [20, "Anahtar kelime havuzu ve rakip verileri değerlendiriliyor…"],
                [50, "Başlık, etiketler ve açıklama yazılıyor…"],
                [80, "Sonuçlar hazırlanıyor…"],
              ]}
            />
            <ListingStatusBar
              state={edit.state}
              liveState={wc.live?.state}
              listingType={edit.listing_type}
              url={edit.url}
              listedAt={edit.original_creation_timestamp}
              endsAt={edit.ending_timestamp}
              isNew={isNew}
              onStateChange={(state) => wc.patch({ state })}
            />

            <SectionNav onNavigate={goTo} allOpen={allOpen} onToggleAll={toggleAll} />

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
                {ai.suggestion.warnings && ai.suggestion.warnings.length > 0 && (
                  <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <b>Dikkat:</b> öneri, mağazanın diğer listing&apos;lerine ya da kalite kurallarına şu noktalarda hâlâ takılıyor; yayınlamadan önce düzenle:
                    <ul className="mt-1 list-disc pl-4">
                      {ai.suggestion.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-1 text-xs text-neutral-400">Değişiklikler taslakta; beğenmezsen geri al ya da yayınlamadan düzenle.</p>
              </div>
            )}

            <SectionCard
              id="sec-media"
              hideInnerTitle
              title="Fotoğraf & Video"
              accent="orange"
              summary={`${edit.images.length} fotoğraf · ${edit.videos.length} video`}
              warning={edit.images.length === 0 ? "Fotoğraf yok" : null}
              open={isOpen("sec-media")}
              onToggle={() => toggle("sec-media")}
            >
            <MediaManager
              shopId={activeShop.id}
              listingId={listingId}
              images={edit.images}
              videos={edit.videos}
              onImagesChange={(images) => wc.patch({ images })}
              onVideosChange={(videos) => wc.patch({ videos })}
              onImageReplaced={wc.remapImageRefs}
              title={edit.title}
            />
            </SectionCard>

            <SectionCard
              id="sec-details"
              title="Ürün Detayları"
              accent="sky"
              summary={`Başlık ${edit.title.length}/140 · Açıklama ${edit.description.length} karakter`}
              warning={edit.title.trim() ? null : "Başlık boş"}
              open={isOpen("sec-details")}
              onToggle={() => toggle("sec-details")}
            >
            <div className="space-y-5">

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

            </div>
            </SectionCard>

            <SectionCard
              id="sec-options"
              title="Varyasyon, Fiyat & Kişiselleştirme"
              accent="violet"
              summary={`${edit.inventory.products.length} varyant · ${edit.personalization?.questions.length ?? 0} özel alan`}
              warning={null}
              open={isOpen("sec-options")}
              onToggle={() => toggle("sec-options")}
            >
            <VariationTable
              key={`variations-${wc.version}-${invKey}`}
              shopId={activeShop.id}
              inventory={edit.inventory}
              links={edit.variation_links}
              taxonomyId={edit.taxonomy_id}
              images={edit.images}
              onChange={(inventory, variation_links) => wc.patch({ inventory, variation_links })}
            />

            <PersonalizationEditor
              shopId={activeShop.id}
              key={`pers-${wc.version}`}
              value={edit.personalization}
              onChange={(personalization) => wc.patch({ personalization })}
            />
            </SectionCard>

            <SectionCard
              id="sec-attributes"
              title="Etiketler & Özellikler"
              accent="emerald"
              summary={`${edit.tags.length}/13 etiket · ${edit.materials.length} materyal · ${edit.properties.length} özellik`}
              warning={edit.tags.length < 13 ? `${13 - edit.tags.length} etiket boş` : null}
              open={isOpen("sec-attributes")}
              onToggle={() => toggle("sec-attributes")}
            >
            <div className="space-y-5">
              <TagsEditor shopId={activeShop.id} listingId={listingId} tags={edit.tags} onChange={(tags) => wc.patch({ tags })} />
              <StringListEditor label="Materyaller" values={edit.materials} onChange={(materials) => wc.patch({ materials })} />
              <StringListEditor label="Stil" values={edit.style} maxItems={2} onChange={(style) => wc.patch({ style })} />
            </div>

            <PropertyFields
              key={`props-${wc.version}`}
              taxonomyId={edit.taxonomy_id}
              properties={edit.properties}
              onChange={wc.setProperty}
            />
            </SectionCard>

            <SectionCard
              id="sec-shipping"
              title="Kargo, İşlem Süresi & İade"
              accent="teal"
              summary="Kargo profili, işlem süresi, iade politikası, ağırlık ve boyutlar"
              warning={null}
              open={isOpen("sec-shipping")}
              onToggle={() => toggle("sec-shipping")}
            >
            <ShippingAndReturns
              shopId={activeShop.id}
              shippingProfileId={edit.shipping_profile_id}
              returnPolicyId={edit.return_policy_id}
              inventory={edit.inventory}
              onChange={(p) => {
                wc.patch(p);
                if (p.inventory) setInvKey((k) => k + 1);
              }}
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
            </SectionCard>

            <SectionCard
              id="sec-made"
              hideInnerTitle
              title="Nasıl Yapıldı"
              accent="amber"
              summary={{ i_did: "Ben yaptım", collective: "Ortak üretim", someone_else: "Başka biri yaptı" }[edit.who_made ?? ""] ?? "—" + ` · ${edit.when_made ?? "—"}`}
              warning={null}
              open={isOpen("sec-made")}
              onToggle={() => toggle("sec-made")}
            >
            <HowItsMade
              whoMade={edit.who_made}
              whenMade={edit.when_made}
              isSupply={edit.is_supply}
              onChange={(p) => wc.patch(p)}
            />
            </SectionCard>

            <SectionCard
              id="sec-settings"
              hideInnerTitle
              title="Ayarlar"
              accent="slate"
              summary={`Otomatik yenileme ${edit.should_auto_renew ? "açık" : "kapalı"}${edit.featured_rank && edit.featured_rank > 0 ? " · Öne çıkan" : ""}`}
              warning={null}
              open={isOpen("sec-settings")}
              onToggle={() => toggle("sec-settings")}
            >
            <ListingSettings
              shopId={activeShop.id}
              shopSectionId={edit.shop_section_id}
              featuredRank={edit.featured_rank}
              shouldAutoRenew={edit.should_auto_renew}
              productionPartnerIds={edit.production_partner_ids}
              onChange={(p) => wc.patch(p)}
            />
            </SectionCard>

            {conflict && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                <p className="mb-1 font-semibold text-amber-900 dark:text-amber-200">Etsy&apos;de bu listing değişmiş</p>
                <p className="text-amber-900 dark:text-amber-200">
                  Sen kaydettikten sonra şu alanlar Etsy&apos;de de farklı değiştirilmiş: <b>{conflict.map((c) => c.label).join(", ")}</b>.
                  Hiçbir şey yazılmadı.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={handleDiscard}
                    className="rounded-full border border-amber-400 px-4 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  >
                    Etsy&apos;deki hâli al (değişikliklerimi at)
                  </button>
                  <button onClick={forcePublish} className="rounded-full bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
                    Benimkiyle ez
                  </button>
                  <button onClick={() => dismissPublishJob(listingId)} className="px-3 py-1.5 text-sm text-amber-900 hover:underline dark:text-amber-200">
                    Kapat
                  </button>
                </div>
              </div>
            )}
            {publishError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
                <p className="mb-1 font-semibold text-red-700 dark:text-red-300">Yayın tamamlanamadı</p>
                <p className="text-red-700 dark:text-red-300">{publishError}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  Yerel kaydın korunuyor; sorunu düzeltip tekrar yayınlayınca kalan farklar tamamlanır.
                </p>
                <button onClick={() => dismissPublishJob(listingId)} className="mt-2 text-xs text-neutral-500 hover:underline">
                  Kapat
                </button>
              </div>
            )}

            <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              <span className="flex-1 text-sm text-neutral-600 dark:text-neutral-300">{statusLabel}</span>
              {(wc.unsaved || wc.hasLocal || wc.hasDraft) && (
                <button
                  onClick={handleDiscard}
                  disabled={wc.publishing}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:underline disabled:opacity-50 dark:text-neutral-200"
                >
                  {isNew ? "Listing'i sil" : "Değişiklikleri at"}
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

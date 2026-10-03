"use client";

import DescriptionTemplatePicker from "@/components/listing-editor/DescriptionTemplatePicker";
import DiagnosisStrip from "@/components/listings/analysis/DiagnosisStrip";
import { FOCUS_KEYS, FocusKey, focusLabel } from "@/components/listings/analysis/NextStepCard";
import { useEffect, useState } from "react";
import Link from "next/link";
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
import { useT } from "@/lib/i18n-client";
import { PageSpinner } from "@/components/ui/Spinner";
import { ABOVE_BOTTOM_NAV } from "@/components/layout/constants";

// Alan sırasından bağımsız karşılaştırma (taslaktan gelen nesnede anahtar sırası değişebilir)
const stableJson = (v: unknown) =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1))) : val,
  );

export default function ListingEditPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t, locale } = useT();
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
  // Odak modu (?focus=photo|price|title_tags|description|text): yalnızca sıradaki adımın alanı görünür, bir turda tek şey değişir.
  const [focus, setFocus] = useState<FocusKey | null>(null);
  const isOpen = (id: string) => !!focus || !closed[id];
  const toggle = (id: string) => setClosed((c) => ({ ...c, [id]: !c[id] }));
  const allOpen = EDIT_SECTIONS.every(([id]) => isOpen(id));
  const toggleAll = () => setClosed(allOpen ? Object.fromEntries(EDIT_SECTIONS.map(([id]) => [id, true])) : {});
  function goTo(id: string) {
    setClosed((c) => ({ ...c, [id]: false }));
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
  // Teşhisteki "Sıradaki adım" düğmesi düzenleyiciyi odak modunda açar (?focus=…).
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("focus");
    if (f && (FOCUS_KEYS as string[]).includes(f)) setTimeout(() => setFocus(f as FocusKey), 0);
  }, []);
  function enterFocus(f: FocusKey | null) {
    setFocus(f);
    const url = new URL(window.location.href);
    if (f) url.searchParams.set("focus", f);
    else url.searchParams.delete("focus");
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  // Odak modunda AI yalnızca o adımın alanlarını forma yazar (açıklama adımında başlığa dokunmaz…)
  const aiFields: ("title" | "tags" | "description" | "materials")[] =
    focus === "title_tags" ? ["title", "tags"] : focus === "description" ? ["description"] : focus === "text" ? ["title", "tags", "description"] : ["title", "tags", "description", "materials"];
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
      ? t("Sunucuya ulaşılamıyor (yeniden başlıyor olabilir). Birkaç saniye sonra tekrar dene.", "Can't reach the server (it may be restarting). Try again in a few seconds.")
      : msg === "Not Found"
      ? t("Listing bulunamadı.", "Listing not found.")
      : msg;

  /** AI, formdaki güncel değerleri iyileştirir ve sonucu doğrudan forma yazar; Etsy'ye gitmez. */
  async function handleAi() {
    if (!edit || !activeShop) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const previous = { title: edit.title, tags: edit.tags, description: edit.description, materials: edit.materials };
      const s = await api.listings.suggest(activeShop.id, listingId, { ...previous, inventory: edit.inventory });
      wc.patch({
        ...(aiFields.includes("title") ? { title: s.suggested_title } : {}),
        ...(aiFields.includes("tags") ? { tags: s.suggested_tags } : {}),
        ...(aiFields.includes("description") ? { description: s.suggested_description } : {}),
        ...(aiFields.includes("materials") && s.suggested_materials && s.suggested_materials.length > 0 ? { materials: s.suggested_materials } : {}),
      });
      setAi({ suggestion: s, previous });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : t("AI önerisi üretilemedi", "Could not generate an AI suggestion"));
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
      title: isNew ? t("Etsy'de listing oluşturulsun mu?", "Create the listing on Etsy?") : t("Etsy'de yayınlansın mı?", "Publish to Etsy?"),
      message: isNew
        ? activating
          ? t("Listing Etsy'de oluşturulup aktif edilecek; Etsy listing ücreti (0,20 $) alır.", "The listing will be created on Etsy and made active; Etsy charges the listing fee ($0.20).")
          : t("Listing Etsy'de taslak olarak oluşturulacak (ücretsiz). Aktif etmeyi sonra sen yaparsın.", "The listing will be created on Etsy as a draft (free). You can activate it later.")
        : t(
            "Kaydettiğin tüm değişiklikler Etsy'deki canlı listing'e uygulanacak. Yayındaki listing hemen güncellenir.",
            "All your saved changes will be applied to the live listing on Etsy. The live listing updates immediately.",
          ),
      confirmLabel: isNew ? t("Oluştur", "Create") : t("Etsy'de yayınla", "Publish to Etsy"),
    });
    if (!ok || !activeShop) return;
    if (wc.unsaved && !(await wc.saveLocal())) return;
    startPublish(activeShop.id, listingId);
    router.push("/listings"); // yayın arkada sürer; listede kartın üzerinde doluluk çubuğu görünür
  }

  async function forcePublish() {
    const ok = await confirm({
      title: t("Etsy'deki değişiklikler ezilsin mi?", "Overwrite the changes on Etsy?"),
      message: t(
        `Şu alanlarda Etsy'deki değerin yerine senin değerin yazılacak: ${conflict?.map((c) => c.label).join(", ")}. Bu geri alınamaz.`,
        `Your values will replace Etsy's in these fields: ${conflict?.map((c) => c.label).join(", ")}. This cannot be undone.`,
      ),
      confirmLabel: t("Benimkiyle ez", "Overwrite with mine"),
      destructive: true,
    });
    if (!ok || !activeShop) return;
    startPublish(activeShop.id, listingId, true);
    router.push("/listings");
  }

  async function handleDiscard() {
    const ok = await confirm({
      title: isNew ? t("Yeni listing silinsin mi?", "Delete the new listing?") : t("Değişiklikler atılsın mı?", "Discard changes?"),
      message: isNew
        ? t("Bu listing henüz Etsy'de yok; yerel kopya ve yüklenen fotoğraflar silinir.", "This listing is not on Etsy yet; the local copy and uploaded photos are deleted.")
        : t(
            "Yerel kayıt ve taslaktaki tüm değişiklikler (yeni fotoğraflar dahil) atılır; listing Etsy'deki hâline döner.",
            "All local and draft changes (including new photos) are discarded; the listing goes back to how it is on Etsy.",
          ),
      confirmLabel: isNew ? t("Sil", "Delete") : t("Değişiklikleri at", "Discard changes"),
      destructive: true,
    });
    if (!ok) return;
    dismissPublishJob(listingId);
    await wc.discard();
    if (isNew) router.push("/listings");
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso + "Z").toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "";
  const statusLabel = wc.unsaved
    ? t("Kaydedilmemiş değişiklikler var", "Unsaved changes") + (wc.draftCurrent ? ` · ${t("taslak", "draft")} ${fmt(wc.draftAt)}` : "")
    : wc.hasLocal
      ? t(`Kaydedildi (yerel) · ${fmt(wc.localAt)} · Etsy'ye yayınlanmadı`, `Saved (local) · ${fmt(wc.localAt)} · not published to Etsy`)
      : t("Etsy ile aynı — değişiklik yok", "Same as Etsy — no changes");

  // Odak dışında kalan, Etsy'den farklı (yayınlanınca gidecek) alanlar: aynı yayında iki şey değişirse ölçüm karışır.
  const outsideFocus = (() => {
    const live = wc.live;
    if (!focus || !edit || !live) return [] as string[];
    const inFocus: Record<FocusKey, string[]> = {
      photo: ["images"],
      price: ["inventory"],
      title_tags: ["title", "tags"],
      description: ["description"],
      text: ["title", "tags", "description"],
    };
    const areas: [string, unknown, unknown, string][] = [
      ["title", edit.title, live.title, t("başlık", "title")],
      ["tags", edit.tags, live.tags, t("etiketler", "tags")],
      ["description", edit.description, live.description, t("açıklama", "description")],
      ["images", edit.images.map((i) => i.listing_image_id), live.images.map((i) => i.listing_image_id), t("fotoğraflar", "photos")],
      ["inventory", edit.inventory, live.inventory, t("fiyat/varyasyonlar", "price/variations")],
    ];
    return areas
      .filter(([key, a, b]) => !inFocus[focus].includes(key) && stableJson(a) !== stableJson(b))
      .map(([, , , label]) => label);
  })();

  const titleField = () =>
    edit && (
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Başlık", "Title")}</label>
        <input
          value={edit.title}
          maxLength={140}
          onChange={(e) => wc.patch({ title: e.target.value })}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </div>
    );
  const descriptionField = () =>
    edit &&
    activeShop && (
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Açıklama", "Description")}</label>
          <DescriptionTemplatePicker
            shopId={activeShop.id}
            listing={{ description: edit.description, title: edit.title, materials: edit.materials ?? [], inventory: edit.inventory }}
            onApply={(description) => wc.patch({ description })}
          />
        </div>
        <textarea
          value={edit.description}
          onChange={(e) => wc.patch({ description: e.target.value })}
          rows={focus ? 12 : 6}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </div>
    );

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/listings">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <button
          onClick={() => router.push("/listings")}
          className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition mb-4"
        >
          ← {t("Listing'lere dön", "Back to listings")}
        </button>

        {(bootError || wc.error) && (
          <p className="mb-4 text-sm text-red-600">
            {friendly(bootError ?? wc.error)}{" "}
            <button type="button" onClick={() => wc.reload()} className="font-medium underline">
              {t("Yeniden dene", "Try again")}
            </button>
          </p>
        )}

        {user && shops !== null && !activeShop && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center">
            <p className="text-neutral-600 dark:text-neutral-300 mb-4">
              {t("Listing düzenlemek için önce Etsy mağazanı bağlaman gerekiyor.", "Connect your Etsy shop to edit listings.")}
            </p>
            <a
              href={api.shops.connectUrl()}
              className="inline-block text-sm font-medium px-4 py-2 rounded-lg bg-[#D97757] text-white hover:bg-[#C6613F] transition"
            >
              {t("Etsy'ye Bağlan", "Connect Etsy")}
            </a>
          </div>
        )}

        {activeShop && !edit && !wc.error && (
          <div className="min-h-[20px]">
            <PageSpinner />
          </div>
        )}

        {edit && activeShop && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {focus ? (
                <div>
                  <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                    {t("Odak modu", "Focus mode")}: {focusLabel(t, focus)}
                  </h1>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    <span className="mr-1 truncate">{edit.title.slice(0, 80)}</span> ·{" "}
                    <button type="button" onClick={() => enterFocus(null)} className="font-medium text-[#B4553A] hover:underline dark:text-[#E89A7F]">
                      {t("Tüm formu göster", "Show the full form")}
                    </button>
                  </p>
                </div>
              ) : (
                <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{isNew ? t("Yeni listing", "New listing") : t("Listing'i Düzenle", "Edit listing")}</h1>
              )}
              {(!focus || focus === "title_tags" || focus === "description" || focus === "text") && (
              <button
                onClick={handleAi}
                disabled={aiBusy}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {aiBusy ? t("Üretiliyor…", "Generating…") : t("✨ AI Önerisi Üret", "✨ Generate AI suggestion")}
              </button>
              )}
            </div>

            {listingId > 0 &&
              (focus ? (
                <DiagnosisStrip shopId={activeShop.id} listingId={listingId} onAi={handleAi} full />
              ) : (
                <DiagnosisStrip shopId={activeShop.id} listingId={listingId} onFocus={enterFocus} onAi={handleAi} />
              ))}
            {focus && outsideFocus.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {t(
                  `Bu ekranda görünmeyen alanlarda da Etsy'den farklı, yayınlanmamış değişiklik var: ${outsideFocus.join(", ")}. Yayınlarsan onlar da gider ve hangi değişikliğin işe yaradığı ayrıştırılamaz. İstemiyorsan "Tüm formu göster" ile bakıp geri al.`,
                  `Fields not shown here also have unpublished changes that differ from Etsy: ${outsideFocus.join(", ")}. Publishing sends them too, and it will not be possible to tell which change worked. If you do not want that, use "Show the full form" to review and undo them.`,
                )}
              </p>
            )}
            {focus && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t(
                  "Bu turda yalnızca bu alanı değiştir: 30 gün sonra neyin işe yaradığı ancak böyle anlaşılır. Kaydedip Etsy'de yayınladığında değişiklik kaydedilir ve ölçüm başlar.",
                  "Change only this area this round: that is the only way to tell what worked 30 days later. Once you save and publish to Etsy, the change is recorded and measuring starts.",
                )}
              </p>
            )}

            <ProgressBar
              busy={aiBusy}
              stages={[
                [0, t("Listing ve mevcut değerler analiz ediliyor…", "Analyzing the listing and current values…")],
                [20, t("Anahtar kelime havuzu ve rakip verileri değerlendiriliyor…", "Reviewing the keyword pool and competitor data…")],
                [50, t("Başlık, etiketler ve açıklama yazılıyor…", "Writing the title, tags and description…")],
                [80, t("Sonuçlar hazırlanıyor…", "Preparing results…")],
              ]}
            />
            {!focus && (
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
            )}

            {!focus && <SectionNav onNavigate={goTo} allOpen={allOpen} onToggleAll={toggleAll} />}

            {aiError && <p className="text-sm text-red-600">{aiError}</p>}
            {ai && (
              <div className="rounded-xl border border-[#D97757]/40 bg-[#D97757]/5 p-4 text-sm">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {t("AI önerisi forma uygulandı", "AI suggestion applied to the form")} (
                    {aiFields
                      .filter((f) => f !== "materials" || ai.suggestion.suggested_materials?.length)
                      .map((f) => ({ title: t("başlık", "title"), tags: t("etiketler", "tags"), description: t("açıklama", "description"), materials: t("malzemeler", "materials") })[f])
                      .join(", ")}
                    )
                  </p>
                  <button onClick={handleUndoAi} className="text-xs font-medium text-neutral-600 hover:underline dark:text-neutral-300">
                    {t("Geri al", "Undo")}
                  </button>
                </div>
                {ai.suggestion.rationale && <p className="text-neutral-600 dark:text-neutral-300">{ai.suggestion.rationale}</p>}
                {ai.suggestion.warnings && ai.suggestion.warnings.length > 0 && (
                  <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <b>{t("Dikkat:", "Note:")}</b>{" "}
                    {t(
                      "yapay zekâ 3 denemede şunları düzeltemedi; yayınlamadan önce bak:",
                      "the AI could not fix these in 3 attempts; check them before publishing:",
                    )}
                    <ul className="mt-1 list-disc pl-4">
                      {ai.suggestion.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {ai.suggestion.conflicts && ai.suggestion.conflicts.length > 0 && (
                  <div className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                    <p>
                      <b className="text-neutral-800 dark:text-neutral-100">{t("Aynı aramalarda yarışabilir:", "May compete in the same searches:")}</b>{" "}
                      {t(
                        "bu öneri mağazandaki şu listing'lere benziyor. Aynı nişteki ürünlerde bu normal olabilir; hata değil. Hangisinin bu aramayı hedefleyeceğine sen karar ver: bunu ya da diğerini farklılaştırabilir ya da böyle bırakabilirsin.",
                        "this suggestion resembles these listings in your shop. That can be normal for products in the same niche; it is not an error. You decide which one targets this search: change this one or the other one, or leave it as it is.",
                      )}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {ai.suggestion.conflicts.map((c, i) => {
                        const reasons = [
                          c.title_similarity != null && t(`başlıklar %${c.title_similarity} benzer`, `titles ${c.title_similarity}% alike`),
                          c.shared_tags.length > 0 &&
                            t(`${c.shared_tags.length} ortak etiket (${c.shared_tags.slice(0, 4).join(", ")}…)`, `${c.shared_tags.length} shared tags (${c.shared_tags.slice(0, 4).join(", ")}…)`),
                          c.intro_similarity != null && t(`açılış paragrafı %${c.intro_similarity} benzer`, `opening paragraph ${c.intro_similarity}% alike`),
                        ].filter(Boolean);
                        return (
                          <li key={i}>
                            {c.listing_id ? (
                              <Link href={`/listings/${c.listing_id}/edit`} target="_blank" className="font-medium text-[#D97757] hover:text-[#C6613F] hover:underline">
                                {c.title.slice(0, 70)}
                              </Link>
                            ) : (
                              <span className="font-medium">{c.title.slice(0, 70)}</span>
                            )}
                            <span className="text-neutral-400 dark:text-neutral-500"> · {reasons.join(" · ")}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <p className="mt-1 text-xs text-neutral-400">{t("Değişiklikler taslakta; beğenmezsen geri al ya da yayınlamadan düzenle.", "Changes are in the draft; undo them or edit before publishing.")}</p>
              </div>
            )}

            {(!focus || focus === "photo") && (
            <SectionCard
              id="sec-media"
              hideInnerTitle
              title={t("Fotoğraf & Video", "Photos & Video")}
              accent="orange"
              summary={t(`${edit.images.length} fotoğraf · ${edit.videos.length} video`, `${edit.images.length} photos · ${edit.videos.length} videos`)}
              warning={edit.images.length === 0 ? t("Fotoğraf yok", "No photos") : null}
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
            )}

            {focus && (focus === "title_tags" || focus === "description" || focus === "text") && (
              <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                {focus !== "description" && titleField()}
                {focus !== "title_tags" && descriptionField()}
                {focus !== "description" && <TagsEditor shopId={activeShop.id} listingId={listingId} tags={edit.tags} onChange={(tags) => wc.patch({ tags })} />}
              </div>
            )}

            {!focus && (
            <SectionCard
              id="sec-details"
              title={t("Ürün Detayları", "Item details")}
              accent="sky"
              summary={t(`Başlık ${edit.title.length}/140 · Açıklama ${edit.description.length} karakter`, `Title ${edit.title.length}/140 · Description ${edit.description.length} characters`)}
              warning={edit.title.trim() ? null : t("Başlık boş", "Title is empty")}
              open={isOpen("sec-details")}
              onToggle={() => toggle("sec-details")}
            >
            <div className="space-y-5">

              <CategoryPicker shopId={activeShop?.id} taxonomyId={edit.taxonomy_id} onChange={(id) => wc.patch({ taxonomy_id: id })} />

              {titleField()}

              {descriptionField()}

            </div>
            </SectionCard>
            )}

            {(!focus || focus === "price") && (
            <SectionCard
              id="sec-options"
              title={t("Varyasyon, Fiyat & Kişiselleştirme", "Variations, Price & Personalization")}
              accent="violet"
              summary={t(
                `${edit.inventory.products.length} varyant · ${edit.personalization?.questions.length ?? 0} özel alan`,
                `${edit.inventory.products.length} variants · ${edit.personalization?.questions.length ?? 0} personalization fields`,
              )}
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
            )}

            {!focus && (
            <>

            <SectionCard
              id="sec-attributes"
              title={t("Etiketler & Özellikler", "Tags & Attributes")}
              accent="emerald"
              summary={t(
                `${edit.tags.length}/13 etiket · ${edit.materials.length} materyal · ${edit.properties.length} özellik`,
                `${edit.tags.length}/13 tags · ${edit.materials.length} materials · ${edit.properties.length} attributes`,
              )}
              warning={edit.tags.length < 13 ? t(`${13 - edit.tags.length} etiket boş`, `${13 - edit.tags.length} tags empty`) : null}
              open={isOpen("sec-attributes")}
              onToggle={() => toggle("sec-attributes")}
            >
            <div className="space-y-5">
              <TagsEditor shopId={activeShop.id} listingId={listingId} tags={edit.tags} onChange={(tags) => wc.patch({ tags })} />
              <StringListEditor label={t("Materyaller", "Materials")} values={edit.materials} onChange={(materials) => wc.patch({ materials })} />
              <StringListEditor label={t("Stil", "Style")} values={edit.style} maxItems={2} onChange={(style) => wc.patch({ style })} />
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
              title={t("Kargo, İşlem Süresi & İade", "Shipping, Processing & Returns")}
              accent="teal"
              summary={t("Kargo profili, işlem süresi, iade politikası, ağırlık ve boyutlar", "Shipping profile, processing time, return policy, weight and dimensions")}
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
              title={t("Nasıl Yapıldı", "How it's made")}
              accent="amber"
              summary={`${
                { i_did: t("Ben yaptım", "I made it"), collective: t("Ortak üretim", "A collective"), someone_else: t("Başka biri yaptı", "Someone else") }[edit.who_made ?? ""] ?? "—"
              } · ${edit.when_made ?? "—"}`}
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
              title={t("Ayarlar", "Settings")}
              accent="slate"
              summary={`${t("Otomatik yenileme", "Auto-renew")} ${edit.should_auto_renew ? t("açık", "on") : t("kapalı", "off")}${
                edit.featured_rank && edit.featured_rank > 0 ? t(" · Öne çıkan", " · Featured") : ""
              }`}
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
            </>
            )}

            {conflict && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                <p className="mb-1 font-semibold text-amber-900 dark:text-amber-200">{t("Etsy'de bu listing değişmiş", "This listing changed on Etsy")}</p>
                <p className="text-amber-900 dark:text-amber-200">
                  {t("Sen kaydettikten sonra şu alanlar Etsy'de de farklı değiştirilmiş:", "After you saved, these fields were also changed differently on Etsy:")}{" "}
                  <b>{conflict.map((c) => c.label).join(", ")}</b>. {t("Hiçbir şey yazılmadı.", "Nothing was written.")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={handleDiscard}
                    className="rounded-full border border-amber-400 px-4 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  >
                    {t("Etsy'deki hâli al (değişikliklerimi at)", "Use Etsy's version (discard my changes)")}
                  </button>
                  <button onClick={forcePublish} className="rounded-full bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
                    {t("Benimkiyle ez", "Overwrite with mine")}
                  </button>
                  <button onClick={() => dismissPublishJob(listingId)} className="px-3 py-1.5 text-sm text-amber-900 hover:underline dark:text-amber-200">
                    {t("Kapat", "Close")}
                  </button>
                </div>
              </div>
            )}
            {publishError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
                <p className="mb-1 font-semibold text-red-700 dark:text-red-300">{t("Yayın tamamlanamadı", "Publishing did not finish")}</p>
                <p className="text-red-700 dark:text-red-300">{publishError}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  {t("Yerel kaydın korunuyor; sorunu düzeltip tekrar yayınlayınca kalan farklar tamamlanır.", "Your local save is kept; fix the problem and publish again to finish the remaining changes.")}
                </p>
                <button onClick={() => dismissPublishJob(listingId)} className="mt-2 text-xs text-neutral-500 hover:underline">
                  {t("Kapat", "Close")}
                </button>
              </div>
            )}

            <div className={`sticky z-30 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 sm:gap-3 ${ABOVE_BOTTOM_NAV}`}>
              <span className="w-full text-xs text-neutral-600 dark:text-neutral-300 sm:w-auto sm:flex-1 sm:text-sm">{statusLabel}</span>
              {(wc.unsaved || wc.hasLocal || wc.hasDraft) && (
                <button
                  onClick={handleDiscard}
                  disabled={wc.publishing}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:underline disabled:opacity-50 dark:text-neutral-200"
                >
                  {isNew ? t("Listing'i sil", "Delete listing") : t("Değişiklikleri at", "Discard changes")}
                </button>
              )}
              <button
                onClick={wc.saveDraft}
                disabled={!wc.unsaved || wc.draftCurrent || wc.publishing || wc.saveState === "saving"}
                title={t("Ara kayıt alır; liste sayfası değişmez, editörü tekrar açınca kaldığın yerden devam edersin", "Saves your progress; the list page does not change, and you continue where you left off next time")}
                className="flex-1 whitespace-nowrap rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800 sm:flex-none sm:px-4"
              >
                {wc.draftCurrent ? t("Taslak kaydedildi ✓", "Draft saved ✓") : t("Taslak kaydet", "Save draft")}
              </button>
              <button
                onClick={wc.saveLocal}
                disabled={!wc.unsaved || wc.publishing || wc.saveState === "saving"}
                title={t("Değişiklikleri yerel listing'e kaydeder; liste sayfası güncellenir, Etsy'ye gönderilmez", "Saves changes to the local listing; the list page updates, nothing is sent to Etsy")}
                className="flex-1 whitespace-nowrap rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800 sm:flex-none sm:px-4"
              >
                {wc.saveState === "saving" ? t("Kaydediliyor…", "Saving…") : t("Kaydet", "Save")}
              </button>
              <button
                onClick={handlePublish}
                disabled={(!wc.unsaved && !wc.hasLocal) || wc.publishing || wc.saveState === "saving"}
                className="w-full whitespace-nowrap rounded-lg bg-[#D97757] px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-[#C6613F] disabled:opacity-50 sm:w-auto"
              >
                {wc.publishing ? t("Yayınlanıyor…", "Publishing…") : t("Etsy'de yayınla", "Publish to Etsy")}
              </button>
            </div>
          </div>
        )}
      </div>
      {confirmElement}
    </AppShell>
  );
}

"use client";

import { ReactNode, useRef, useState } from "react";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api, GenerationOptions, GenerationReference, ListingImage } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import { Modal, btnGhost, btnPrimary } from "../Modal";
import ChoicePicker, { ResolvedChoice, useGenerationChoice } from "./ChoicePicker";
import { ShotsProgress, VideoProgress } from "./Progress";
import ReferencePicker, { ReferenceValue, emptyReference } from "./ReferencePicker";
import { useImageSet } from "./useImageSet";
import { useVideoJob } from "./useVideoJob";

type Tab = "image" | "video";

const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const labelCls = "mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400";
const pill = (on: boolean) =>
  `rounded-lg border px-3 py-1.5 text-sm transition ${
    on
      ? "border-[#D97757] bg-[#D97757]/10 font-medium text-neutral-900 dark:text-neutral-100"
      : "border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600"
  }`;

/** "Oluştur" penceresi: aynı ürün referansıyla fotoğraf seti ya da video üretir. Model ve kalite admin panelinde açık
 *  olanlardır; kullanıcının seçimi bu tarayıcıda hatırlanır. Sonuçlar taslağa eklenir, Etsy'ye "Yayınla" ile gider. */
export default function GenerateModal(props: {
  shopId: number;
  listingId: number;
  images: ListingImage[];
  imageSlots: number;
  videoSlots: number;
  onImageAdded: (fileId: string) => void;
  onVideoAdded: (fileId: string) => void;
  /** "Bu fotoğrafı da listeye ekle" işaretliyse yüklenen referans dosyası. */
  onReferenceKept: (fileId: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const { data: options, error } = useApiData("gen-options", () => api.listings.generationOptions(props.shopId, props.listingId));

  return (
    <>
      {options ? (
        <Generator {...props} options={options} />
      ) : (
        <Modal z={120} widthClass="max-w-lg" title={t("Oluştur", "Generate")} onClose={props.onClose}>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <BlockSpinner />}
        </Modal>
      )}
    </>
  );
}

function Generator({
  shopId,
  listingId,
  images,
  imageSlots,
  videoSlots,
  onImageAdded,
  onVideoAdded,
  onReferenceKept,
  onClose,
  options,
}: Parameters<typeof GenerateModal>[0] & { options: GenerationOptions }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>(imageSlots > 0 ? "image" : "video");
  const [reference, setReference] = useState<ReferenceValue>(emptyReference);
  const imageChoice = useGenerationChoice("image", options.image);
  const videoChoice = useGenerationChoice("video", options.video);
  const imageSet = useImageSet({ shopId, listingId, onAdded: onImageAdded });
  const video = useVideoJob({ shopId, listingId, onAdded: onVideoAdded });
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [motion, setMotion] = useState("");
  const [pickedDuration, setPickedDuration] = useState<number | null>(null);
  const busy = imageSet.busy || video.phase === "running";
  const credits = (n: number) => (options.credits_enabled ? <span className="ml-1.5 opacity-70">· {t(`${n} kredi`, `${n} credits`)}</span> : null);

  // Yeni dosya bir kez yüklenir; aynı dosyayla ikinci üretim (ör. önce fotoğraf, sonra video) yeniden yüklemez.
  const uploaded = useRef<{ file: File; fileId: string } | null>(null);
  async function resolveReference(): Promise<GenerationReference> {
    if (reference.image) return { image: { id: reference.image.listing_image_id, draftFileId: reference.image.draft_file_id } };
    if (!reference.file) return {};
    if (uploaded.current?.file !== reference.file) {
      const up = await api.listings.uploadDraftFile(shopId, listingId, reference.file, "image", reference.file.name);
      uploaded.current = { file: reference.file, fileId: up.file_id };
      if (reference.keepFile) onReferenceKept(up.file_id);
    }
    return { draftFileId: uploaded.current.fileId };
  }

  // ---- Sekmeye göre gövde ve ana eylem
  let body: ReactNode;
  let action: ReactNode = null;
  let finished = false;

  if (tab === "image") {
    const resolved = imageChoice.resolved;
    const count = Math.max(1, Math.min(qty, imageSlots));
    finished = imageSet.shots.length > 0;
    if (imageSlots <= 0 && !finished) body = <Notice>{t("Fotoğraf sınırına ulaşıldı (en fazla 20).", "The photo limit is reached (up to 20).")}</Notice>;
    else if (!resolved) body = <Notice>{t("Görsel üretimi şu an kullanılamıyor.", "Image generation is not available right now.")}</Notice>;
    else if (finished) body = <ShotsProgress shots={imageSet.shots} busy={imageSet.busy} />;
    else {
      body = (
        <>
          <Choice label={t("Model ve kalite", "Model and quality")} options={options.image} choice={imageChoice} resolved={resolved} unit="image" showCredits={options.credits_enabled} />
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <label>
              <span className={labelCls}>{t("Adet", "Count")}</span>
              <input type="number" min={1} max={imageSlots} value={count} onChange={(e) => setQty(Math.max(1, Math.min(imageSlots, Number(e.target.value) || 1)))} className={field} />
            </label>
            <label>
              <span className={labelCls}>{t("Ek not (opsiyonel)", "Extra note (optional)")}</span>
              <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} placeholder={t("Örn. ahşap zemin, doğal ışık", "E.g. wooden surface, natural light")} className={field} />
            </label>
          </div>
        </>
      );
      action = (
        <button type="button" onClick={() => void imageSet.run(count, note, resolveReference, resolved.choice)} className={btnPrimary}>
          {t(`${count} fotoğraf oluştur`, `Generate ${count} ${count === 1 ? "photo" : "photos"}`)}
          {credits(count * resolved.variant.credits)}
        </button>
      );
    }
    if (imageSet.error) body = <>{body}<ErrorText>{imageSet.error}</ErrorText></>;
  } else {
    const resolved = videoChoice.resolved;
    const durations = resolved?.model.durations ?? [];
    const duration = pickedDuration !== null && durations.includes(pickedDuration) ? pickedDuration : (resolved?.model.default_duration ?? durations[0] ?? 5);
    finished = video.phase === "done";
    if (videoSlots <= 0 && video.phase === "idle") body = <Notice>{t("Video sınırına ulaşıldı (en fazla 2).", "The video limit is reached (up to 2).")}</Notice>;
    else if (!resolved) body = <Notice>{t("Video üretimi şu an kullanılamıyor.", "Video generation is not available right now.")}</Notice>;
    else if (video.phase === "running" || video.phase === "done") body = <VideoProgress startedAt={video.startedAt} done={video.phase === "done"} />;
    else {
      body = (
        <>
          <Choice label={t("Model ve kalite", "Model and quality")} options={options.video} choice={videoChoice} resolved={resolved} unit="second" showCredits={options.credits_enabled} />
          <div>
            <span className={labelCls}>{t("Süre", "Duration")}</span>
            <div role="radiogroup" aria-label={t("Süre", "Duration")} className="flex flex-wrap gap-1.5">
              {durations.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={d === duration} onClick={() => setPickedDuration(d)} className={pill(d === duration)}>
                  {t(`${d} sn`, `${d}s`)}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={labelCls}>{t("Hareket / sahne (opsiyonel)", "Motion / scene (optional)")}</span>
            <textarea
              value={motion}
              onChange={(e) => setMotion(e.target.value.slice(0, 2000))}
              rows={2}
              placeholder={t("Örn. ürünün etrafında yavaşça dönen kamera, yumuşak ışık", "E.g. camera slowly orbiting the product, soft light")}
              className={field}
            />
          </label>
        </>
      );
      action = (
        <button type="button" onClick={() => void video.run(motion, duration, resolveReference, resolved.choice)} className={btnPrimary}>
          {video.phase === "error" ? t("Tekrar dene", "Try again") : t("Video oluştur", "Generate video")}
          {credits(duration * resolved.variant.credits)}
        </button>
      );
    }
    if (video.error) body = <>{body}<ErrorText>{video.error}</ErrorText></>;
  }

  const tabs: { id: Tab; tr: string; en: string }[] = [
    { id: "image", tr: "Fotoğraf", en: "Photos" },
    { id: "video", tr: "Video", en: "Video" },
  ];

  return (
    <Modal
      z={120}
      widthClass="max-w-lg"
      title={t("Oluştur", "Generate")}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={`${btnGhost} disabled:opacity-40`}>
            {finished ? t("Bitir", "Done") : t("Vazgeç", "Cancel")}
          </button>
          {action}
        </>
      }
    >
      <div role="tablist" className="mb-4 inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            disabled={busy}
            onClick={() => setTab(x.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
              tab === x.id ? "bg-[#D97757] text-white" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {t(x.tr, x.en)}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        <ReferencePicker images={images} value={reference} onChange={setReference} disabled={busy} />
        {body}
      </div>
    </Modal>
  );
}

function Choice({
  label,
  options,
  choice,
  resolved,
  unit,
  showCredits,
}: {
  label: string;
  options: GenerationOptions["image"];
  choice: ReturnType<typeof useGenerationChoice>;
  resolved: ResolvedChoice;
  unit: "image" | "second";
  showCredits: boolean;
}) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <ChoicePicker options={options} resolved={resolved} onModel={choice.setModel} onVariant={choice.setVariant} unit={unit} showCredits={showCredits} />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-neutral-50 px-3 py-3 text-sm text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-300">{children}</p>;
}

function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-xs text-red-600 dark:text-red-400">{children}</p>;
}

"use client";

import { useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { Entity, EntityApi } from "../core/api";
import { errMsg } from "../core/errors";
import { btnDanger, btnOutline, muted } from "../core/ui";
import EntityAvatar from "./EntityAvatar";

/** Kabul edilen logo dosyaları ve boyut sınırı (sunucu: modkit/entities.IMAGE_MAX_BYTES). */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const IMAGE_MAX_MB = 8;

/** Kayıt logosu / profil resmi: yükle, değiştir, kaldır. Sunucu kare kırpıp küçültür; her modül aynısını kullanır. */
export default function EntityImagePicker({ api, entity, onChanged }: { api: EntityApi; entity: Pick<Entity, "id" | "name" | "image">; onChanged: () => void }) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const src = entity.image ? api.imageUrl(entity.id, entity.image) : null;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
    }
    setBusy(false);
  }

  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > IMAGE_MAX_MB * 1024 * 1024) {
      toast.error(t(`Dosya çok büyük (en fazla ${IMAGE_MAX_MB} MB)`, `File too large (max ${IMAGE_MAX_MB} MB)`));
      return;
    }
    void run(() => api.uploadImage(entity.id, file), t("Resim güncellendi", "Image updated"));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <EntityAvatar name={entity.name} src={src} size={64} />
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={btnOutline}>
            {busy ? <Spinner size={14} /> : null}
            {entity.image ? t("Resmi değiştir", "Change image") : t("Resim yükle", "Upload image")}
          </button>
          {entity.image && (
            <button type="button" disabled={busy} onClick={() => void run(() => api.removeImage(entity.id), t("Resim kaldırıldı", "Image removed"))} className={btnDanger}>
              {t("Kaldır", "Remove")}
            </button>
          )}
        </div>
        <p className={muted}>{t(`Logo ya da profil resmi · PNG, JPG, WEBP · en fazla ${IMAGE_MAX_MB} MB · kare kırpılır`, `Logo or profile image · PNG, JPG, WEBP · up to ${IMAGE_MAX_MB} MB · cropped square`)}</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

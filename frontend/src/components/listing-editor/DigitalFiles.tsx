"use client";

import { useRef, useState } from "react";
import { api, DigitalFile } from "@/lib/api";
import { tNow as t } from "@/lib/i18n";
import HelpTip from "@/components/ui/HelpTip";

const MAX_FILES = 5;
const MAX_MB = 20;
const ACCEPT = ".pdf,.zip,.png,.jpg,.jpeg,.gif,.svg,.eps,.ai,.psd,.docx,.doc,.xlsx,.xls,.pptx,.txt,.epub,.mp3,.mp4,.mov,.ttf,.otf,.dxf,.stl,.wav,.json,.csv";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Dijital ürünün indirilebilir dosyaları (Etsy: en fazla 5 dosya, her biri en fazla 20 MB). Dosyalar taslağa yüklenir; Etsy'ye "Yayınla" ile gider. */
export default function DigitalFiles({
  shopId,
  listingId,
  files,
  onChange,
}: {
  shopId: number;
  listingId: number;
  files: DigitalFile[];
  onChange: (files: DigitalFile[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    setBusy(true);
    let next = [...files];
    try {
      for (const file of Array.from(list)) {
        if (next.length >= MAX_FILES) {
          setError(t(`En fazla ${MAX_FILES} dosya eklenebilir.`, `You can add at most ${MAX_FILES} files.`));
          break;
        }
        if (file.size > MAX_MB * 1024 * 1024) {
          setError(t(`${file.name}: ${MAX_MB} MB'dan büyük.`, `${file.name}: larger than ${MAX_MB} MB.`));
          continue;
        }
        const up = await api.listings.uploadDraftFile(shopId, listingId, file, "file", file.name);
        next = [...next, { draft_file_id: up.file_id, filename: file.name, size: file.size }];
        onChange(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Dosya yüklenemedi", "File upload failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t("Dijital dosyalar", "Digital files")} <span className="text-red-600">*</span>
        </p>
        <HelpTip>
          {t(
            `Alıcılar satın alır almaz bu dosyaları indirir. En fazla ${MAX_FILES} dosya, her biri en fazla ${MAX_MB} MB. Dosyalar taslakta durur; Etsy'ye "Yayınla" ile yüklenir. Etsy'ye yüklenmiş dosyaları buradan silemezsin.`,
            `Buyers download these files right after purchase. Up to ${MAX_FILES} files, each up to ${MAX_MB} MB. Files stay in the draft and are uploaded to Etsy when you publish. Files already on Etsy cannot be removed from here.`,
          )}
        </HelpTip>
      </div>

      {files.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {files.map((f, i) => (
            <li key={f.draft_file_id ?? `${f.filename}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700">
              <span className="min-w-0 truncate text-neutral-800 dark:text-neutral-100">
                {f.filename}
                <span className="ml-2 text-xs text-neutral-400">{kb(f.size ?? 0)}</span>
                {f.file_id ? <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">{t("Etsy'de", "On Etsy")}</span> : null}
              </span>
              {!f.file_id && (
                <button
                  type="button"
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  className="shrink-0 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  {t("Kaldır", "Remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void add(e.target.files)} />
      <button
        type="button"
        disabled={busy || files.length >= MAX_FILES}
        onClick={() => input.current?.click()}
        className="w-full rounded-xl border border-dashed border-neutral-300 px-4 py-5 text-sm font-medium text-neutral-600 transition hover:border-[#D97757] hover:text-[#B4553A] disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
      >
        {busy ? t("Yükleniyor…", "Uploading…") : t("+ Dosya ekle", "+ Add file")}
      </button>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

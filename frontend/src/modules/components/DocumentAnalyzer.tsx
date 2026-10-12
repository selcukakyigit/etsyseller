"use client";

import { ReactNode, useState } from "react";
import { CameraIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";
import { useRegenProgress } from "@/lib/useRegenProgress";
import { btnDark, btnLink, input, muted } from "../core/ui";

type Progress = { done: number; total: number; startedAt: number; name: string };

/** Dosya sayısı + mevcut dosyanın zaman bazlı tahmini ilerlemesiyle tek yüzdelik çubuk. */
function ProgressBar({ p }: { p: Progress }) {
  const { t } = useT();
  const cur = useRegenProgress({ phase: "running", startedAt: p.startedAt });
  const pct = Math.min(99, Math.round(((p.done + cur / 100) / p.total) * 100));
  return (
    <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="relative h-5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-[#D97757]/70 transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-neutral-900 dark:text-neutral-50">
          {p.name} {t("okunuyor…", "reading…")} %{pct} ({p.done}/{p.total})
        </span>
      </div>
    </div>
  );
}

/**
 * Ulagg Analyzer giriş kapısı: sürükle-bırak / dosya seç, telefonda kamera, ve "metin yapıştır".
 * Okumanın kendisini bilmez: her dosya için `onFile`, yapıştırılan metin için `onText` çağrılır (modül kendi
 * uç noktasına gönderir). Metin yolu görüntüye göre çok daha ucuzdur; kullanıcıya bu yüzden ayrıca sunulur.
 */
export default function DocumentAnalyzer({
  accept,
  hint,
  onFile,
  onText,
  disabled,
  multiple = true,
  extra,
  withNote,
}: {
  accept: string;
  hint: ReactNode;
  /** `note`: yükleme penceresindeki not (`withNote` ise); belgeyle birlikte yorumlanır. */
  onFile: (file: File, note: string) => Promise<void>;
  onText?: (text: string) => Promise<void>;
  disabled?: boolean;
  multiple?: boolean;
  extra?: ReactNode;
  /** Dosya yüklemeye isteğe bağlı bir not alanı ekler (ör. "süreyi sen yaz, malzeme bizden"). */
  withNote?: boolean;
}) {
  const { t } = useT();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const busy = !!progress || !!disabled;

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    for (let i = 0; i < list.length; i++) {
      setProgress({ done: i, total: list.length, startedAt: Date.now(), name: list[i].name });
      await onFile(list[i], note.trim());
    }
    setProgress(null);
    setNote("");
  }

  async function submitText() {
    if (!onText || text.trim().length < 20) return;
    setProgress({ done: 0, total: 1, startedAt: Date.now(), name: t("Metin", "Text") });
    await onText(text.trim());
    setProgress(null);
    setText("");
  }

  return (
    <div>
      {onText && (
        <div className="mb-3 inline-flex rounded-full border border-neutral-200 p-0.5 text-xs dark:border-neutral-700" role="tablist">
          {(["file", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 font-medium transition ${
                mode === m ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 dark:text-neutral-300"
              }`}
            >
              {m === "file" ? t("Dosya / fotoğraf", "File / photo") : t("Metin yapıştır", "Paste text")}
            </button>
          ))}
        </div>
      )}

      {mode === "file" || !onText ? (
        <>
          {withNote && (
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{t("Not (isteğe bağlı)", "Note (optional)")}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={2000}
                disabled={busy}
                placeholder={t(
                  "Ör. “Süre bedeli 4.500 TL + KDV, malzeme bizden.” Yapay zekâ bu notu belgeyle birlikte yorumlar; el yazısı okunmaz, bilgiyi buraya yaz.",
                  "E.g. “Time fee 4,500 TL + VAT, material is ours.” The AI reads this note together with the document; handwriting is not read, so write it here.",
                )}
                className={`${input} w-full resize-y`}
              />
            </label>
          )}
          {/* Dokunmatik cihazda: belgenin fotoğrafını doğrudan arka kamerayla çek. */}
          <label
            aria-disabled={busy}
            className="mb-2 hidden cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#D97757] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#C6613F] aria-disabled:opacity-50 pointer-coarse:flex"
          >
            <CameraIcon />
            {t("Fotoğrafını çek", "Take a photo")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) void handleFiles(e.dataTransfer.files);
            }}
            aria-disabled={busy}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 hover:border-neutral-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 pointer-coarse:p-5"
          >
            <span className="text-2xl" aria-hidden>
              🧾
            </span>
            <span className="font-medium text-neutral-700 dark:text-neutral-200 pointer-coarse:hidden">{t("Belgeleri buraya bırak ya da tıkla", "Drop documents here or click")}</span>
            <span className="hidden font-medium text-neutral-700 dark:text-neutral-200 pointer-coarse:inline">{t("ya da dosya seç", "or choose a file")}</span>
            <span className={muted}>{hint}</span>
            <input
              type="file"
              multiple={multiple}
              accept={accept}
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </>
      ) : (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            maxLength={20000}
            disabled={busy}
            placeholder={t(
              "Belgenin metnini buraya yapıştır. Telefonda fotoğraftaki yazıyı “Metni kopyala” ile alabilirsin; görüntü göndermekten çok daha ucuzdur.",
              "Paste the document text here. On a phone you can use “Copy text” on a photo; it costs far less than sending the image.",
            )}
            className={`${input} w-full resize-y`}
          />
          <div className="mt-2 flex items-center gap-3">
            <button type="button" disabled={busy || text.trim().length < 20} onClick={() => void submitText()} className={btnDark}>
              {t("Metni oku", "Read text")}
            </button>
            {text && (
              <button type="button" onClick={() => setText("")} className={btnLink}>
                {t("Temizle", "Clear")}
              </button>
            )}
            <span className={muted}>{text.length > 0 && text.trim().length < 20 ? t("En az 20 karakter", "At least 20 characters") : ""}</span>
          </div>
        </div>
      )}
      {extra}
      {progress && <ProgressBar p={progress} />}
    </div>
  );
}

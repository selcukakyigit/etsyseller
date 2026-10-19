"use client";

import { ClipboardEvent, DragEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button, inputClass } from "@/components/admin/ui";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/*,.pdf,.txt,.csv,.docx,.xlsx";
const OK_EXT = /\.(jpe?g|png|gif|webp|pdf|txt|csv|docx|xlsx)$/i;

/** Mesaj kutusu: yazı + ekler. Ekran görüntüsü doğrudan yapıştırılabilir (Ctrl/Cmd+V), sürüklenip bırakılabilir ya da seçilebilir. */
export default function Composer({
  placeholder,
  submitLabel,
  rows = 4,
  busy,
  minLength = 1,
  onSubmit,
  extra,
  initialBody = "",
  snippets,
}: {
  placeholder: string;
  submitLabel: string;
  rows?: number;
  busy: boolean;
  minLength?: number;
  /** Başarılıysa true dönmeli: kutu temizlenir. */
  onSubmit: (body: string, files: File[]) => Promise<boolean>;
  /** Gönder düğmesinin yanına konan ek denetimler (ör. "iç not"). */
  extra?: ReactNode;
  initialBody?: string;
  /** Hazır yanıtlar: seçilen metin kutuya eklenir. */
  snippets?: { id: number; title: string; body: string }[];
}) {
  const { t } = useT();
  const [body, setBody] = useState(initialBody);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  function add(incoming: File[]) {
    const accepted: File[] = [];
    for (const f of incoming) {
      // Panodaki resimlerin adı "image.png"dır; her yapıştırma ayrı ad alsın.
      const file = f.name === "image.png" ? new File([f], `screenshot-${Date.now()}-${files.length + accepted.length}.png`, { type: f.type }) : f;
      if (!OK_EXT.test(file.name)) toast.error(t(`Bu dosya türü desteklenmiyor: ${file.name}`, `This file type is not supported: ${file.name}`));
      else if (file.size > MAX_BYTES) toast.error(t(`${file.name} 10 MB'tan büyük.`, `${file.name} is larger than 10 MB.`));
      else accepted.push(file);
    }
    const next = [...files, ...accepted];
    if (next.length > MAX_FILES) toast.error(t(`En fazla ${MAX_FILES} dosya eklenebilir.`, `You can attach up to ${MAX_FILES} files.`));
    setFiles(next.slice(0, MAX_FILES));
  }

  function onPaste(e: ClipboardEvent) {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length === 0) return;
    if (!e.clipboardData.getData("text")) e.preventDefault();
    add(pasted);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    add(Array.from(e.dataTransfer.files));
  }

  async function submit() {
    if (await onSubmit(body.trim(), files)) {
      setBody("");
      setFiles([]);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`space-y-2 rounded-lg ${dragging ? "outline-dashed outline-2 outline-[#D97757]" : ""}`}
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={onPaste}
        rows={rows}
        maxLength={8000}
        placeholder={placeholder}
        className={`${inputClass} resize-y`}
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="relative flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-1.5 pr-7 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300"
            >
              {previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[i]!} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded bg-neutral-100 text-[10px] font-semibold uppercase dark:bg-neutral-800">{f.name.split(".").pop()}</span>
              )}
              <span className="max-w-[140px] truncate">{f.name}</span>
              <button
                type="button"
                aria-label={t("Eki kaldır", "Remove attachment")}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded p-0.5 text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Button onClick={() => picker.current?.click()} disabled={busy || files.length >= MAX_FILES}>
          {t("Dosya / ekran görüntüsü ekle", "Attach file / screenshot")}
        </Button>
        {snippets && snippets.length > 0 && (
          <select
            aria-label={t("Hazır yanıt", "Canned reply")}
            value=""
            onChange={(e) => {
              const s = snippets.find((x) => x.id === Number(e.target.value));
              if (s) setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${s.body}` : s.body));
            }}
            className={`${inputClass} !w-auto !py-1.5`}
          >
            <option value="">{t("Hazır yanıt…", "Canned reply…")}</option>
            {snippets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        )}
        {extra}
        <Button tone="primary" busy={busy} disabled={body.trim().length < minLength} onClick={() => void submit()} className="ml-auto">
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

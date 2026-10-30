"use client";

import { useRef, useState } from "react";
import { Button, errorText, inputClass } from "@/components/admin/ui";
import { Modal, btnGhost } from "@/components/listing-editor/Modal";
import { useT } from "@/lib/i18n-client";
import { researchAdmin } from "@/lib/researchApi";
import { toast } from "@/lib/toast";
import { useRefusedText } from "./shared";
import { termsFromText } from "./terms";

const MAX_TERMS = 1000;

/** Kelimeleri ekler ya da yeniden ölçtürür (süresi dolmamış olsa da); isteğe bağlı olarak sabitler. Tüm kelimeler tek istekte gider. */
export default function AddKeywordsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const refusedText = useRefusedText();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const terms = text.split("\n").map((s) => s.trim()).filter(Boolean);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    const loaded = termsFromText(await file.text());
    setText(loaded.join("\n"));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    setBusy(true);
    try {
      const r = await researchAdmin.refresh(terms, pin);
      const refused = refusedText(r.refused);
      if (refused) toast.error(refused);
      else toast.success(t(`${r.pending} kelime kuyruğa alındı.`, `${r.pending} keywords queued.`));
      if (r.pending > 0 || !refused) onDone();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("Kelime ekle / yenile", "Add / refresh keywords")}
      widthClass="max-w-lg"
      sheet
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <Button tone="primary" busy={busy} disabled={terms.length === 0 || terms.length > MAX_TERMS} onClick={() => void submit()}>
            {t(`Kuyruğa al (${terms.length})`, `Queue (${terms.length})`)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t(`Her satıra bir kelime (en fazla ${MAX_TERMS})`, `One keyword per line (max ${MAX_TERMS})`)}
          className={`${inputClass} h-64 resize-none`}
        />
        {terms.length > MAX_TERMS && <p className="text-xs text-red-600 dark:text-red-400">{t(`En fazla ${MAX_TERMS} kelime; ${terms.length - MAX_TERMS} fazla.`, `At most ${MAX_TERMS} keywords; ${terms.length - MAX_TERMS} too many.`)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
            {t("Sabitle (kullanılmasa da yenilensin)", "Pin (refresh even when unused)")}
          </label>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void loadFile(e.target.files?.[0])} />
          <Button onClick={() => fileRef.current?.click()}>{t("Dosyadan yükle (CSV / TXT)", "Load from file (CSV / TXT)")}</Button>
        </div>
      </div>
    </Modal>
  );
}

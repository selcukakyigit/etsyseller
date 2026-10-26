"use client";

import { useState } from "react";
import { inputClass } from "@/components/admin/ui";
import CategoryChips from "@/components/support/CategoryChips";
import Composer from "@/components/support/Composer";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { buildSupportContext } from "@/lib/clientErrors";
import { useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";
import { supportApi, TicketCategory } from "@/lib/supportApi";
import { toast } from "@/lib/toast";

type Draft = { subject: string; category: TicketCategory };
const BODY_KEY = "support:new-body";

/** Yeni talep penceresi. Konu, tür ve metin taslağı pencere kapanınca ya da sayfa yenilenince kaybolmaz (gönderilince silinir).
 * `prefill`: bir sayfa hata verdiğinde "Talep aç" bağlantısıyla gelen hata metni. */
export default function NewTicketModal({ shopName, prefill, onClose, onCreated }: { shopName: string | null; prefill: string; onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useT();
  const [draft, setDraft] = useCached<Draft>("support:new-draft");
  const value: Draft = draft ?? { subject: prefill ? t("Sayfa hata verdi", "A page showed an error") : "", category: prefill ? "bug" : "question" };
  const [busy, setBusy] = useState(false);

  async function submit(body: string, files: File[]) {
    if (value.subject.trim().length < 3) {
      toast.error(t("Kısa bir konu başlığı yaz.", "Write a short subject."));
      return false;
    }
    setBusy(true);
    try {
      const { id } = await supportApi.create({ subject: value.subject, category: value.category, body, context: buildSupportContext(shopName) }, files);
      setDraft({ subject: "", category: "question" });
      toast.success(t(`Talebin alındı (#${id}).`, `Your request was received (#${id}).`));
      onCreated(id);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Yeni talep", "New request")} widthClass="max-w-2xl" onClose={onClose} closeButton>
      <div className="min-h-[26rem] space-y-4">
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t("Tür", "Type")}
            <HelpTip>
              {t(
                "Talep açarken bulunduğun sayfa, tarayıcın ve son görülen hatalar otomatik eklenir; ekran görüntüsünü yapıştırabilir (Ctrl+V), sürükleyebilir ya da seçebilirsin (en fazla 5 dosya, her biri 10 MB). Yanıt gelince burada ve e-postayla haber veririz; e-postayı yanıtlarsan yanıtın aynı talebe eklenir.",
                "The page you are on, your browser and the latest errors are attached automatically. You can paste a screenshot (Ctrl+V), drag files in or pick them (up to 5 files, 10 MB each). We notify you here and by email when we reply; replying to the email adds your answer to the same request.",
              )}
            </HelpTip>
          </p>
          <CategoryChips value={value.category} onChange={(category) => setDraft({ ...value, category })} />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Konu", "Subject")}</span>
          <input value={value.subject} onChange={(e) => setDraft({ ...value, subject: e.target.value })} maxLength={160} className={inputClass} />
        </label>
        <Composer
          rows={8}
          minLength={5}
          busy={busy}
          draftKey={BODY_KEY}
          initialBody={prefill ? t(`Şu hatayı gördüm:\n${prefill}\n\nŞunu yapmaya çalışıyordum: `, `I saw this error:\n${prefill}\n\nI was trying to: `) : ""}
          placeholder={t("Ne oldu? Ne yapmaya çalışıyordun? Ekran görüntüsünü buraya yapıştırabilirsin (Ctrl+V).", "What happened? What were you trying to do? You can paste a screenshot here (Ctrl+V).")}
          submitLabel={t("Talebi gönder", "Send request")}
          onSubmit={submit}
        />
      </div>
    </Modal>
  );
}

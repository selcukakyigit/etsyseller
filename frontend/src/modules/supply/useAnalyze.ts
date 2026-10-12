"use client";

import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { errMsg } from "../core/errors";
import { AnalyzeResult, supplyApi } from "./api";

/** DocumentAnalyzer için dosya / metin işleyicileri: belgeyi gönderir, okuma hatasını (belge kaydedilmiş olsa da) ve
 * ağ hatasını gösterir, sonucu çağırana verir. İşler, Belgeler ve iş düzenleyici aynı yolu kullanır. */
export function useAnalyzeHandlers(entityId: number, opts: { createJob: boolean; jobId?: number | null }, onResult: (r: AnalyzeResult) => void | Promise<void>) {
  const { t } = useT();
  async function settle(r: AnalyzeResult) {
    if (r.error) toast.error(r.error);
    if (r.note_error) toast.error(`${t("Not yorumlanamadı", "Note could not be read")}: ${r.note_error}`);
    if (r.duplicate) {
      toast.info(
        r.job
          ? t(`Bu belge zaten yüklenmiş (iş #${r.job.number}); yenisi eklenmedi.`, `This document was already uploaded (job #${r.job.number}); nothing new was added.`)
          : t("Bu belge zaten yüklenmiş; yenisi eklenmedi.", "This document was already uploaded; nothing new was added."),
      );
    }
    await onResult(r);
  }
  return {
    onFile: async (file: File, note = "") => {
      try {
        await settle(await supplyApi.analyze.file(entityId, file, { ...opts, note }));
      } catch (e) {
        toast.error(`${file.name}: ${errMsg(e, t("Okunamadı", "Could not read"))}`);
      }
    },
    onText: async (text: string) => {
      try {
        await settle(await supplyApi.analyze.text(entityId, text, opts));
      } catch (e) {
        toast.error(errMsg(e, t("Okunamadı", "Could not read")));
      }
    },
  };
}

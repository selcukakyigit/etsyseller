"use client";

import { useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { clearSessionCache } from "@/lib/sessionCache";
import { toast } from "@/lib/toast";

/** 0 = tüm geçmiş; sıralama için "sonsuz" sayılır. */
const rank = (years: number) => (years === 0 ? 99 : years);
const OPTIONS = [1, 2, 3, 0] as const;

/** Etsy'den ne kadar geçmiş veri alınacağını sorar. Mağaza yeni bağlanınca zorunlu açılır (`current` boş, kapatılamaz); Ayarlar'dan yalnızca
 * genişletmek için açılır (`onClose` verilir, daha kısa seçenekler kapalıdır, var olan veri silinmez). Seçilince indirme sunucuda başlar. */
export default function HistoryChoiceModal({ shopId, current, onClose }: { shopId: number; current: number | null; onClose?: () => void }) {
  const { t } = useT();
  const extending = current !== null;
  const [years, setYears] = useState<number>(current ?? 2);
  const [busy, setBusy] = useState(false);

  const label = (y: number) => (y === 0 ? t("Tüm geçmiş", "All history") : y === 1 ? t("Son 1 yıl", "Last year") : t(`Son ${y} yıl`, `Last ${y} years`));
  const note = (y: number) =>
    y === 1
      ? t("En hızlı başlangıç. Geçen yılla karşılaştırma çalışmaz.", "Fastest start. Year-over-year comparison will not work.")
      : y === 2
        ? t("Yıllık karşılaştırma ve tekrar eden müşteriler için yeterli.", "Enough for year-over-year comparison and repeat customers.")
        : y === 3
          ? t("Daha uzun trend; ilk yükleme biraz uzar.", "A longer trend; the first load takes a bit longer.")
          : t("Büyük mağazalarda ilk yükleme uzun sürebilir.", "The first load can take long for big shops.");

  async function save() {
    setBusy(true);
    try {
      await api.shops.setHistory(shopId, years);
      clearSessionCache(); // mağaza listesi (seçim) yeniden okunsun
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Kaydedilemedi", "Could not save"));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={extending ? t("Geçmiş veriyi genişlet", "Extend history") : t("Ne kadar geçmiş veri alalım?", "How much history should we import?")}
      widthClass="max-w-md"
      sheet
      z={60}
      onClose={onClose}
      closeButton={!!onClose}
      footer={
        <div className="flex justify-end gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {t("Vazgeç", "Cancel")}
            </button>
          )}
          <button
            type="button"
            disabled={busy || (extending && rank(years) <= rank(current))}
            onClick={save}
            className="inline-flex items-center gap-2 rounded-lg bg-[#D97757] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#C6613F] disabled:opacity-50"
          >
            {busy && <Spinner size={14} />}
            {extending ? t("Kaydet ve indir", "Save and download") : t("Başla", "Start")}
          </button>
        </div>
      }
    >
      <div className="min-h-[18rem] space-y-3">
        <p className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          {t("Siparişler, ücretler ve ödemeler seçtiğin dönemden başlar.", "Orders, fees and payments start from the period you choose.")}
          <HelpTip>
            {t(
              "Önce son siparişler gelir, geçmiş arka planda dolar; beklemeden kullanabilirsin. İlanların tamamı her zaman alınır. Daha az geçmiş Etsy'den daha az veri çekmek demektir, bu da ilk yüklemeyi hızlandırır. Sonradan Ayarlar > Mağaza Bağlantısı'ndan genişletebilirsin; var olan veri hiçbir zaman silinmez.",
              "The latest orders come first and older history fills in the background, so you can start right away. All of your listings are always imported. Less history means less data from Etsy, so the first load is faster. You can extend it later under Settings > Shop connection; existing data is never deleted.",
            )}
          </HelpTip>
        </p>
        <ul className="space-y-2" role="radiogroup" aria-label={t("Geçmiş süresi", "History length")}>
          {OPTIONS.map((y) => {
            const disabled = extending && rank(y) < rank(current);
            return (
              <li key={y}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    years === y ? "border-[#D97757] bg-[#FBF1EA] dark:bg-[#2A1D15]" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                  } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <input type="radio" name="history" className="mt-1" checked={years === y} disabled={disabled} onChange={() => setYears(y)} />
                  <span>
                    <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {label(y)}
                      {y === 2 && !extending && <span className="ml-2 rounded-full bg-[#D97757] px-2 py-0.5 text-[10px] font-semibold text-white">{t("Önerilen", "Recommended")}</span>}
                      {extending && y === current && <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">{t("(şu an)", "(current)")}</span>}
                    </span>
                    <span className="block text-xs text-neutral-500 dark:text-neutral-400">{note(y)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

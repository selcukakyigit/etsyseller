"use client";

import { ReactNode, useCallback, useState } from "react";
import BottomSheet from "./BottomSheet";
import { useT } from "@/lib/i18n-client";

/** Filtre paneli: masaüstünde (lg+) yerinde durur; mobilde yerine "Filtreler" düğmesi çıkar ve panel alttan açılır.
 * `button` ve `panel` ayrı yerlere konabilsin diye iki parça döner: düğme araç çubuğuna, panel sayfadaki yerine. */
export function useResponsiveFilters({ activeCount, onReset, children }: { activeCount: number; onReset?: () => void; children: ReactNode }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const button = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800 lg:hidden"
    >
      {t("Filtreler", "Filters")}
      {activeCount > 0 && <span className="rounded-full bg-[#D97757] px-1.5 text-[11px] font-semibold text-white">{activeCount}</span>}
    </button>
  );

  const panel = (
    <>
      <div className="hidden lg:block">{children}</div>
      <BottomSheet
        open={open}
        onClose={close}
        title={t("Filtreler", "Filters")}
        footer={
          <div className="flex gap-2">
            {onReset && (
              <button type="button" onClick={onReset} disabled={activeCount === 0} className="flex-1 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-800 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100">
                {t("Sıfırla", "Reset")}
              </button>
            )}
            <button type="button" onClick={close} className="flex-1 rounded-lg bg-[#D97757] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#C6613F]">
              {t("Sonuçları göster", "Show results")}
            </button>
          </div>
        }
      >
        {children}
      </BottomSheet>
    </>
  );

  return { button, panel };
}

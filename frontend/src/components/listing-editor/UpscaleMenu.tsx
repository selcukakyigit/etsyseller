"use client";

import { useEffect, useRef, useState } from "react";
import { UpscaleOption } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

/**
 * "Yükselt" düğmesi: 2K / 4K seçimi açan küçük menü (yalnızca çözünürlük artırır, içerik değişmez). Tek fotoğraf ve toplu yükseltme aynı
 * bileşeni kullanır; `count` toplu işte kaç fotoğraf olduğunu bildirir ve menüdeki toplam krediyi hesaplar.
 */
export default function UpscaleMenu({
  options,
  showCredits,
  count = 1,
  busy,
  label,
  className,
  onPick,
}: {
  options: UpscaleOption[];
  showCredits: boolean;
  count?: number;
  busy?: boolean;
  label: string;
  className: string;
  onPick: (size: UpscaleOption["size"]) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("Aynı fotoğrafı yalnızca daha yüksek çözünürlüğe çıkarır; içerik değişmez", "Raises the same photo to a higher resolution only; the content does not change")}
        className={`${className} disabled:opacity-50`}
      >
        {label} ▾
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-1/2 z-30 mb-2 w-48 -translate-x-1/2 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          {options.map((o) => (
            <button
              key={o.size}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(o.size);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <span className="font-semibold">{o.size}</span>
              {showCredits && <span className="text-xs text-neutral-500 dark:text-neutral-400">{t(`${o.credits * count} kredi`, `${o.credits * count} credits`)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { CloseIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";

/** Sohbetteki bir resme dokununca tam ekran büyük görünüm. Dışarı dokunma, Esc ya da kapat düğmesiyle kapanır. */
export default function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const { t } = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("Kapat", "Close")}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        <CloseIcon />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

"use client";

import { ReactNode } from "react";
import { useT } from "@/lib/i18n-client";

/** Asistan kartlarındaki yuvarlak simge düğmesi (yeniden üret, sil, listing'e ekle, indir…): bütün kartlar aynı görünümü kullanır. */
const base = "flex h-9 w-9 items-center justify-center rounded-full transition";
const plain = "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";
const primaryStyle = "bg-[#D97757] text-white hover:bg-[#C6613F]";

export function CardIconButton({ label, onClick, primary, children }: { label: string; onClick: () => void; primary?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`${base} ${primary ? primaryStyle : plain}`}>
      {children}
    </button>
  );
}

/** Dosyayı indirir: sunucu `?download=1` ile Content-Disposition: attachment döner, tarayıcı sayfadan ayrılmadan indirir. */
export function DownloadLink({ href, label }: { href: string; label?: string }) {
  const { t } = useT();
  const text = label ?? t("İndir", "Download");
  return (
    <a href={`${href}${href.includes("?") ? "&" : "?"}download=1`} download aria-label={text} title={text} className={`${base} ${plain}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12" />
        <path d="m7 11 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
    </a>
  );
}

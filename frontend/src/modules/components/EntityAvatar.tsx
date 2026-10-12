"use client";

import { useState } from "react";

/** Modül kaydının logosu; yoksa (ya da yüklenemezse) adının baş harfleri. Modülden bağımsız: adres dışarıdan gelir. */
export default function EntityAvatar({ name, src, size = 40, className = "" }: { name: string; src: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toLocaleUpperCase() ?? "")
      .join("") || "?";
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (src && failed !== src) {
    return (
      // Yetki kontrollü API adresi (çerezle); next/image optimizasyonu bu adresi çekemez.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={style}
        onError={() => setFailed(src)}
        className={`shrink-0 rounded-full border border-neutral-200 object-cover dark:border-neutral-700 ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-[#D97757]/15 font-semibold text-[#C6613F] dark:bg-[#D97757]/25 dark:text-[#E8A48C] ${className}`}
    >
      {initials}
    </span>
  );
}

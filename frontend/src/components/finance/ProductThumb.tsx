"use client";

/** Ürün küçük resmi; resim yoksa (listing yerel önbellekte değilse) ürün ikonu gösterir. */
export default function ProductThumb({ src, size = 36 }: { src?: string; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={{ width: size, height: size }} className="flex-shrink-0 rounded object-cover" />;
  }
  return (
    <div
      style={{ width: size, height: size }}
      title="Bu ürünün görseli yerelde yok (listing kapalı, tükenmiş ya da silinmiş olabilir)"
      className="flex flex-shrink-0 items-center justify-center rounded bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
        <path d="m3 8 9 5 9-5" />
        <path d="M12 13v8" />
      </svg>
    </div>
  );
}

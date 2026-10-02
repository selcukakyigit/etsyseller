import { tNow } from "@/lib/i18n";

/** Dönen halka. Ekran okuyucular için "Yükleniyor" metni görünmez olarak durur. */
export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center justify-center ${className}`}>
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className="animate-spin rounded-full border-2 border-neutral-200 border-t-[#D97757] dark:border-neutral-700 dark:border-t-[#D97757]"
      />
      <span className="sr-only">{tNow("Yükleniyor…", "Loading…")}</span>
    </span>
  );
}

/** Sayfa verisi gelene kadar içerik alanının ortasında duran büyük spinner. */
export function PageSpinner() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner size={36} />
    </div>
  );
}

/** Pencere, panel ya da bölüm içinde ortalanmış küçük spinner. */
export function BlockSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <Spinner size={24} />
    </div>
  );
}

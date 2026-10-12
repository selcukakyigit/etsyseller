"use client";

import { useT } from "@/lib/i18n-client";

/** Dönen halka. Ekran okuyucular için "Yükleniyor" metni görünmez olarak durur. Dil hook'tan gelir: sunucuda ve ilk
 * çizimde aynı metin üretilir (tNow kullanılınca sunucu "Loading…", tarayıcı "Yükleniyor…" yazıp uyuşmazlık veriyordu). */
export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  const { t } = useT();
  return (
    <span role="status" className={`inline-flex items-center justify-center ${className}`}>
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className="animate-spin rounded-full border-2 border-neutral-200 border-t-[#D97757] dark:border-neutral-700 dark:border-t-[#D97757]"
      />
      <span className="sr-only">{t("Yükleniyor…", "Loading…")}</span>
    </span>
  );
}

/** Sayfa verisi gelene kadar içerik alanının (kenar çubuğu ve üst bar hariç) ortasında duran büyük spinner.
 * Sabit konumlu bir katmandır, sayfada yer kaplamaz: başlık ve filtreler aşağı itilmez, yerinde kalır. */
export function PageSpinner() {
  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 top-[49px] z-[5] flex items-center justify-center lg:left-56">
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

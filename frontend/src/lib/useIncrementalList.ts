"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Büyük listeleri (yüzlerce kart) bir anda çizmek yerine parça parça gösterir: önce `pageSize` öğe, liste sonundaki
 * görünmez işaretçi ekrana yaklaşınca bir parça daha. `resetKey` değişince (filtre, arama, sıralama, görünüm) başa döner.
 * Dönen `sentinelRef`, listenin hemen altına konan boş bir öğeye verilir.
 */
export function useIncrementalList<T>(items: T[], pageSize: number, resetKey: string, initialCount?: number) {
  // `initialCount`: geri dönüşte kaldığı yere kaydırabilmek için önceki ziyarette yüklenmiş kart sayısıyla başla.
  const [count, setCount] = useState(Math.max(pageSize, initialCount ?? 0));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Liste kriteri değişince başa dön. Render sırasında durum ayarlama: efekt+gecikme yerine tek geçişte uygulanır.
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setCount(pageSize);
  }

  const hasMore = count < items.length;

  // Her `count` değişiminde gözlemciyi yeniden kur: işaretçi hâlâ ekrandaysa (kısa liste, geniş ekran) bir sonraki
  // parça da hemen yüklensin, kullanıcı kaydırmak zorunda kalmasın.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!hasMore || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => c + pageSize);
      },
      { rootMargin: "600px 0px" }, // ekrana gelmeden ~600px önce yüklemeye başla
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [count, hasMore, pageSize]);

  return { shown: items.slice(0, count), hasMore, total: items.length, sentinelRef };
}

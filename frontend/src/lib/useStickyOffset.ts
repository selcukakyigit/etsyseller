"use client";

import { useCallback, useRef } from "react";

/** Sabit üst bloğun (başlık + arama + sekmeler) gerçek yüksekliğini üst öğeye `--os` CSS değişkeni olarak yazar ve içerik değişince günceller.
 *  Altındaki sabit parçalar (filtre paneli, grup başlığı) üst boşluklarını bundan alır: `top-[calc(49px+var(--os))]`. Elle yazılmış bir `rem`
 *  değeri çubuk uzayınca panelin üstünü çubuğun arkasında bırakıyordu. Kullanım: `<div ref={useStickyOffset()} className="lg:sticky lg:top-[49px]">`. */
export function useStickyOffset() {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    const root = el?.parentElement;
    if (!el || !root) return;
    const set = () => root.style.setProperty("--os", `${el.offsetHeight}px`);
    set();
    observer.current = new ResizeObserver(set);
    observer.current.observe(el);
  }, []);
}

/** Sabit çubuğun altında duran yan panel (filtreler): üst kenarı çubuğun hemen altında, yüksekliği kalan ekran kadar. Panelin İLK grubu sabit üst bölümdür
 *  (`PANEL_PINNED`), kalanı `PANEL_SCROLL` içinde kayar: tekerlek panelin üstündeyken ilk grup (Listing durumu, Gönderim tarihi) gizlenmez. */
export const STICKY_PANEL = "lg:sticky lg:flex lg:flex-col lg:self-start lg:top-[calc(49px+var(--os,170px)+0.75rem)] lg:max-h-[calc(100vh-49px-var(--os,170px)-1.5rem)]";

export const PANEL_CARD = "flex min-h-0 flex-col rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:flex-1";
export const PANEL_PINNED = "shrink-0 border-b border-neutral-100 p-4 pb-3 dark:border-neutral-800";
export const PANEL_SCROLL = "min-h-0 overflow-y-auto px-4 pb-4";

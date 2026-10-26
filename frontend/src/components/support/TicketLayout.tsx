"use client";

import { ReactNode } from "react";
import Drawer from "@/components/ui/Drawer";
import { useIsDesktop } from "@/lib/useMediaQuery";

/** Talep ekranlarının ortak düzeni (kullanıcı ve yönetici). Geniş ekranda iki bölme: solda liste, sağda seçilen talep; ikisi de kendi içinde kayar.
 * Dar ekranda liste tam genişlikte durur, seçilen talep sağdan kayan tam ekran çekmecede (Drawer) açılır; ✕ ya da geri tuşu listeye döndürür. */
export default function TicketLayout({
  list,
  detail,
  detailTitle,
  onCloseDetail,
  placeholder,
}: {
  list: ReactNode;
  detail: ReactNode | null;
  /** Çekmece başlığı (ör. "#12"). */
  detailTitle: string;
  onCloseDetail: () => void;
  placeholder: ReactNode;
}) {
  const desktop = useIsDesktop();
  const pane = "min-w-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <div className={pane}>{list}</div>
      {desktop ? (
        <div className={pane}>{detail ?? <p className="py-24 text-center text-sm text-neutral-400 dark:text-neutral-500">{placeholder}</p>}</div>
      ) : (
        detail && (
          <Drawer title={detailTitle} onClose={onCloseDetail}>
            {detail}
          </Drawer>
        )
      )}
    </div>
  );
}

"use client";

import { Button } from "@/components/admin/ui";
import { useT } from "@/lib/i18n-client";

/** Seçili kelimeleri aktif koleksiyona toplu ekler (tek tek eklemek için satırdaki yeşil + yeter). Aktif koleksiyon yoksa düğme kapalıdır. */
export default function SaveBar({ count, collection, busy, onAdd }: { count: number; collection: string | null; busy: boolean; onAdd: () => void }) {
  const { t } = useT();
  return (
    <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(`${count} kelime seçili`, `${count} keywords selected`)}</p>
      <Button tone="primary" busy={busy} disabled={collection === null} onClick={onAdd} title={collection === null ? t("Önce bir koleksiyon oluştur", "Create a collection first") : undefined}>
        {collection === null ? t("Önce koleksiyon oluştur", "Create a collection first") : t(`“${collection === "" ? "Genel" : collection}” koleksiyonuna ekle`, `Add to “${collection === "" ? "General" : collection}”`)}
      </Button>
    </div>
  );
}

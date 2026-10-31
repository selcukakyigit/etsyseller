"use client";

import { ReactNode, useState } from "react";
import { useStoredState } from "@/lib/useStoredState";
import { useT } from "@/lib/i18n-client";

/** Sürükle-bırak ile yeri değiştirilebilen kart ızgarası (4 sütun). Sıra bu tarayıcıda `storageKey` altında saklanır;
 * saklı sırada olmayan kartlar (sonradan eklenenler) varsayılan sırayla sona eklenir. */
export default function SortableCards({ items, storageKey }: { items: { id: string; node: ReactNode }[]; storageKey: string }) {
  const { t } = useT();
  const [saved, setSaved] = useStoredState<string>(storageKey, "");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const ids = items.map((i) => i.id);
  const savedIds = saved.split(",").filter((id) => ids.includes(id));
  const order = [...savedIds, ...ids.filter((id) => !savedIds.includes(id))];
  const byId = new Map(items.map((i) => [i.id, i.node]));

  const drop = (target: string) => {
    if (dragId && dragId !== target) {
      const next = order.filter((id) => id !== dragId);
      next.splice(next.indexOf(target) + (order.indexOf(dragId) < order.indexOf(target) ? 1 : 0), 0, dragId);
      setSaved(next.join(","));
    }
    setDragId(null);
    setOverId(null);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {order.map((id) => (
          <div
            key={id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDragId(id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverId(id);
            }}
            onDragLeave={() => setOverId((o) => (o === id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              drop(id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            title={t("Sürükleyip yerini değiştirebilirsiniz", "Drag to reorder")}
            className={`cursor-grab rounded-xl active:cursor-grabbing [&>*]:h-full ${dragId === id ? "opacity-40" : ""} ${overId === id && dragId !== id ? "ring-2 ring-[#D97757]" : ""}`}
          >
            {byId.get(id)}
          </div>
        ))}
      </div>
      {saved && (
        <div className="mt-1 text-right">
          <button type="button" onClick={() => setSaved("")} className="text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
            {t("Sıralamayı sıfırla", "Reset order")}
          </button>
        </div>
      )}
    </div>
  );
}

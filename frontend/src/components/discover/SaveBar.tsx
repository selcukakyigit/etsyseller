"use client";

import { useState } from "react";
import { Button } from "@/components/admin/ui";
import { useT } from "@/lib/i18n-client";
import type { SavedCollection } from "@/lib/discoverApi";

const NEW = "__new__";
const MAX_NAME = 60;

/** Seçili kelimeleri bir koleksiyona kaydeder: mevcut koleksiyonlardan biri ya da yeni ad. Boş ad "Genel" listedir. */
export default function SaveBar({
  count,
  collections,
  busy,
  onSave,
}: {
  count: number;
  collections: SavedCollection[];
  busy: boolean;
  onSave: (collection: string) => void;
}) {
  const { t } = useT();
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const names = collections.some((c) => c.name === "") || collections.length === 0 ? collections : [{ name: "", count: 0 }, ...collections];
  const target = choice === NEW ? newName.trim() : choice;
  const disabled = choice === NEW && newName.trim() === "";

  return (
    <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 sm:flex-row sm:items-center">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(`${count} kelime seçili`, `${count} keywords selected`)}</p>
      <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label={t("Koleksiyon", "Collection")}
          className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        >
          {names.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name === "" ? t("Genel", "General") : c.name}
            </option>
          ))}
          <option value={NEW}>{t("+ Yeni koleksiyon…", "+ New collection…")}</option>
        </select>
        {choice === NEW && (
          <input
            value={newName}
            maxLength={MAX_NAME}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("Koleksiyon adı", "Collection name")}
            aria-label={t("Koleksiyon adı", "Collection name")}
            className="w-44 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
        )}
        <Button tone="primary" busy={busy} disabled={disabled} onClick={() => onSave(target)}>
          {t("Kaydet", "Save")}
        </Button>
      </div>
    </div>
  );
}

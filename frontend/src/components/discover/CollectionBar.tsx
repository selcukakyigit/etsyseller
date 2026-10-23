"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/admin/ui";
import { useT } from "@/lib/i18n-client";
import { MAX_COLLECTION_NAME } from "./useCollection";

const field =
  "rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";

/** Aktif koleksiyon seçici. Koleksiyon yoksa (ya da seçilmemişse) önce oluşturulur; oluşturulunca satırlardaki yeşil + ile tek dokunuşla ekleme açılır. */
export default function CollectionBar({
  names,
  counts,
  active,
  onChoose,
  onCreate,
}: {
  names: string[];
  counts: Record<string, number>;
  active: string | null;
  onChoose: (name: string) => void;
  onCreate: (name: string) => void;
}) {
  const { t } = useT();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const needsOne = active === null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name);
    setName("");
    setCreating(false);
  }

  const label = (n: string) => `${n === "" ? t("Genel", "General") : n}${counts[n] !== undefined ? ` (${counts[n]})` : ""}`;

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${needsOne ? "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/40" : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"}`}>
      <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("Koleksiyon:", "Collection:")}</span>
      {needsOne && !creating && names.length === 0 && (
        <span className="text-sm text-neutral-600 dark:text-neutral-300">{t("Kelime eklemek için önce bir koleksiyon oluştur.", "Create a collection first to add keywords.")}</span>
      )}
      {names.length > 0 && (
        <select value={active ?? ""} onChange={(e) => onChoose(e.target.value)} aria-label={t("Aktif koleksiyon", "Active collection")} className={field}>
          {active === null && (
            <option value="" disabled>
              {t("Koleksiyon seç…", "Choose a collection…")}
            </option>
          )}
          {names.map((n) => (
            <option key={n} value={n}>
              {label(n)}
            </option>
          ))}
        </select>
      )}
      {creating || (needsOne && names.length === 0) ? (
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            autoFocus={creating}
            value={name}
            maxLength={MAX_COLLECTION_NAME}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Koleksiyon adı", "Collection name")}
            aria-label={t("Koleksiyon adı", "Collection name")}
            className={`${field} w-48`}
          />
          <Button type="submit" tone="primary" disabled={!name.trim()}>
            {t("Oluştur", "Create")}
          </Button>
          {creating && (
            <Button onClick={() => setCreating(false)}>{t("Vazgeç", "Cancel")}</Button>
          )}
        </form>
      ) : (
        <Button onClick={() => setCreating(true)}>{t("+ Yeni koleksiyon", "+ New collection")}</Button>
      )}
      {!needsOne && <span className="text-xs text-neutral-500 dark:text-neutral-400">{t("Satırdaki yeşil + ile tek dokunuşta eklenir.", "Tap the green + on a row to add it.")}</span>}
    </div>
  );
}

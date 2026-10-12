"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { EntityApi, ExternalParty } from "../core/api";
import { errMsg } from "../core/errors";
import { btnLink, btnOutline, input } from "../core/ui";

const NEW = "__new__";

/** Dış pay sahibi seçici (başka hesaptaki mağaza, yerel satış…): listeden seçilir, listede yoksa oradan yeni eklenir. Ortak yapıdır;
 * modüller maliyetin kendi mağazalarına yazılmayan payını bununla bir sahibe bağlar. `value` null ise seçim yok; seçilince `onChange` çağrılır. */
export default function PartySelect({
  api,
  entityId,
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
}: {
  api: EntityApi;
  entityId: number;
  value: number | null;
  onChange: (party: ExternalParty | null) => void;
  placeholder: string;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const { t } = useT();
  const { data, reload } = useApiData(`modkit-parties:${api.base}:${entityId}`, () => api.parties.list(entityId));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const parties = (data?.items ?? []).filter((p) => !p.archived || p.id === value);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const party = await api.parties.create(entityId, name);
      reload();
      setAdding(false);
      setName("");
      onChange(party);
    } catch (e) {
      toast.error(errMsg(e, t("Eklenemedi", "Could not add")));
    }
    setBusy(false);
  }

  if (adding) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          maxLength={80}
          placeholder={t("Ör. 2. mağaza hesabı, yerel satış", "e.g. second shop account, local sales")}
          className={`${input} w-64 max-w-full`}
          aria-label={t("Ad", "Name")}
        />
        <button type="button" disabled={busy || !name.trim()} onClick={() => void create()} className={btnOutline}>
          {t("Ekle", "Add")}
        </button>
        <button type="button" onClick={() => setAdding(false)} className={btnLink}>
          {t("Vazgeç", "Cancel")}
        </button>
      </div>
    );
  }

  return (
    <select
      value={value === null ? "" : String(value)}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === NEW) setAdding(true);
        else onChange(parties.find((p) => String(p.id) === e.target.value) ?? null);
      }}
      className={input}
      aria-label={ariaLabel}
    >
      <option value="">{placeholder}</option>
      {parties.map((p) => (
        <option key={p.id} value={String(p.id)}>
          {p.name}
        </option>
      ))}
      <option value={NEW}>{t("+ Yeni ekle…", "+ Add new…")}</option>
    </select>
  );
}

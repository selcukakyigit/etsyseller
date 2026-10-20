"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n-client";
import { EntityApi } from "../core/api";
import { useMaterialCatalog } from "../core/materials";
import { input } from "../core/ui";
import MaterialTypesModal from "./MaterialTypesModal";

const NEW = "__new";

/** Malzeme türü seçici: yerleşik ve kendi eklediğin türler (backend kataloğu). `sheetOnly`: ürünün malzemesi levha türünden seçilir, ambalaj ve sarf
 * türleri listelenmez. `canAdd` ise listenin sonunda "Yeni tür…" çıkar ve tür eklenip silinebilen pencere açılır. */
export default function MaterialTypeSelect({
  api,
  entityId,
  value,
  onChange,
  sheetOnly,
  canAdd,
  disabled,
  className = "",
}: {
  api: EntityApi;
  entityId: number;
  value: string;
  onChange: (key: string) => void;
  sheetOnly?: boolean;
  canAdd?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const catalog = useMaterialCatalog();
  const [manage, setManage] = useState(false);
  const types = (catalog?.types ?? []).filter((m) => !sheetOnly || m.group === "sheet");
  return (
    <>
      <select
        value={value}
        onChange={(e) => (e.target.value === NEW ? setManage(true) : onChange(e.target.value))}
        disabled={disabled}
        className={`${input} ${className}`}
        aria-label={t("Malzeme türü", "Material type")}
      >
        <option value="">—</option>
        {types.map((m) => (
          <option key={m.key} value={m.key}>
            {t(m.tr, m.en)}
          </option>
        ))}
        {canAdd && <option value={NEW}>{t("＋ Yeni tür / türleri yönet…", "＋ New type / manage types…")}</option>}
      </select>
      {manage && (
        <MaterialTypesModal
          api={api}
          entityId={entityId}
          onClose={() => setManage(false)}
          onCreated={(created) => {
            if (!sheetOnly || created.group === "sheet") onChange(created.key); // ürün malzemesi için levha olmayan tür seçilmez
          }}
        />
      )}
    </>
  );
}

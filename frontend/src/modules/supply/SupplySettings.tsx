"use client";

import EntitySettings from "../components/EntitySettings";
import { Entity } from "../core/api";
import { MODULE_PATH, supplyApi } from "./api";

/** "Ayarlar" sekmesi: kaydın adı, etiketi, para birimi, KDV ayarları, arşivleme ve silme (yalnızca çalışma alanı üyesi). */
export default function SupplySettings({ entity, onChanged }: { entity: Entity; onChanged: () => void }) {
  return (
    <div className="max-w-3xl">
      <EntitySettings
        api={supplyApi}
        entity={entity}
        backHref={MODULE_PATH}
        labelTitleTr="Etiket (ör. Kesimci)"
        labelTitleEn="Label (e.g. Laser cutter)"
        deleteWarningTr="Bu kayıt; fiyatları, işleri, belgeleri ve davetleriyle birlikte silinir. Finansa yazılmış dağıtımlar da gider."
        deleteWarningEn="This record is deleted with its prices, jobs, documents and invitations. Allocations written to finance are removed too."
        onChanged={onChanged}
      />
    </div>
  );
}

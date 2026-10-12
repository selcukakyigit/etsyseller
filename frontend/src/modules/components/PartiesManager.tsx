"use client";

import { useState } from "react";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { EntityApi, ExternalParty } from "../core/api";
import { errMsg } from "../core/errors";
import { btnLink, btnOutline, card, h2, input, muted, rowBorder } from "../core/ui";

/** Dış pay sahipleri listesi (ayarlar): ad değiştirme, arşive alma / geri getirme, yeni ekleme. Liste çalışma alanına aittir, bütün tedarikçi
 * kayıtlarında ve modüllerde ortaktır. Payın kendisi bir işin "Maliyet nereye yazılsın?" bölümünden bu sahiplere dağıtılır. */
export default function PartiesManager({ api, entityId }: { api: EntityApi; entityId: number }) {
  const { t } = useT();
  const { data, error, reload } = useApiData(`modkit-parties:${api.base}:${entityId}`, () => api.parties.list(entityId));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (e) {
      toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
    }
    setBusy(false);
  }

  return (
    <section className={`${card} mt-4`}>
      <h2 className={h2}>{t("Dış pay sahipleri", "External share owners")}</h2>
      <p className={`${muted} mb-3`}>
        {t(
          "Maliyetin kendi mağazalarına yazılmayan payının sahipleri: başka hesaptaki mağaza, yerel (liste dışı) satış, ortak… Bir işte “Maliyet nereye yazılsın?” bölümünden “+ Dış pay” ile pay verirsin; dağıtılmayan kalan da buraya yazılabilir. Pay ürün maliyetine ve Finans'a girmez, Genel sekmesinde sahip başına toplanır. Liste bütün tedarikçilerde ortaktır.",
          "Owners of the part of the cost that is not booked to your own shops: a shop on another account, local (off-list) sales, a partner… In a job, give a share from “Where should the cost go?” with “+ External share”; the unallocated rest can go here too. A share is not booked as product cost or in Finance; it is totalled per owner in the Overview tab. The list is shared by every supplier.",
        )}
      </p>
      {!data ? (
        error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <BlockSpinner />
      ) : (
        <ul className="mb-3">
          {data.items.length === 0 && <li className={muted}>{t("Henüz dış pay sahibi yok.", "No external share owners yet.")}</li>}
          {data.items.map((p) => (
            <Row key={p.id} party={p} busy={busy} onSave={(patch) => run(() => api.parties.update(entityId, p.id, patch))} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && void run(async () => (await api.parties.create(entityId, name), setName("")))}
          maxLength={80}
          placeholder={t("Yeni sahip adı (ör. 2. mağaza hesabı)", "New owner name (e.g. second shop account)")}
          className={`${input} w-72 max-w-full`}
          aria-label={t("Yeni dış pay sahibi", "New external share owner")}
        />
        <button type="button" disabled={busy || !name.trim()} onClick={() => void run(async () => (await api.parties.create(entityId, name), setName("")))} className={btnOutline}>
          {t("Ekle", "Add")}
        </button>
      </div>
    </section>
  );
}

function Row({ party, busy, onSave }: { party: ExternalParty; busy: boolean; onSave: (patch: { name?: string; archived?: boolean }) => void }) {
  const { t } = useT();
  const [name, setName] = useState(party.name);
  return (
    <li className={`${rowBorder} flex flex-wrap items-center gap-3 py-2 last:border-0`}>
      <input
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== party.name && onSave({ name })}
        maxLength={80}
        className={`${input} w-64 max-w-full ${party.archived ? "opacity-50" : ""}`}
        aria-label={t("Ad", "Name")}
      />
      {party.archived && <span className={muted}>{t("arşivde", "archived")}</span>}
      <button type="button" disabled={busy} onClick={() => onSave({ archived: !party.archived })} className={btnLink}>
        {party.archived ? t("Geri getir", "Restore") : t("Arşivle", "Archive")}
      </button>
    </li>
  );
}

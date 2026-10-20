"use client";

import { useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import HelpTip from "@/components/ui/HelpTip";
import DecimalInput from "@/components/ui/NumberInputs";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { EntityApi, MaterialGroup, MaterialTypeInfo } from "../core/api";
import { errMsg } from "../core/errors";
import { GROUP_INFO, refreshMaterialCatalog, useMaterialCatalog } from "../core/materials";
import { btnDanger, btnOutline, btnPrimary, input, label, muted, rowBorder } from "../core/ui";

const GROUPS = Object.keys(GROUP_INFO) as MaterialGroup[];

/** Kendi malzeme türlerin: ekle ve sil. Yerleşik türler değişmez. Tür bir gruba bağlanır; grup, kalemde hangi alanların sorulacağını belirler. */
export default function MaterialTypesModal({ api, entityId, onClose, onCreated }: { api: EntityApi; entityId: number; onClose: () => void; onCreated?: (created: MaterialTypeInfo) => void }) {
  const { t } = useT();
  const catalog = useMaterialCatalog();
  const [confirm, confirmEl] = useConfirm();
  const [name, setName] = useState("");
  const [group, setGroup] = useState<MaterialGroup>("sheet");
  const [density, setDensity] = useState("");
  const [busy, setBusy] = useState(false);
  const custom = (catalog?.types ?? []).filter((x) => !x.builtin);

  async function add() {
    const d = Number(density.replace(",", "."));
    if (!name.trim()) return toast.error(t("Bir ad yaz.", "Enter a name."));
    if (group === "sheet" && !(Number.isFinite(d) && d > 0)) return toast.error(t("Levha türü için yoğunluk (g/cm³) yaz, örn. çelik 7,85.", "Enter a density (g/cm³) for a sheet type, e.g. steel 7.85."));
    setBusy(true);
    try {
      const created = await api.materialTypes.add(entityId, { name: name.trim(), group, density: group === "sheet" ? d : null });
      await refreshMaterialCatalog(api, entityId);
      toast.success(t("Malzeme türü eklendi", "Material type added"));
      setName("");
      setDensity("");
      onCreated?.(created);
    } catch (e) {
      toast.error(errMsg(e, t("Eklenemedi", "Could not add")));
    }
    setBusy(false);
  }

  async function remove(key: string, typeName: string, used: number) {
    const body = used > 0 ? t(`${used} kalem ve ürün parçası “Diğer” türüne taşınır (ürün parçalarının malzemesi boşalır).`, `${used} items and product parts will move to “Other” (parts lose their material).`) : undefined;
    if (!(await confirm({ title: t(`“${typeName}” silinsin mi?`, `Delete “${typeName}”?`), message: body, destructive: true, confirmLabel: t("Sil", "Delete") }))) return;
    try {
      await api.materialTypes.remove(entityId, key);
      await refreshMaterialCatalog(api, entityId);
    } catch (e) {
      toast.error(errMsg(e, t("Silinemedi", "Could not delete")));
    }
  }

  return (
    <Modal title={t("Malzeme türleri", "Material types")} widthClass="max-w-lg" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
          <label className="block">
            <span className={label}>{t("Yeni tür", "New type")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("Ör. Bakır tel", "e.g. Copper wire")} className={`${input} w-full`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>
                {t("Grup", "Group")}{" "}
                <HelpTip>
                  <ul className="space-y-1.5">
                    {GROUPS.map((g) => (
                      <li key={g}>
                        <b>{t(GROUP_INFO[g].tr, GROUP_INFO[g].en)}:</b> {t(GROUP_INFO[g].hintTr, GROUP_INFO[g].hintEn)}
                      </li>
                    ))}
                  </ul>
                </HelpTip>
              </span>
              <select value={group} onChange={(e) => setGroup(e.target.value as MaterialGroup)} className={`${input} w-full`}>
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {t(GROUP_INFO[g].tr, GROUP_INFO[g].en)}
                  </option>
                ))}
              </select>
            </label>
            {group === "sheet" && (
              <label className="block">
                <span className={label}>{t("Yoğunluk (g/cm³)", "Density (g/cm³)")}</span>
                <DecimalInput value={density} onValue={setDensity} placeholder="7.85" className={`${input} w-full`} />
              </label>
            )}
          </div>
          <div className="text-right">
            <button type="button" disabled={busy} onClick={() => void add()} className={btnPrimary}>
              {t("Ekle", "Add")}
            </button>
          </div>
        </div>

        {custom.length === 0 ? (
          <p className={muted}>{t("Henüz kendi eklediğin tür yok.", "You have not added any types yet.")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {custom.map((m) => (
                <tr key={m.key} className={rowBorder}>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">{m.tr}</div>
                    <div className={muted}>
                      {t(GROUP_INFO[m.group].tr, GROUP_INFO[m.group].en)}
                      {m.density ? ` · ${m.density} g/cm³` : ""}
                      {m.used > 0 ? ` · ${t(`${m.used} yerde kullanılıyor`, `used in ${m.used} places`)}` : ""}
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => void remove(m.key, m.tr, m.used)} className={btnDanger}>
                      {t("Sil", "Delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-right">
          <button type="button" onClick={onClose} className={btnOutline}>
            {t("Kapat", "Close")}
          </button>
        </div>
      </div>
      {confirmEl}
    </Modal>
  );
}

"use client";

import { TaxonomyProperty } from "@/lib/api";
import { Modal, btnGhost } from "./Modal";
import { tNow as t } from "@/lib/i18n";

export default function AddVariationDialog({
  options,
  canCreateCustom,
  onPick,
  onCreateCustom,
  onCancel,
}: {
  options: TaxonomyProperty[];
  canCreateCustom: boolean;
  onPick: (p: TaxonomyProperty) => void;
  onCreateCustom: () => void;
  onCancel: () => void;
}) {
  const chip =
    "rounded-full bg-neutral-100 px-5 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700";
  return (
    <Modal
      z={60}
      title={t("Ürünün için en fazla 3 varyasyon ekle", "Add up to 3 variations for your item")}
      footer={
        <button onClick={onCancel} className={btnGhost}>
          {t("Vazgeç", "Cancel")}
        </button>
      }
    >
      <ul className="mb-6 list-disc space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
        <li>{t("Buradaki seçenekleri kullanırsan alıcılar listing'ini arama filtreleriyle bulabilir.", "If you use these options, buyers can find your listing with search filters.")}</li>
        <li>{t("Kendi özel seçeneklerini oluşturabilirsin, ancak alıcılar bunları arama filtrelerinde göremez.", "You can create your own custom options, but buyers won't see them in search filters.")}</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <button key={o.property_id} onClick={() => onPick(o)} className={chip}>
            {o.display_name}
          </button>
        ))}
      </div>
      {canCreateCustom && (
        <button
          onClick={onCreateCustom}
          className="mt-5 flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100"
        >
          <span className="text-xl leading-none">+</span> {t("Kendi varyasyonunu oluştur", "Create your own variation")}
        </button>
      )}
    </Modal>
  );
}

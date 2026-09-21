"use client";

import { TaxonomyProperty } from "@/lib/api";
import { Modal, btnGhost } from "./Modal";

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
      title="Ürünün için en fazla 3 varyasyon ekle"
      footer={
        <button onClick={onCancel} className={btnGhost}>
          Vazgeç
        </button>
      }
    >
      <ul className="mb-6 list-disc space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
        <li>Buradaki seçenekleri kullanırsan alıcılar listing&apos;ini arama filtreleriyle bulabilir.</li>
        <li>Kendi özel seçeneklerini oluşturabilirsin, ancak alıcılar bunları arama filtrelerinde göremez.</li>
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
          <span className="text-xl leading-none">+</span> Kendi varyasyonunu oluştur
        </button>
      )}
    </Modal>
  );
}

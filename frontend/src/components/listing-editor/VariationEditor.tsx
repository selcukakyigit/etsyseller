"use client";

import { useState } from "react";
import { ListingImage, TaxonomyProperty } from "@/lib/api";
import { Modal, Switch, btnGhost, btnPrimary } from "./Modal";
import PhotoPicker from "./PhotoPicker";
import { VarProperty, cleanName, isCustom } from "./variationTypes";

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export default function VariationEditor({
  initial,
  taxDef,
  images,
  photoLocked,
  onDone,
  onCancel,
}: {
  initial: VarProperty;
  taxDef?: TaxonomyProperty;
  images: ListingImage[];
  photoLocked: boolean; // başka bir varyasyon fotoğraf bağlıyor (Etsy tek varyasyona izin verir)
  onDone: (p: VarProperty) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<VarProperty>(initial);
  const [text, setText] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null);

  const custom = isCustom(draft.property_id);
  const standard = (taxDef?.possible_values ?? []).filter((v) => !draft.values.some((x) => x.name === v.name));
  const imgUrl = (id: number | null) => images.find((i) => i.listing_image_id === id)?.url_170x135;

  function addOption(name: string, valueId: number | null = null) {
    const clean = cleanName(name);
    if (!clean || draft.values.some((v) => v.name.toLowerCase() === clean.toLowerCase())) return;
    // Yazılan isim standart bir seçenekle eşleşirse onun value_id'sini kullan.
    const std = taxDef?.possible_values.find((v) => v.name.toLowerCase() === clean.toLowerCase());
    setDraft((d) => ({
      ...d,
      values: [...d.values, { name: std?.name ?? clean, value_id: valueId ?? std?.value_id ?? null, image_id: null }],
    }));
    setText("");
  }

  function move(from: number, to: number) {
    if (from === to) return;
    setDraft((d) => {
      const values = [...d.values];
      const [item] = values.splice(from, 1);
      values.splice(to, 0, item);
      return { ...d, values };
    });
  }

  const valid = draft.property_name.trim() !== "" && draft.values.length > 0;

  return (
    <>
      <Modal
        z={60}
        title={custom ? "Özel varyasyon" : draft.property_name}
        footer={
          <>
            <button onClick={onCancel} className={btnGhost}>
              Vazgeç
            </button>
            <button
              onClick={() => onDone({ ...draft, property_name: draft.property_name.trim() })}
              disabled={!valid}
              className={btnPrimary}
            >
              Tamam
            </button>
          </>
        }
      >
        {custom && (
          <div className="mb-5">
            <label className="mb-1 block text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              Ad <span className="text-red-600">*</span>
            </label>
            <input
              value={draft.property_name}
              onChange={(e) => setDraft((d) => ({ ...d, property_name: e.target.value.replace(/[()]/g, "") }))}
              className={inputCls}
            />
          </div>
        )}

        <label className="mb-2 flex items-center gap-3">
          <Switch
            label="Bu varyasyona fotoğraf bağla"
            checked={draft.linkPhotos}
            disabled={photoLocked && !draft.linkPhotos}
            onChange={(v) => setDraft((d) => ({ ...d, linkPhotos: v }))}
          />
          <span className="text-sm text-neutral-700 dark:text-neutral-300">Bu varyasyona fotoğraf bağla</span>
        </label>
        {photoLocked && !draft.linkPhotos && (
          <p className="mb-3 text-xs text-neutral-400">Etsy yalnızca bir varyasyona fotoğraf bağlamaya izin verir.</p>
        )}

        <div className="mt-5 border-t border-neutral-100 pt-5 dark:border-neutral-800">
          <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Seçenekler{" "}
            <span className="ml-1 rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900">
              {draft.values.length}
            </span>
          </p>
          <p className="mb-3 mt-1 text-xs text-neutral-500">
            Alıcılar aşağıdaki seçeneklerden seçim yapar. En iyi bulunabilirlik için standart seçenekleri kullan; özel seçenekler
            filtrelerde görünmez.
          </p>

          <div className="mb-2 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOption(text);
                }
              }}
              placeholder="Bir seçenek yaz…"
              className={inputCls}
            />
            <button
              onClick={() => addOption(text)}
              disabled={!cleanName(text)}
              className="px-3 text-sm font-semibold text-neutral-700 disabled:opacity-40 dark:text-neutral-200"
            >
              Ekle
            </button>
          </div>

          {standard.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const o = standard.find((x) => x.value_id === Number(e.target.value));
                if (o) addOption(o.name, o.value_id);
              }}
              className={`${inputCls} mb-3`}
            >
              <option value="">Standart seçeneklerden ekle…</option>
              {standard.map((o) => (
                <option key={o.value_id} value={o.value_id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}

          <ul className="mt-3 space-y-2">
            {draft.values.map((v, i) => (
              <li
                key={v.name}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx !== null) move(dragIdx, i);
                  setDragIdx(null);
                }}
                className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <span className="cursor-grab select-none text-neutral-400" aria-hidden>
                  ☰
                </span>
                {draft.linkPhotos && (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-100 text-neutral-400 dark:bg-neutral-800">
                    {imgUrl(v.image_id) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgUrl(v.image_id)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      "🖼"
                    )}
                  </span>
                )}
                <span className="flex-1 text-sm text-neutral-800 dark:text-neutral-200">{v.name}</span>
                {draft.linkPhotos && (
                  <button
                    onClick={() => setPicking(i)}
                    className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold dark:bg-neutral-800"
                  >
                    Fotoğraf seç
                  </button>
                )}
                <button
                  onClick={() => setDraft((d) => ({ ...d, values: d.values.filter((_, j) => j !== i) }))}
                  aria-label={`${v.name} sil`}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-sm dark:bg-neutral-800"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Modal>

      {picking !== null && draft.values[picking] && (
        <PhotoPicker
          subtitle={`${draft.property_name}: ${draft.values[picking].name}`}
          images={images}
          selected={draft.values[picking].image_id}
          onCancel={() => setPicking(null)}
          onPick={(imageId) => {
            setDraft((d) => ({
              ...d,
              values: d.values.map((v, j) => (j === picking ? { ...v, image_id: imageId } : v)),
            }));
            setPicking(null);
          }}
        />
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { ListingImage, TaxonomyProperty } from "@/lib/api";
import AddVariationDialog from "./AddVariationDialog";
import { Modal, Switch, btnGhost, btnPrimary } from "./Modal";
import VariationEditor from "./VariationEditor";
import {
  CUSTOM_IDS,
  MAX_PROPERTIES,
  VarProperty,
  VarSettings,
  comboCount,
  maxCombos,
  settingsProblem,
} from "./variationTypes";

type EditorState = { index: number | null; draft: VarProperty };

const selectCls =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

// "Fiyatlar / Stok her biri için değişir" satırı: anahtar + hangi varyasyona bağlı seçimi.
function DependencyRow({
  title,
  selected,
  options,
  labelOf,
  firstId,
  onChange,
}: {
  title: string;
  selected: number[];
  options: number[][];
  labelOf: (ids: number[]) => string;
  firstId: number;
  onChange: (v: number[]) => void;
}) {
  const on = selected.length > 0;
  const known = options.some((o) => o.join() === selected.join());
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Switch label={`${title} değişir`} checked={on} onChange={(v) => onChange(v ? [firstId] : [])} />
      <span className="text-sm text-neutral-800 dark:text-neutral-200">
        <b>{title}</b> her biri için değişir
      </span>
      {on && (
        <select
          value={selected.join()}
          onChange={(e) => onChange(e.target.value.split(",").map(Number))}
          className={selectCls}
        >
          {!known && <option value={selected.join()}>{labelOf(selected)}</option>}
          {options.map((o) => (
            <option key={o.join()} value={o.join()}>
              {labelOf(o)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ToggleRow({
  title,
  checked,
  onChange,
}: {
  title: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <Switch label={`${title} değişir`} checked={checked} onChange={onChange} />
      <span className="text-sm text-neutral-800 dark:text-neutral-200">
        <b>{title}</b> değişir
      </span>
    </div>
  );
}

export default function VariationManager({
  initial,
  initialSettings,
  taxonomyProps,
  images,
  onApply,
  onCancel,
}: {
  initial: VarProperty[];
  initialSettings: VarSettings;
  taxonomyProps: TaxonomyProperty[];
  images: ListingImage[];
  onApply: (props: VarProperty[], settings: VarSettings) => void;
  onCancel: () => void;
}) {
  const [props, setProps] = useState<VarProperty[]>(initial);
  const [settings, setSettings] = useState<VarSettings>(initialSettings);
  const [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const ids = props.map((p) => p.property_id);
  const keep = (list: number[]) => list.filter((id) => ids.includes(id));
  const labelOf = (list: number[]) =>
    list.map((id) => props.find((p) => p.property_id === id)?.property_name ?? "").join(" ve ");

  const effective: VarSettings = { ...settings, price: keep(settings.price), quantity: keep(settings.quantity) };
  const anyAll =
    ids.length >= 2 &&
    (effective.price.length === ids.length ||
      effective.quantity.length === ids.length ||
      settings.skuVaries ||
      settings.readinessVaries);
  const limit = maxCombos(ids.length, anyAll);
  const problem = settingsProblem(ids.length, effective);
  const total = comboCount(props);
  const dirty = JSON.stringify([props, settings]) !== JSON.stringify([initial, initialSettings]);
  const valid = props.length > 0 && total <= limit && !problem && props.every((p) => p.values.length > 0);

  // Varyasyon eklenip çıkarılınca "tüm varyasyonlara bağlı" ayarlar yeni tüm kümeye taşınır
  // (aksi halde 3 varyasyonda 2'ye bağlı kalıp Etsy'de 400 verir).
  function changeProps(next: VarProperty[]) {
    const prevIds = ids;
    const nextIds = next.map((p) => p.property_id);
    const remap = (list: number[]) => {
      if (list.length >= 2 && prevIds.every((id) => list.includes(id))) return nextIds.length >= 2 ? nextIds : nextIds.slice(0, 1);
      const kept = list.filter((id) => nextIds.includes(id));
      return kept.length > 1 && kept.length < nextIds.length ? nextIds : kept;
    };
    setProps(next);
    setSettings((s) => ({ ...s, price: remap(s.price), quantity: remap(s.quantity) }));
  }

  const usedIds = new Set(ids);
  const taxOptions = taxonomyProps.filter((t) => t.supports_variations && !usedIds.has(t.property_id));
  const customFree = CUSTOM_IDS.find((id) => !usedIds.has(id));

  // Seçenekler: her varyasyon tek başına + (2 veya daha fazlaysa) hepsinin kombinasyonu.
  const depOptions: number[][] = [...ids.map((id) => [id]), ...(ids.length >= 2 ? [ids] : [])];

  function saveEditor(p: VarProperty) {
    if (!editor) return;
    // Etsy yalnızca tek varyasyona fotoğraf bağlamaya izin verir.
    const others = props.map((x) => (p.linkPhotos ? { ...x, linkPhotos: false } : x));
    changeProps(editor.index === null ? [...others, p] : others.map((x, i) => (i === editor.index ? p : x)));
    setEditor(null);
  }

  return (
    <>
      <Modal
        title="Varyasyonları yönet"
        footer={
          <>
            <button onClick={onCancel} className={btnGhost}>
              Vazgeç
            </button>
            <button
              onClick={() =>
                onApply(props, {
                  ...settings,
                  price: keep(settings.price),
                  quantity: keep(settings.quantity),
                })
              }
              disabled={!dirty || !valid}
              className={btnPrimary}
            >
              Uygula
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {props.map((p, i) => (
            <div
              key={p.property_id}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">{p.property_name}</p>
                <p className="mb-2 text-xs text-neutral-500">{p.values.length} seçenek</p>
                <div className="flex gap-1.5 overflow-hidden">
                  {p.values.map((v) => (
                    <span key={v.name} className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-xs dark:bg-neutral-800">
                      {v.name}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setEditor({ index: i, draft: p })}
                aria-label={`${p.property_name} düzenle`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800"
              >
                ✎
              </button>
              <button
                onClick={() => changeProps(props.filter((_, j) => j !== i))}
                aria-label={`${p.property_name} sil`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800"
              >
                🗑
              </button>
            </div>
          ))}
          {props.length === 0 && <p className="text-sm text-neutral-400">Henüz varyasyon yok.</p>}
        </div>

        <button
          onClick={() => setAdding(true)}
          disabled={props.length >= MAX_PROPERTIES}
          className="mt-4 rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-900 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100"
        >
          + Varyasyon ekle
        </button>

        <p className={`mt-3 text-xs ${total > limit ? "text-red-600" : "text-neutral-400"}`}>
          {total} kombinasyon (bu yapıda en fazla {limit}). Uygula tabloları günceller; Etsy&apos;ye &quot;Fiyat/Stok Kaydet&quot; ile gider.
        </p>
        {problem && <p className="mt-2 text-xs text-red-600">{problem}</p>}

        {props.length > 0 && (
          <div className="mt-6 space-y-5 border-t border-neutral-100 pt-6 dark:border-neutral-800">
            <DependencyRow
              title="Fiyatlar"
              selected={keep(settings.price)}
              options={depOptions}
              labelOf={labelOf}
              firstId={ids[0]}
              onChange={(v) => setSettings((s) => ({ ...s, price: v }))}
            />
            <ToggleRow
              title="İşlem profilleri"
              checked={settings.readinessVaries}
              onChange={(v) => setSettings((s) => ({ ...s, readinessVaries: v }))}
            />
            <DependencyRow
              title="Stok"
              selected={keep(settings.quantity)}
              options={depOptions}
              labelOf={labelOf}
              firstId={ids[0]}
              onChange={(v) => setSettings((s) => ({ ...s, quantity: v }))}
            />
            <ToggleRow
              title="SKU'lar"
              checked={settings.skuVaries}
              onChange={(v) => setSettings((s) => ({ ...s, skuVaries: v }))}
            />
          </div>
        )}
      </Modal>

      {adding && (
        <AddVariationDialog
          options={taxOptions}
          canCreateCustom={customFree !== undefined}
          onCancel={() => setAdding(false)}
          onPick={(t) => {
            setAdding(false);
            setEditor({
              index: null,
              draft: { property_id: t.property_id, property_name: t.display_name, scale_id: null, values: [], linkPhotos: false },
            });
          }}
          onCreateCustom={() => {
            setAdding(false);
            if (customFree !== undefined)
              setEditor({
                index: null,
                draft: { property_id: customFree, property_name: "", scale_id: null, values: [], linkPhotos: false },
              });
          }}
        />
      )}

      {editor && (
        <VariationEditor
          initial={editor.draft}
          taxDef={taxonomyProps.find((t) => t.property_id === editor.draft.property_id)}
          images={images}
          photoLocked={props.some((p, i) => p.linkPhotos && i !== editor.index)}
          onCancel={() => setEditor(null)}
          onDone={saveEditor}
        />
      )}
    </>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ListingProperty, TaxonomyProperty } from "@/lib/api";
import { tNow as t } from "@/lib/i18n";

// Etsy çok değerli özelliklerde en fazla 5 seçime izin verir (Craft, Room, Materials...).
const MAX_MULTI = 5;
// Etsy alan başına limit vermiyor; bilinen istisnalar burada.
const MAX_BY_NAME: Record<string, number> = { "material features": 1 };

const isDimension = (d: TaxonomyProperty) => d.possible_values.length === 0 && (d.scales?.length ?? 0) > 0;
const isRadio = (d: TaxonomyProperty) => !d.is_multivalued && d.possible_values.length === 2;

export type PropertyValue = { value_ids: number[]; values: string[]; scale_id: number | null };

function PropertyRow({
  def,
  current,
  onChange,
}: {
  def: TaxonomyProperty;
  current: ListingProperty | undefined;
  onChange: (value: PropertyValue | null) => void;
}) {
  const multi = def.is_multivalued;
  const max = multi ? (MAX_BY_NAME[def.display_name.toLowerCase()] ?? MAX_MULTI) : 1;
  const dimension = isDimension(def);
  const radio = isRadio(def);

  const selectedIds = current?.value_ids ?? [];
  const selected = def.possible_values.filter((v) => selectedIds.includes(v.value_id));
  const limitReached = multi && selectedIds.length >= max;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Ölçü alanı (değer + birim): yazarken yerelde tutulur, geçerli olunca taslağa yazılır.
  const [dimValue, setDimValue] = useState(current?.values?.[0] ?? "");
  const [scaleId, setScaleId] = useState<number | "">(current?.scale_id ?? "");

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? def.possible_values.filter((v) => v.name.toLowerCase().includes(q)) : def.possible_values;
  }, [def.possible_values, query]);

  function commit(ids: number[]) {
    if (ids.length === 0) return onChange(null);
    const chosen = def.possible_values.filter((v) => ids.includes(v.value_id));
    onChange({ value_ids: chosen.map((v) => v.value_id), values: chosen.map((v) => v.name), scale_id: null });
  }

  function toggle(valueId: number) {
    if (multi) {
      if (selectedIds.includes(valueId)) commit(selectedIds.filter((id) => id !== valueId));
      else if (selectedIds.length < max) commit([...selectedIds, valueId]);
    } else {
      commit(selectedIds[0] === valueId ? [] : [valueId]);
      setOpen(false);
    }
  }

  function commitDimension(text: string, scale: number | "") {
    if (text.trim() === "") return onChange(null);
    if (scale !== "") onChange({ value_ids: [], values: [text.trim()], scale_id: scale });
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2">
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
          {def.display_name}
          {def.is_required && <span className="text-red-500"> *</span>}
        </p>
        {multi && (
          <p className="text-xs text-neutral-400">
            {limitReached ? t(`En fazla ${max} seçim`, `Up to ${max} choices`) : t(`${max - selectedIds.length} tane daha seçebilirsin`, `You can pick ${max - selectedIds.length} more`)}
          </p>
        )}
      </div>

      {dimension && (
        <div className="flex gap-2">
          <input
            value={dimValue}
            onChange={(e) => {
              setDimValue(e.target.value);
              commitDimension(e.target.value, scaleId);
            }}
            inputMode="decimal"
            placeholder={t("Değer", "Value")}
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <select
            value={scaleId}
            onChange={(e) => {
              const next = e.target.value === "" ? "" : Number(e.target.value);
              setScaleId(next);
              commitDimension(dimValue, next);
            }}
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="">{t("Birim seç", "Choose unit")}</option>
            {def.scales?.map((sc) => (
              <option key={sc.scale_id} value={sc.scale_id}>
                {sc.display_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {radio && (
        <div className="flex flex-wrap gap-4">
          {def.possible_values.map((v) => (
            <label key={v.value_id} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
              <input
                type="radio"
                name={`prop-${def.property_id}`}
                checked={selectedIds[0] === v.value_id}
                onChange={() => toggle(v.value_id)}
                className="h-4 w-4 accent-neutral-900"
              />
              {v.name}
            </label>
          ))}
        </div>
      )}

      {!dimension && !radio && (
        <div ref={boxRef} className="relative">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={!multi && selected[0] ? selected[0].name : t("Ara veya seç…", "Search or choose…")}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-8 text-sm text-neutral-800 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOpen((o) => !o)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500"
            aria-label={t("Aç/kapat", "Toggle")}
          >
            ▾
          </button>

          {open && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              {filtered.length === 0 && <p className="px-3 py-2 text-sm text-neutral-400">{t("Sonuç yok", "No results")}</p>}
              {filtered.map((v) => {
                const checked = selectedIds.includes(v.value_id);
                const disabled = multi && !checked && limitReached;
                return (
                  <label
                    key={v.value_id}
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${
                      checked ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    <input
                      type={multi ? "checkbox" : "radio"}
                      name={`prop-${def.property_id}`}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(v.value_id)}
                      onClick={!multi && checked ? () => toggle(v.value_id) : undefined}
                      className="h-4 w-4 accent-neutral-900"
                    />
                    <span className="text-neutral-800 dark:text-neutral-100">{v.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!dimension && !radio && selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <span
              key={v.value_id}
              className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
            >
              {v.name}
              <button
                type="button"
                onClick={() => commit(selectedIds.filter((id) => id !== v.value_id))}
                className="text-neutral-500 hover:text-neutral-900"
                aria-label={t(`${v.name} kaldır`, `Remove ${v.name}`)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PropertyFields({
  taxonomyId,
  properties,
  onChange,
}: {
  taxonomyId: number | null;
  properties: ListingProperty[];
  onChange: (propertyId: number, value: PropertyValue | null) => void;
}) {
  const [defs, setDefs] = useState<TaxonomyProperty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!taxonomyId) return;
    api.taxonomy
      .properties(taxonomyId)
      .then((props) =>
        setDefs(props.filter((p) => p.supports_attributes && (p.possible_values.length > 0 || (p.scales?.length ?? 0) > 0)))
      )
      .catch((e) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error")));
  }, [taxonomyId]);

  const has = (id: number) => properties.some((p) => p.property_id === id);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Özellikler", "Attributes")}</h2>
      <p className="mb-4 text-xs text-neutral-400">
        {t(
          'Kategoriye özel alanlar — alıcıların filtreleyerek bulmasını sağlar. Seçimlerin taslağa otomatik kaydedilir; Etsy\'ye "Yayınla" ile gider. Varyasyon oluşturan özellikler (renk/beden gibi) Fiyat & Stok bölümünde yönetilir.',
          "Category-specific fields that help buyers find the item with filters. Your choices save to the draft automatically and go to Etsy when you publish. Attributes that create variations (like color or size) are managed under Price & Inventory.",
        )}
      </p>

      {!taxonomyId && <p className="text-sm text-neutral-400">{t("Önce bir kategori seç.", "Choose a category first.")}</p>}
      {taxonomyId && defs === null && !error && <p className="text-sm text-neutral-400">{t("Yükleniyor…", "Loading…")}</p>}
      {taxonomyId && defs && defs.length === 0 && <p className="text-sm text-neutral-400">{t("Bu kategori için ek özellik yok.", "No extra attributes for this category.")}</p>}

      <div className="space-y-2">
        {defs
          ?.filter((def) => showAll || def.is_required || has(def.property_id))
          .map((def) => (
            <PropertyRow
              key={def.property_id}
              def={def}
              current={properties.find((p) => p.property_id === def.property_id)}
              onChange={(value) => onChange(def.property_id, value)}
            />
          ))}
      </div>

      {defs && defs.length > 0 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 w-full rounded-lg border border-neutral-200 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {showAll ? t("Boş alanları gizle", "Hide empty fields") : t("Tüm özellikleri göster", "Show all attributes")}
        </button>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

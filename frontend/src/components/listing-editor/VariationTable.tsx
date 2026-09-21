"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  Inventory,
  InventoryProduct,
  ListingImage,
  ReadinessStateDefinition,
  TaxonomyProperty,
  VariationLinks,
} from "@/lib/api";
import VariationManager from "./VariationManager";
import { VarProperty, VarSettings } from "./variationTypes";

type EditableRow = {
  product: InventoryProduct;
  price: string;
  quantity: string;
  sku: string;
  readinessStateId: string;
  enabled: boolean;
};

type Field = "price" | "quantity" | "sku" | "readinessStateId";
type OnProp = { price: number[]; quantity: number[]; sku: number[]; readiness: number[] };
type Links = { propertyId: number | null; images: Record<string, number> };

const FIELDS: Field[] = ["price", "quantity", "sku", "readinessStateId"];
const LABEL: Record<Field, string> = { price: "Fiyat", quantity: "Stok", sku: "SKU", readinessStateId: "İşlem profili" };
const DEP_KEY: Record<Field, keyof OnProp> = { price: "price", quantity: "quantity", sku: "sku", readinessStateId: "readiness" };

const inputCls =
  "w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-2 py-1 outline-none focus:border-[#F1641E]";

function toRows(inventory: Inventory): EditableRow[] {
  return inventory.products.map((product) => {
    const offering = product.offerings[0];
    return {
      product,
      price: offering ? (offering.price.amount / offering.price.divisor).toFixed(2) : "0.00",
      quantity: offering ? String(offering.quantity) : "0",
      sku: product.sku ?? "",
      readinessStateId: offering?.readiness_state_id ? String(offering.readiness_state_id) : "",
      enabled: offering ? offering.is_enabled : true,
    };
  });
}

const valueKey = (p: InventoryProduct, propertyId: number) =>
  p.property_values.find((pv) => pv.property_id === propertyId)?.values.join("/") ?? "";

// Bir alanın bağlı olduğu varyasyon değerlerinin birleşik anahtarı; boşsa hepsi aynı grup.
const depKey = (p: InventoryProduct, ids: number[]) => ids.map((id) => valueKey(p, id)).join("|");

const variationLabel = (p: InventoryProduct) =>
  p.property_values.length === 0 ? "Tek ürün" : p.property_values.map((pv) => pv.values.join("/")).join(" · ");

// Aynı grupta olan satırlar ilk satırın değerini paylaşır (Etsy *_on_property kuralı).
function normalize(rows: EditableRow[], onProp: OnProp): EditableRow[] {
  const out = rows.map((r) => ({ ...r }));
  FIELDS.forEach((f) => {
    const ids = onProp[DEP_KEY[f]];
    const first = new Map<string, string>();
    out.forEach((r) => {
      const k = depKey(r.product, ids);
      if (!first.has(k)) first.set(k, r[f]);
      r[f] = first.get(k) as string;
    });
  });
  return out;
}

function ReadinessSelect({
  value,
  states,
  onChange,
}: {
  value: string;
  states: ReadinessStateDefinition[] | null;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">—</option>
      {states?.map((r) => (
        <option key={r.readiness_state_id} value={r.readiness_state_id}>
          {r.processing_days_display_label || r.readiness_state}
        </option>
      ))}
    </select>
  );
}

function FieldCell({
  field,
  value,
  states,
  onChange,
}: {
  field: Field;
  value: string;
  states: ReadinessStateDefinition[] | null;
  onChange: (v: string) => void;
}) {
  if (field === "readinessStateId") return <ReadinessSelect value={value} states={states} onChange={onChange} />;
  return <input value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
}

export default function VariationTable({
  shopId,
  inventory,
  links: linksProp,
  taxonomyId,
  images,
  onChange,
}: {
  shopId: number;
  inventory: Inventory;
  links: VariationLinks;
  taxonomyId: number | null;
  images: ListingImage[];
  /** Her değişiklikte taslağa yazılmak üzere güncel envanter + fotoğraf bağları. Etsy'ye "Yayınla" ile gider. */
  onChange: (inventory: Inventory, links: VariationLinks) => void;
}) {
  const [rows, setRows] = useState<EditableRow[]>(toRows(inventory));
  const [states, setStates] = useState<ReadinessStateDefinition[] | null>(null);
  const [managing, setManaging] = useState(false);
  const [taxProps, setTaxProps] = useState<TaxonomyProperty[]>([]);
  const [onProp, setOnProp] = useState<OnProp>({
    price: inventory.price_on_property,
    quantity: inventory.quantity_on_property,
    sku: inventory.sku_on_property,
    readiness: inventory.readiness_state_on_property ?? [],
  });
  const [links, setLinks] = useState<Links>({ propertyId: linksProp.property_id, images: linksProp.images });

  useEffect(() => {
    if (!taxonomyId) return;
    api.taxonomy.properties(taxonomyId).then(setTaxProps).catch(() => setTaxProps([]));
  }, [taxonomyId]);

  useEffect(() => {
    api.shops
      .readinessStateDefinitions(shopId)
      .then(setStates)
      .catch(() => setStates([])); // shops_r yoksa ya da profil yoksa sessizce boş bırak
  }, [shopId]);

  // Her değişiklikte (ilk render hariç) güncel envanteri üst bileşene, yani taslağa bildir.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const built = {
      products: rows.map((row) => ({
        product_id: row.product.product_id,
        sku: row.sku,
        property_values: row.product.property_values,
        offerings: [
          {
            offering_id: row.product.offerings[0]?.offering_id ?? 0,
            price: {
              amount: Math.round(parseFloat(row.price || "0") * 100),
              divisor: 100,
              currency_code: row.product.offerings[0]?.price.currency_code ?? "USD",
            },
            quantity: parseInt(row.quantity || "0", 10),
            is_enabled: row.enabled,
            readiness_state_id: row.readinessStateId ? Number(row.readinessStateId) : undefined,
          },
        ],
      })),
      price_on_property: onProp.price,
      quantity_on_property: onProp.quantity,
      sku_on_property: onProp.sku,
      readiness_state_on_property: onProp.readiness,
    } as Inventory;
    onChangeRef.current(built, { property_id: links.propertyId, images: links.images });
  }, [rows, onProp, links]);

  const properties = (rows[0]?.product.property_values ?? []).map((pv) => ({ id: pv.property_id, name: pv.property_name }));
  const dep = (f: Field) => onProp[DEP_KEY[f]];

  function updateWhere(match: (r: EditableRow) => boolean, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r) => (match(r) ? { ...r, ...patch } : r)));
  }

  // Bir alanı düzenle: aynı bağımlılık grubundaki tüm satırlara uygulanır.
  function setField(field: Field, product: InventoryProduct, value: string) {
    const ids = dep(field);
    const k = depKey(product, ids);
    updateWhere((r) => depKey(r.product, ids) === k, { [field]: value });
  }

  function currentStructure(): VarProperty[] {
    return properties.map((prop) => {
      const values: VarProperty["values"] = [];
      let scale: number | null = null;
      rows.forEach((r) => {
        const pv = r.product.property_values.find((x) => x.property_id === prop.id);
        if (!pv) return;
        scale = pv.scale_id;
        pv.values.forEach((name, i) => {
          if (!values.some((v) => v.name === name)) {
            values.push({
              name,
              value_id: pv.value_ids[i] ?? null,
              image_id: links.propertyId === prop.id ? (links.images[name] ?? null) : null,
            });
          }
        });
      });
      return { property_id: prop.id, property_name: prop.name, scale_id: scale, values, linkPhotos: links.propertyId === prop.id };
    });
  }

  const currentSettings: VarSettings = {
    price: onProp.price,
    quantity: onProp.quantity,
    skuVaries: onProp.sku.length > 0,
    readinessVaries: onProp.readiness.length > 0,
  };

  // Yeni yapıdan kartezyen çarpımla ürünleri üret; eşleşen eski satırın verisini koru.
  function applyStructure(props: VarProperty[], settings: VarSettings) {
    let combos: VarProperty["values"][] = props.length ? [[]] : [];
    props.forEach((p) => {
      combos = combos.flatMap((c) => p.values.map((v) => [...c, v]));
    });
    const template = rows[0];
    const built: EditableRow[] = combos.map((combo) => {
      const property_values = props.map((p, i) => ({
        property_id: p.property_id,
        property_name: p.property_name,
        scale_id: p.scale_id,
        value_ids: combo[i].value_id != null ? [combo[i].value_id as number] : [],
        values: [combo[i].name],
      }));
      const old = rows.find((r) =>
        props.every((p, i) => {
          const pv = r.product.property_values.find((x) => x.property_id === p.property_id);
          return !pv || pv.values.join("/") === combo[i].name;
        })
      );
      const base = old ?? template;
      return {
        product: {
          product_id: old ? old.product.product_id : 0,
          sku: base?.sku ?? "",
          offerings: old ? old.product.offerings : (template?.product.offerings ?? []).map((o) => ({ ...o, offering_id: 0 })),
          property_values,
        },
        price: base?.price ?? "0.00",
        quantity: base?.quantity ?? "0",
        sku: base?.sku ?? "",
        readinessStateId: base?.readinessStateId ?? "",
        enabled: old ? old.enabled : true,
      };
    });

    const ids = props.map((p) => p.property_id);
    const next: OnProp = {
      price: settings.price.filter((id) => ids.includes(id)),
      quantity: settings.quantity.filter((id) => ids.includes(id)),
      sku: settings.skuVaries ? ids : [],
      readiness: settings.readinessVaries ? ids : [],
    };
    setOnProp(next);
    setRows(normalize(built, next));

    const linked = props.find((p) => p.linkPhotos);
    const nextLinks: Links = {
      propertyId: linked?.property_id ?? null,
      images: linked
        ? Object.fromEntries(linked.values.filter((v) => v.image_id).map((v) => [v.name, v.image_id as number]))
        : {},
    };
    setLinks(nextLinks);
    setManaging(false);
  }

  const th = "pb-2 pr-3";
  const hasProps = properties.length > 0;
  const sharedFields = FIELDS.filter((f) => dep(f).length === 0);
  const combinedFields = FIELDS.filter((f) => dep(f).length >= 2);
  const first = rows[0];

  function renderPropertyTable(prop: { id: number; name: string }) {
    const keys = Array.from(new Set(rows.map((r) => valueKey(r.product, prop.id))));
    const cols = FIELDS.filter((f) => dep(f).length === 1 && dep(f)[0] === prop.id);
    return (
      <div key={prop.id} className="mb-6">
        <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{prop.name}</p>
        <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">{keys.length} seçenek</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 dark:text-neutral-500">
                <th className={th}>{prop.name}</th>
                {cols.map((f) => (
                  <th key={f} className={`${th} w-32`}>
                    {LABEL[f]}
                  </th>
                ))}
                <th className="w-20 pb-2">Görünür</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const match = (r: EditableRow) => valueKey(r.product, prop.id) === key;
                const row = rows.find(match) as EditableRow;
                const visible = rows.some((r) => match(r) && r.enabled);
                return (
                  <tr key={key} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-2 pr-3 text-neutral-600 dark:text-neutral-300">{key}</td>
                    {cols.map((f) => (
                      <td key={f} className="py-2 pr-3">
                        <FieldCell field={f} value={row[f]} states={states} onChange={(v) => setField(f, row.product, v)} />
                      </td>
                    ))}
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={(e) => updateWhere(match, { enabled: e.target.checked })}
                        aria-label={`${key} görünür`}
                        className="h-4 w-4 accent-[#F1641E]"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderCombinedTable() {
    return (
      <div className="mb-6">
        <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Kombinasyonlar</p>
        <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
          Bu alanlar birden fazla varyasyonun birleşimine göre değişir.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 dark:text-neutral-500">
                <th className={th}>Kombinasyon</th>
                {combinedFields.map((f) => (
                  <th key={f} className={`${th} w-32`}>
                    {LABEL[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={variationLabel(row.product)} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-600 dark:text-neutral-300">{variationLabel(row.product)}</td>
                  {combinedFields.map((f) => (
                    <td key={f} className="py-2 pr-3">
                      <FieldCell field={f} value={row[f]} states={states} onChange={(v) => setField(f, row.product, v)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Fiyat &amp; Stok</h2>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Değişikliklerin taslağa otomatik kaydedilir; Etsy&apos;ye &quot;Yayınla&quot; ile gider. Varyasyon eklemek, silmek veya
            fiyat/stoğun neye göre değiştiğini seçmek için &quot;Varyasyonları yönet&quot;i kullan.
          </p>
        </div>
        <button
          onClick={() => setManaging(true)}
          className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          Varyasyonları yönet
        </button>
      </div>

      {first && sharedFields.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {sharedFields.map((f) => (
            <label key={f} className="text-xs text-neutral-400 dark:text-neutral-500">
              {LABEL[f]}
              {hasProps ? " (tümü)" : ""}
              <div className="mt-1">
                <FieldCell field={f} value={first[f]} states={states} onChange={(v) => setField(f, first.product, v)} />
              </div>
            </label>
          ))}
          {!hasProps && (
            <label className="flex items-end gap-2 pb-1 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={first.enabled}
                onChange={(e) => updateWhere(() => true, { enabled: e.target.checked })}
                className="h-4 w-4 accent-[#F1641E]"
              />
              Görünür
            </label>
          )}
        </div>
      )}

      {properties.map(renderPropertyTable)}
      {combinedFields.length > 0 && renderCombinedTable()}

      {!rows.some((r) => r.enabled) && (
        <p className="mt-2 text-sm text-red-600">Etsy&apos;de yayınlamak için en az bir varyasyon görünür olmalı.</p>
      )}

      {managing && (
        <VariationManager
          initial={currentStructure()}
          initialSettings={currentSettings}
          taxonomyProps={taxProps}
          images={images}
          onApply={applyStructure}
          onCancel={() => setManaging(false)}
        />
      )}
    </section>
  );
}

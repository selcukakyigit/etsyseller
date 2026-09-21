"use client";

import { useEffect, useMemo, useState } from "react";
import { api, TaxonomyNode } from "@/lib/api";

type FlatNode = { id: number; name: string; parent: string; path: string };

function flatten(nodes: TaxonomyNode[], prefix = ""): FlatNode[] {
  return nodes.flatMap((node) => {
    const path = prefix ? `${prefix} > ${node.name}` : node.name;
    const self: FlatNode = { id: node.id, name: node.name, parent: prefix, path };
    return node.children?.length ? [self, ...flatten(node.children, path)] : [self];
  });
}

export default function CategoryPicker({
  shopId,
  taxonomyId,
  onChange,
}: {
  shopId?: number;
  taxonomyId: number | null;
  onChange: (id: number, path: string) => void;
}) {
  const [nodes, setNodes] = useState<FlatNode[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topIds, setTopIds] = useState<number[]>([]);

  useEffect(() => {
    api.taxonomy
      .nodes()
      .then((tree) => setNodes(flatten(tree)))
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, []);

  useEffect(() => {
    if (shopId === undefined) return;
    api.listings
      .topCategories(shopId)
      .then((r) => setTopIds(r.map((x) => x.taxonomy_id)))
      .catch(() => undefined);
  }, [shopId]);

  const top = useMemo(
    () => topIds.map((id) => nodes?.find((n) => n.id === id)).filter((n): n is FlatNode => !!n),
    [topIds, nodes]
  );

  const selected = useMemo(() => nodes?.find((n) => n.id === taxonomyId) ?? null, [nodes, taxonomyId]);

  // Etsy'nin API'sinde arama ucu yok (yalnızca tüm ağaç var); arama burada yapılır.
  // Sıralama: ad tam eşleşme > ad başlangıcı > addaki kelime > yolda geçen.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!nodes || q.length < 2) return [];
    const words = q.split(/\s+/);
    const scored: { n: FlatNode; score: number }[] = [];
    for (const n of nodes) {
      const name = n.name.toLowerCase();
      const path = n.path.toLowerCase();
      if (!words.every((w) => path.includes(w))) continue;
      let score = 4;
      if (name === q) score = 0;
      else if (name.startsWith(q)) score = 1;
      else if (words.every((w) => name.includes(w))) score = 2;
      else if (name.includes(words[0])) score = 3;
      scored.push({ n, score });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.n.path.length - b.n.path.length)
      .slice(0, 12)
      .map((x) => x.n);
  }, [nodes, query]);

  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500 mb-1">Kategori</label>
      <div className="relative">
        <input
          value={open ? query : selected?.path ?? ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Kategori ara (en az 2 karakter)…"
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
        />
        {open && filtered.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
            {filtered.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onMouseDown={() => {
                    onChange(n.id, n.path);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left transition hover:bg-neutral-50"
                >
                  <span className="block text-sm text-neutral-900">{n.name}</span>
                  {n.parent && <span className="block truncate text-xs text-neutral-400">{n.parent}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {top.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
          Sık kullandığın kategoriler:
          {top.map((n) => (
            <button
              key={n.id}
              type="button"
              title={n.path}
              onClick={() => onChange(n.id, n.path)}
              className="font-medium text-neutral-800 hover:text-[#F1641E]"
            >
              + {n.name}
            </button>
          ))}
        </p>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

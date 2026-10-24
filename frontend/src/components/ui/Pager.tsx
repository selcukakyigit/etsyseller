"use client";

/** İlk, son, mevcut sayfa ve komşularını verir; aradaki boşlukları "…" ile işaretler — 10-20 sayfada
 * sorun olmayan "hepsini bas" yaklaşımı, 60-70+ sayfada (ör. yorumlar) tek satıra sığmayan, kullanılamaz
 * bir buton yığınına dönüşüyordu. */
function pageWindow(page: number, pages: number): (number | "…")[] {
  const keep = new Set<number>([0, pages - 1, page]);
  if (page > 0) keep.add(page - 1);
  if (page < pages - 1) keep.add(page + 1);
  const sorted = [...keep].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className="rounded-full px-3 py-1.5 text-sm disabled:opacity-30">
        ←
      </button>
      {pageWindow(page, pages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-neutral-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            className={`h-8 w-9 rounded-full text-sm ${p === page ? "border border-neutral-900 dark:border-neutral-100" : "bg-neutral-100 dark:bg-neutral-800"}`}
          >
            {p + 1}
          </button>
        )
      )}
      <button type="button" disabled={page === pages - 1} onClick={() => onPage(page + 1)} className="rounded-full px-3 py-1.5 text-sm disabled:opacity-30">
        →
      </button>
    </div>
  );
}

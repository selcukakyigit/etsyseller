"use client";

/** Bir sekmenin içindeki alt sekmeler (ör. Ürünler › Yeni / İşlenmiş). Üst sekmelerden ayrışsın diye altı çizgili ve küçüktür;
 * her sekmede varsa adet gösterilir. */
export default function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="mb-4 flex gap-5 border-b border-neutral-200 dark:border-neutral-800">
      {tabs.map((x) => {
        const active = x.id === value;
        return (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(x.id)}
            className={`-mb-px border-b-2 pb-2 text-sm font-medium transition ${
              active ? "border-[#D97757] text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {x.label}
            {x.count !== undefined && <span className="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{x.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

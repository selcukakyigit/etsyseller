"use client";

/** Kargo firması için sabit renkli rozet: aynı firma her yerde aynı renkte görünür. Bilinen firmaların rengi sabit, diğerleri adından türetilir. */
const KNOWN: [RegExp, string][] = [
  [/shipentegra/, "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"],
  [/fedex/, "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300"],
  [/\bdhl\b/, "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"],
  [/navlungo/, "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"],
  [/\bups\b/, "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200"],
  [/usps/, "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"],
];
const FALLBACK = [
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
];

export const KNOWN_CARRIERS = ["ShipEntegra", "FedEx", "DHL", "Navlungo", "UPS", "USPS"];

export function vendorTone(name: string): string {
  const n = name.trim().toLowerCase();
  const hit = KNOWN.find(([re]) => re.test(n));
  if (hit) return hit[1];
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

export default function VendorBadge({ name, className = "" }: { name: string; className?: string }) {
  if (!name.trim()) return <span className="text-neutral-400">—</span>;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${vendorTone(name)} ${className}`}>{name}</span>;
}

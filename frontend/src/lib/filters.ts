/** Varsayılandan farklı filtre alanı sayısı (mobil "Filtreler" düğmesindeki rozet). */
export function changedCount<T extends object>(current: T, base: T): number {
  return (Object.keys(base) as (keyof T)[]).filter((k) => current[k] !== base[k]).length;
}

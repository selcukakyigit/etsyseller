/** Tarih aralığı seçimlerinin tek kaynağı: hazır dönemlerin adı ve tarih aralığı. Tüm tarih filtreleri
 * (components/ui/DateRangePicker) buradan okur. Tarihler yerel gün olarak "YYYY-AA-GG". */

export type DateRange = { start: string; end: string };

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parseDay = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 864e5));

/** Hazır dönemler. Kimlikler sayfalarda tarayıcıda saklandığı için değiştirilmemeli. */
export const PRESETS = {
  today: { label: ["Bugün", "Today"], range: (): DateRange => ({ start: isoDay(new Date()), end: isoDay(new Date()) }) },
  yesterday: { label: ["Dün", "Yesterday"], range: (): DateRange => ({ start: daysAgo(1), end: daysAgo(1) }) },
  "7d": { label: ["Son 7 gün", "Last 7 days"], range: (): DateRange => ({ start: daysAgo(6), end: isoDay(new Date()) }) },
  "30d": { label: ["Son 30 gün", "Last 30 days"], range: (): DateRange => ({ start: daysAgo(29), end: isoDay(new Date()) }) },
  "90d": { label: ["Son 90 gün", "Last 90 days"], range: (): DateRange => ({ start: daysAgo(89), end: isoDay(new Date()) }) },
  month: {
    label: ["Bu ay", "This month"],
    range: (): DateRange => {
      const n = new Date();
      return { start: isoDay(new Date(n.getFullYear(), n.getMonth(), 1)), end: isoDay(n) };
    },
  },
  last_month: {
    label: ["Geçen ay", "Last month"],
    range: (): DateRange => {
      const n = new Date();
      return { start: isoDay(new Date(n.getFullYear(), n.getMonth() - 1, 1)), end: isoDay(new Date(n.getFullYear(), n.getMonth(), 0)) };
    },
  },
  ytd: {
    label: ["Bu yıl", "This year"],
    range: (): DateRange => {
      const n = new Date();
      return { start: isoDay(new Date(n.getFullYear(), 0, 1)), end: isoDay(n) };
    },
  },
  last12: {
    label: ["Son 12 ay", "Last 12 months"],
    range: (): DateRange => {
      const n = new Date();
      return { start: isoDay(new Date(n.getFullYear() - 1, n.getMonth() + 1, 1)), end: isoDay(n) };
    },
  },
} as const;

export type PresetId = keyof typeof PRESETS;

export function presetRange(id: string): DateRange | null {
  return id in PRESETS ? PRESETS[id as PresetId].range() : null;
}

export function yearRange(year: number): DateRange {
  return { start: isoDay(new Date(year, 0, 1)), end: isoDay(new Date(year, 11, 31)) };
}

"use client";

import { useState } from "react";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { Popover, menuBox, menuItem } from "@/components/ui/Popover";
import { DateRange, PRESETS, PresetId, isoDay, parseDay } from "@/lib/dateRanges";
import { useT } from "@/lib/i18n-client";

/** Projedeki tüm tarih filtrelerinin ortak bileşeni: hazır dönemler açılır menüde, "Özel aralık…" takvimli bir pencere açar
 * ve Uygula ile seçilir. Seçenekleri sayfa verir (`presetOptions` ile hazır dönemlerden ya da kendi seçenekleriyle). */

export type RangeOption = {
  id: string;
  label: string;
  /** null: "Tüm zamanlar" gibi aralığı olmayan seçenek. */
  range: DateRange | null;
};

export const CUSTOM = "custom";

/** Hazır dönem kimliklerinden seçenek listesi. */
export function presetOptions(ids: PresetId[], t: (tr: string, en: string) => string): RangeOption[] {
  return ids.map((id) => ({ id, label: t(PRESETS[id].label[0], PRESETS[id].label[1]), range: PRESETS[id].range() }));
}

const triggerClass =
  "inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

export default function DateRangePicker({
  value,
  options,
  custom,
  onChange,
  label,
  maxDate,
  className = "",
}: {
  /** Seçili seçeneğin kimliği ya da "custom". */
  value: string;
  options: RangeOption[];
  /** "custom" seçiliyken gösterilen aralık. */
  custom: DateRange | null;
  /** Seçilen seçenek ve aralığı (Tüm zamanlar için null). */
  onChange: (id: string, range: DateRange | null) => void;
  label: string;
  /** Seçilebilecek son gün (varsayılan bugün). */
  maxDate?: string;
  className?: string;
}) {
  const { t, locale } = useT();
  const [picking, setPicking] = useState(false);
  const selected = value === CUSTOM ? null : options.find((o) => o.id === value);
  const range = value === CUSTOM ? custom : selected?.range ?? null;
  const name = value === CUSTOM ? t("Özel aralık", "Custom range") : selected?.label ?? label;
  const summary = range ? formatRange(range, locale) : "";

  return (
    <>
      <Popover
        label={label}
        className={`${triggerClass} ${className}`}
        button={
          <>
            <span className="min-w-0 truncate">
              {name}
              {summary && <span className="text-neutral-500 dark:text-neutral-400"> ({summary})</span>}
            </span>
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 flex-shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden>
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </>
        }
      >
        {(close) => (
          <div role="menu" className={`${menuBox.replace("right-0", "left-0")} w-64`}>
            {[...options, { id: CUSTOM, label: t("Özel aralık…", "Custom range…"), range: null }].map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={value === o.id}
                onClick={() => {
                  close();
                  if (o.id === CUSTOM) setPicking(true);
                  else onChange(o.id, o.range);
                }}
                className={`${menuItem} ${value === o.id ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
              >
                {o.label}
                {value === o.id && <span className="text-[#D97757]">✓</span>}
              </button>
            ))}
          </div>
        )}
      </Popover>
      {picking && (
        <RangeDialog
          initial={range ?? null}
          maxDate={maxDate ?? isoDay(new Date())}
          onCancel={() => setPicking(false)}
          onApply={(r) => {
            setPicking(false);
            onChange(CUSTOM, r);
          }}
        />
      )}
    </>
  );
}

export function formatRange(r: DateRange, locale: string): string {
  const s = parseDay(r.start);
  const e = parseDay(r.end);
  if (!s || !e) return "";
  const thisYear = new Date().getFullYear();
  const withYear = s.getFullYear() !== thisYear || e.getFullYear() !== thisYear;
  const fmt = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return r.start === r.end ? fmt(s) : `${fmt(s)} – ${fmt(e)}`;
}

function RangeDialog({ initial, maxDate, onCancel, onApply }: { initial: DateRange | null; maxDate: string; onCancel: () => void; onApply: (r: DateRange) => void }) {
  const { t, lang, locale } = useT();
  const [start, setStart] = useState(initial?.start ?? "");
  const [end, setEnd] = useState(initial?.end ?? "");
  const [view, setView] = useState(() => {
    const d = parseDay(initial?.end ?? "") ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const valid = !!parseDay(start) && (!end || (!!parseDay(end) && start <= end)) && start <= maxDate && (!end || end <= maxDate);

  function pick(day: string) {
    if (!start || end) {
      setStart(day);
      setEnd("");
    } else if (day < start) {
      setStart(day);
    } else {
      setEnd(day);
    }
  }

  // Haftanın ilk günü: Türkçede pazartesi, İngilizcede pazar.
  const weekStart = lang === "tr" ? 1 : 0;
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => new Date(view.getFullYear(), view.getMonth(), 1 - offset + i));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + ((i + weekStart) % 7)).toLocaleDateString(locale, { weekday: "short" }));
  const monthTitle = view.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const canNext = isoDay(new Date(view.getFullYear(), view.getMonth() + 1, 1)) <= maxDate;
  const inputCls =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";

  return (
    <Modal
      z={100}
      widthClass="max-w-md"
      title={t("Tarih aralığı seç", "Pick your date range")}
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button type="button" disabled={!valid} onClick={() => onApply({ start, end: end || start })} className={`${btnPrimary} disabled:opacity-50`}>
            {t("Uygula", "Apply")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("Başlangıç", "From")}
            <input type="date" value={start} max={end || maxDate} onChange={(e) => setStart(e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("Bitiş", "To")}
            <input type="date" value={end} min={start || undefined} max={maxDate} onChange={(e) => setEnd(e.target.value)} className={`${inputCls} mt-1`} />
          </label>
        </div>

        <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              aria-label={t("Önceki ay", "Previous month")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              ‹
            </button>
            <span className="text-sm font-semibold capitalize text-neutral-900 dark:text-neutral-100">{monthTitle}</span>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              aria-label={t("Sonraki ay", "Next month")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {weekdays.map((w, i) => (
              <span key={i} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 text-center text-sm">
            {cells.map((d) => {
              const day = isoDay(d);
              const disabled = day > maxDate;
              const edge = day === start || day === (end || start);
              const inside = !!start && !!end && day > start && day < end;
              const outside = d.getMonth() !== view.getMonth();
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(day)}
                  aria-pressed={edge}
                  className={`h-9 tabular-nums transition ${
                    edge
                      ? "bg-[#D97757] font-semibold text-white"
                      : inside
                        ? "bg-[#D97757]/15 text-neutral-900 dark:text-neutral-100"
                        : disabled
                          ? "text-neutral-300 dark:text-neutral-700"
                          : outside
                            ? "text-neutral-400 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:bg-neutral-800"
                            : "text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("Önce başlangıç, sonra bitiş gününe tıkla. Tek gün için yalnızca başlangıcı seçmen yeterli.", "Click the start day, then the end day. For a single day, just pick the start.")}
        </p>
      </div>
    </Modal>
  );
}

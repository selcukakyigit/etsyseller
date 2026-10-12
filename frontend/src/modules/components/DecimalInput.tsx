"use client";

import { InputHTMLAttributes, ReactNode, useState } from "react";

/** Yazılanlardan yalnızca rakamları ve ilk ondalık ayracı (nokta ya da virgül) bırakır. */
export function cleanDecimal(text: string): string {
  const digits = text.replace(/[^0-9.,]/g, "");
  const at = digits.search(/[.,]/);
  return at < 0 ? digits : digits.slice(0, at + 1) + digits.slice(at + 1).replace(/[.,]/g, "");
}

type Own = { unit?: ReactNode };
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "inputMode" | "type">;

/** Kutunun sağ kenarında duran birim/para simgesi ("₺", "$", "mm"). Genişlik sınıfı (`w-…`) kutudan dış sarmalayıcıya taşınır. */
function WithUnit({ unit, className = "", children }: { unit: ReactNode; className?: string; children: (className: string) => ReactNode }) {
  if (unit === undefined || unit === null || unit === "") return <>{children(className)}</>;
  const width = className.match(/(?:^|\s)(w-\S+)/)?.[1] ?? "w-full";
  return (
    <span className={`relative inline-block ${width}`}>
      {children(`${className.replace(/(?:^|\s)w-\S+/, "")} w-full pr-8`)}
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-neutral-400 dark:text-neutral-500">{unit}</span>
    </span>
  );
}

/** Sayı kutusu: harf ve başka karakter yazılamaz (fiyat, miktar, ölçü). Değer metin olarak tutulur; boş = girilmemiş.
 * `unit` verilirse kutunun içinde sağda gösterilir (fiyatlarda para simgesi). */
export default function DecimalInput({ value, onValue, unit, className, ...rest }: { value: string; onValue: (v: string) => void } & Own & InputProps) {
  return (
    <WithUnit unit={unit} className={className}>
      {(cls) => <input {...rest} className={cls} value={value} onChange={(e) => onValue(cleanDecimal(e.target.value))} inputMode="decimal" />}
    </WithUnit>
  );
}

/** Sayı (number) tutan durum için sayı kutusu: yazarken "1," ya da "1.50" gibi ara metinler korunur, üst duruma yalnızca geçerli sayı gider. */
export function NumberInput({ value, onValue, unit, className, ...rest }: { value: number; onValue: (v: number) => void } & Own & InputProps) {
  const [text, setText] = useState<string | null>(null);
  const shown = text !== null && Number(text.replace(",", ".")) === value ? text : String(value);
  return (
    <WithUnit unit={unit} className={className}>
      {(cls) => (
        <input
          {...rest}
          className={cls}
          value={shown}
          inputMode="decimal"
          onChange={(e) => {
            const next = cleanDecimal(e.target.value);
            setText(next);
            const n = Number(next.replace(",", "."));
            onValue(Number.isFinite(n) ? n : 0);
          }}
          onBlur={(e) => {
            setText(null);
            rest.onBlur?.(e);
          }}
        />
      )}
    </WithUnit>
  );
}

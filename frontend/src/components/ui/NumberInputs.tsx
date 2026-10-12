"use client";

import { InputHTMLAttributes, ReactNode, useState } from "react";

/**
 * Sayı kutuları: önemli alanlarda (fiyat, kredi, miktar, ölçü, süre) harf ve başka karakter yazılamaz. Her sayı alanı bunlardan birini kullanır:
 *  - `IntegerInput`: yalnızca rakam (kredi, adet, varyant no., sıra).
 *  - `SignedIntegerInput`: başında eksi olabilen tam sayı (bakiye düzeltmesi: +100 / −50).
 *  - `DecimalInput`: rakam ve tek ondalık ayracı (ölçü, miktar); değer metin olarak tutulur, boş = girilmemiş.
 *  - `MoneyInput`: fiyat; en çok `decimals` ondalık yazılır, kutudan çıkınca "9.9" → "9.90" biçimlenir.
 *  - `NumberInput`: sayı (number) tutan durum için; yazarken "1." gibi ara metinler korunur.
 * `unit` verilirse kutunun içinde sağda gösterilir (para simgesi, "mm"…).
 */

/** Yazılanlardan yalnızca rakamları ve ilk ondalık ayracı (nokta ya da virgül) bırakır. */
export function cleanDecimal(text: string): string {
  const digits = text.replace(/[^0-9.,]/g, "");
  const at = digits.search(/[.,]/);
  return at < 0 ? digits : digits.slice(0, at + 1) + digits.slice(at + 1).replace(/[.,]/g, "");
}

/** Rakamlar, tek ondalık ayracı ve yalnızca başta bir eksi işareti (yüzde/tutar farkı: -5, 10.5). */
export const cleanSignedDecimal = (text: string): string => (text.startsWith("-") ? "-" : "") + cleanDecimal(text);

/** Yalnızca rakamlar. */
export const cleanInteger = (text: string): string => text.replace(/\D/g, "");

/** Rakamlar ve yalnızca başta bir eksi işareti. */
export const cleanSigned = (text: string): string => (text.startsWith("-") ? "-" : "") + cleanInteger(text);

type Own = { unit?: ReactNode };
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "inputMode" | "type">;

/** Kutunun sağ kenarında duran birim/para simgesi. Genişlik sınıfı (`w-…`) kutudan dış sarmalayıcıya taşınır. */
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

export function IntegerInput({ value, onValue, unit, className, ...rest }: { value: string; onValue: (v: string) => void } & Own & InputProps) {
  return (
    <WithUnit unit={unit} className={className}>
      {(cls) => <input {...rest} className={cls} value={value} onChange={(e) => onValue(cleanInteger(e.target.value))} inputMode="numeric" />}
    </WithUnit>
  );
}

export function SignedIntegerInput({ value, onValue, unit, className, ...rest }: { value: string; onValue: (v: string) => void } & Own & InputProps) {
  return (
    <WithUnit unit={unit} className={className}>
      {(cls) => <input {...rest} className={cls} value={value} onChange={(e) => onValue(cleanSigned(e.target.value))} inputMode="numeric" />}
    </WithUnit>
  );
}

export default function DecimalInput({ value, onValue, unit, className, ...rest }: { value: string; onValue: (v: string) => void } & Own & InputProps) {
  return (
    <WithUnit unit={unit} className={className}>
      {(cls) => <input {...rest} className={cls} value={value} onChange={(e) => onValue(cleanDecimal(e.target.value))} inputMode="decimal" />}
    </WithUnit>
  );
}

/** Fiyat kutusu: ayraç her zaman nokta, en çok `decimals` ondalık; kutudan çıkınca ondalıklar tamamlanır ("1250" → "1250.00"). */
export function MoneyInput({ value, onValue, decimals = 2, unit, className, onBlur, ...rest }: { value: string; onValue: (v: string) => void; decimals?: number } & Own & InputProps) {
  const clamp = (text: string) => {
    const [whole, frac] = cleanDecimal(text).replace(",", ".").split(".");
    return frac === undefined ? whole : `${whole}.${frac.slice(0, decimals)}`;
  };
  return (
    <WithUnit unit={unit} className={className}>
      {(cls) => (
        <input
          {...rest}
          className={cls}
          value={value}
          inputMode="decimal"
          onChange={(e) => onValue(clamp(e.target.value))}
          onBlur={(e) => {
            const n = Number(value);
            if (value !== "" && Number.isFinite(n)) onValue(n.toFixed(decimals));
            onBlur?.(e);
          }}
        />
      )}
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

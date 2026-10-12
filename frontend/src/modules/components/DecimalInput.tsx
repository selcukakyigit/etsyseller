"use client";

import { InputHTMLAttributes } from "react";

/** Yazılanlardan yalnızca rakamları ve ilk ondalık ayracı (nokta ya da virgül) bırakır. */
export function cleanDecimal(text: string): string {
  const digits = text.replace(/[^0-9.,]/g, "");
  const at = digits.search(/[.,]/);
  return at < 0 ? digits : digits.slice(0, at + 1) + digits.slice(at + 1).replace(/[.,]/g, "");
}

/** Sayı kutusu: harf ve başka karakter yazılamaz (fiyat, miktar, ölçü). Değer metin olarak tutulur; boş = girilmemiş. */
export default function DecimalInput({ value, onValue, ...rest }: { value: string; onValue: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "inputMode" | "type">) {
  return <input {...rest} value={value} onChange={(e) => onValue(cleanDecimal(e.target.value))} inputMode="decimal" />;
}

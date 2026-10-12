"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n-client";
import { modkitApi } from "../core/api";
import { input } from "../core/ui";

// Liste sunucudan bir kez alınır (tek kaynak: backend/app/modkit/currencies.py); ağ hatasında en yaygınlar gösterilir.
const FALLBACK = ["TRY", "USD", "EUR", "GBP"];
let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function loadCurrencies(): Promise<string[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= modkitApi
    .currencies()
    .then((r) => (cache = r.items))
    .catch(() => FALLBACK)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const names: Record<string, Intl.DisplayNames> = {};
function currencyName(code: string, locale: string): string {
  try {
    return (names[locale] ??= new Intl.DisplayNames([locale], { type: "currency" })).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Para birimi seçici: modüllerin ortak bileşeni. Yalnızca maliyeti çevrilebilen (kuru bulunan) birimler listelenir. */
export default function CurrencySelect({
  value,
  onChange,
  disabled,
  className = "",
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const { t, locale } = useT();
  const [items, setItems] = useState<string[]>(cache ?? FALLBACK);
  useEffect(() => {
    let alive = true;
    void loadCurrencies().then((list) => alive && setItems(list));
    return () => {
      alive = false;
    };
  }, []);
  // Kayıtlı değer listede yoksa (eski kayıt) yine de görünsün.
  const options = items.includes(value) ? items : [value, ...items];
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${input} ${className}`} aria-label={t("Para birimi", "Currency")}>
      {options.map((c) => (
        <option key={c} value={c}>
          {c} — {currencyName(c, locale)}
        </option>
      ))}
    </select>
  );
}

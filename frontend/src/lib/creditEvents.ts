/**
 * Kredi olayları: bir AI isteği "kredi yetersiz" (402) dönünce `request()` olayı yayar, `CreditRequiredModal` dinleyip kullanıcıyı "kredi al"a
 * yönlendirir. Kredi harcayan ya da satın alınan her işlem sonrası rozetin bakiyesi `CREDITS_CHANGED` ile tazelenir.
 */
const REQUIRED = "credit-required";
const CHANGED = "credits-changed";

export function emitCreditRequired(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REQUIRED));
}

export function onCreditRequired(cb: () => void): () => void {
  window.addEventListener(REQUIRED, cb);
  return () => window.removeEventListener(REQUIRED, cb);
}

/** Kredi harcayabilen (AI) uç noktaların yolları: başarılı bir POST/PUT sonrası rozet bakiyesi tazelenir. */
const SPENDS = /\/(assistant|suggest|generate|alt-text|documents|analyze)\b/;

export function spendsCredits(path: string): boolean {
  return SPENDS.test(path);
}

export function emitCreditsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export function onCreditsChanged(cb: () => void): () => void {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

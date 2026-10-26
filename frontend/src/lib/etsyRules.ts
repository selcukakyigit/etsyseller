"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";

/**
 * Etsy'nin listing yazma kuralları (izin verilen karakterler, sınırlar). Kaynak backend'dir (`app/listings/etsy_rules.py`, GET /api/etsy-rules):
 * düzenleyici formu Etsy'nin reddedeceği değeri girişte temizler ya da uyarır; burada kural yazılmaz, yalnızca sunucunun verdiği kümeler uygulanır.
 * Kurallar yüklenemezse giriş serbest kalır, yayın öncesi denetim (sunucu) yine durdurur.
 */
export type EtsyRules = {
  title: { max_len: number; allowed: string; once_only: string };
  tag: { max_count: number; max_len: number; allowed: string };
  material: { max_count: number; allowed: string };
  style: { max_count: number; max_len: number; allowed: string };
  alt_text_max: number;
};

let loaded: Promise<EtsyRules> | null = null;

export function loadEtsyRules(): Promise<EtsyRules> {
  loaded ??= apiRequest<EtsyRules>("/api/etsy-rules").catch((e) => {
    loaded = null; // bir sonraki kullanımda yeniden denenir
    throw e;
  });
  return loaded;
}

export function useEtsyRules(): EtsyRules | null {
  const [rules, setRules] = useState<EtsyRules | null>(null);
  useEffect(() => {
    let off = false;
    loadEtsyRules()
      .then((r) => {
        if (!off) setRules(r);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);
  return rules;
}

const squash = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");
const strip = (text: string, allowed: string) => squash(text.replace(new RegExp(`[^${allowed}]`, "gu"), " "));

/** Etiket: izin verilmeyen karakterler çıkar ("metal sign!" → "metal sign"); tipografik kesme işareti düzeltilir. */
export const cleanTag = (text: string, rules: EtsyRules) => strip(text.replace(/[’‘]/g, "'"), rules.tag.allowed);

/** Materyal/stil: yalnızca harf, rakam, boşluk ("powder-coated" → "powder coated", kesme işareti silinir). */
export const cleanWord = (text: string, rules: EtsyRules, kind: "material" | "style") => strip(text.replace(/['’‘]/g, ""), rules[kind].allowed);

/** Başlık: izin verilmeyen karakterler çıkar; `% : & +` karakterlerinin yalnızca ilki kalır. */
export function cleanTitle(text: string, rules: EtsyRules): string {
  const seen = new Set<string>();
  let out = "";
  for (const c of strip(text, rules.title.allowed)) {
    if (rules.title.once_only.includes(c)) {
      if (seen.has(c)) {
        out += " ";
        continue;
      }
      seen.add(c);
    }
    out += c;
  }
  return squash(out);
}

/** Başlıkta Etsy'nin reddedeceği bir şey varsa kısa açıklama, yoksa null. `t`: (tr, en) çevirici. */
export function titleProblem(title: string, rules: EtsyRules, t: (tr: string, en: string) => string): string | null {
  if (title.length > rules.title.max_len) return t(`Başlık en fazla ${rules.title.max_len} karakter olabilir.`, `The title can be at most ${rules.title.max_len} characters.`);
  if (cleanTitle(title, rules) === squash(title)) return null;
  const repeated = [...rules.title.once_only].filter((c) => title.split(c).length > 2);
  return repeated.length
    ? t(`${repeated.join(" ")} karakteri başlıkta en fazla bir kez kullanılabilir.`, `${repeated.join(" ")} can be used only once in the title.`)
    : t("Başlıkta Etsy'nin kabul etmediği karakterler var (ör. simge ya da emoji).", "The title has characters Etsy does not accept (such as symbols or emoji).");
}

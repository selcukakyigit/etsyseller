"use client";

import { BlockSpinner } from "@/components/ui/Spinner";
import { T, useT } from "@/lib/i18n-client";
import { Activity } from "../core/api";
import { muted } from "../core/ui";
import { money } from "../core/units";

type Data = Record<string, unknown>;
export type ActivityText = (d: Data, t: T, locale: string) => string;

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** Ortak olayların iki dilli metni. Modüller kendi olaylarını `extra` ile ekler. */
export const BASE_TEXTS: Record<string, ActivityText> = {
  created: (d, t) => t(`"${s(d.name)}" oluşturuldu`, `"${s(d.name)}" was created`),
  updated: (_d, t) => t("Ayarlar güncellendi", "Settings updated"),
  archived: (_d, t) => t("Arşivlendi", "Archived"),
  restored: (_d, t) => t("Arşivden çıkarıldı", "Restored from archive"),
  price_item_added: (d, t, l) => {
    const p = new Intl.NumberFormat(l, { maximumFractionDigits: 4 }).format(num(d.price));
    return t(`Fiyat listesine eklendi: ${s(d.item)} (${p})`, `Added to price list: ${s(d.item)} (${p})`);
  },
  price_changed: (d, t, l) => {
    const cur = s(d.currency);
    const from = d.old === null || d.old === undefined ? "—" : money(num(d.old), cur, l);
    const to = money(num(d.new), cur, l);
    if (d.backdated) {
      const day = new Date(`${s(d.valid_from)}T00:00:00`).toLocaleDateString(l);
      return t(`${s(d.item)} fiyatı ${day} tarihinden geçerli olmak üzere ${to} yapıldı`, `${s(d.item)} price set to ${to} effective ${day}`);
    }
    return t(`${s(d.item)} fiyatı ${from} → ${to}`, `${s(d.item)} price ${from} → ${to}`);
  },
  price_item_archived: (d, t) => t(`Kalem arşivlendi: ${s(d.item)}`, `Item archived: ${s(d.item)}`),
  price_item_restored: (d, t) => t(`Kalem geri alındı: ${s(d.item)}`, `Item restored: ${s(d.item)}`),
  price_item_deleted: (d, t) => t(`Kalem silindi: ${s(d.item)}`, `Item deleted: ${s(d.item)}`),
  document_added: (d, t) => t(`Belge yüklendi: ${s(d.filename)}`, `Document uploaded: ${s(d.filename)}`),
  document_deleted: (d, t) => t(`Belge silindi: ${s(d.filename)}`, `Document deleted: ${s(d.filename)}`),
  invite_sent: (d, t) => t(`Davet gönderildi: ${s(d.email)}`, `Invitation sent: ${s(d.email)}`),
  invite_revoked: (d, t) => t(`Davet iptal edildi: ${s(d.email)}`, `Invitation cancelled: ${s(d.email)}`),
  invite_accepted: (d, t) => t(`Davet kabul edildi: ${s(d.email)}`, `Invitation accepted: ${s(d.email)}`),
  access_changed: (_d, t) => t("Erişim yetkileri değişti", "Access permissions changed"),
  access_removed: (d, t) => t(`Erişim kaldırıldı: ${s(d.email)}`, `Access removed: ${s(d.email)}`),
  access_left: (_d, t) => t("Erişimden ayrıldı", "Left the record"),
  image_changed: (_d, t) => t("Logo güncellendi", "Logo updated"),
  image_removed: (_d, t) => t("Logo kaldırıldı", "Logo removed"),
};

/** Kayıt akışı. `guestTr/guestEn`: dışarıdan davetli kişinin yaptığı olayların yanındaki etiket (ör. "tedarikçi"). */
export default function ActivityFeed({
  items,
  extra,
  guestTr = "dış kullanıcı",
  guestEn = "external user",
}: {
  items: Activity[] | null;
  extra?: Record<string, ActivityText>;
  guestTr?: string;
  guestEn?: string;
}) {
  const { t, locale } = useT();
  if (!items) return <BlockSpinner />;
  if (items.length === 0) return <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz hareket yok.", "No activity yet.")}</p>;
  const texts = { ...BASE_TEXTS, ...extra };
  return (
    <ul className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
      {items.map((a) => {
        const text = texts[a.kind]?.(a.data, t, locale) ?? a.kind;
        const guest = a.data.by_guest === true;
        return (
          <li key={a.id} className="text-sm">
            <div className="text-neutral-800 dark:text-neutral-200">
              {text}
              {guest && <span className="ml-1.5 text-[11px] text-[#C6613F] dark:text-[#E8A48C]">· {t(guestTr, guestEn)}</span>}
            </div>
            <div className={muted}>
              {a.actor ? `${a.actor} · ` : ""}
              {new Date(a.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

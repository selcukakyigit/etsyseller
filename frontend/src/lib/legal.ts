// Hukuki metinlerde kullanılan tek kaynak. Yayına almadan önce TODO işaretli alanları gerçek bilgilerle doldur
// ve metinlerin sürümünü (LEGAL_VERSION) güncelle — kayıt onayı bu sürümle birlikte saklanacak.
import type { Lang } from "@/lib/i18n";

export const BRAND = "Ulagg";
export const BRAND_DOMAIN = "ulagg.com"; // TODO: gerçek alan adı

// TODO: Veri sorumlusu (işletme) bilgileri
export const COMPANY = {
  name: "[ŞİRKET / İŞLETME ÜNVANI]",
  address: "[TAM ADRES]",
  mersis: "[MERSİS / VERGİ NO]",
  email: `support@${BRAND_DOMAIN}`, // TODO: gerçek destek adresi
  kvkkEmail: `privacy@${BRAND_DOMAIN}`, // TODO: gizlilik / KVKK başvurularının alınacağı adres
};

export const LEGAL_VERSION = "2026-10-01";
export const LEGAL_UPDATED: Record<Lang, string> = { tr: "1 Ekim 2026", en: "October 1, 2026" };

export const ETSY_DISCLAIMER =
  "The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.";

export const LEGAL_LINKS: { href: string; label: Record<Lang, string> }[] = [
  { href: "/terms", label: { en: "Terms of Service", tr: "Kullanım Koşulları" } },
  { href: "/privacy", label: { en: "Privacy Policy", tr: "Gizlilik Politikası" } },
  { href: "/kvkk", label: { en: "KVKK Notice (Turkey)", tr: "KVKK Aydınlatma Metni" } },
  { href: "/cookies", label: { en: "Cookie Policy", tr: "Çerez Politikası" } },
  { href: "/ai-data", label: { en: "AI & Data Use", tr: "Yapay Zekâ ve Veri İşleme" } },
  { href: "/contact", label: { en: "Contact", tr: "İletişim" } },
];

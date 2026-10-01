// Hukuki metinlerde kullanılan tek kaynak. Yayına almadan önce TODO işaretli alanları gerçek bilgilerle doldur
// ve metinlerin sürümünü (LEGAL_VERSION) güncelle — kayıt onayı bu sürümle birlikte saklanacak.
import type { Lang } from "@/lib/i18n";

export const BRAND = "Ulagg";
export const BRAND_DOMAIN = "ulagg.com"; // TODO: gerçek alan adı

// Veri sorumlusu (işletme) bilgileri. TODO: vergi/MERSİS numarası ve gerçek e-posta adresleri.
export const COMPANY = {
  name: "CATCHOPS YAZILIM SAN. VE TİC. LTD. ŞTİ.",
  address: "Ünsal Mah. 5 Temmuz Kurtuluş Cad. Rima Apt. Sitesi No:226/B Kepez/ANTALYA",
  addressLines: ["Ünsal Mah. 5 Temmuz Kurtuluş Cad.", "Rima Apt. Sitesi No:226/B", "Kepez / Antalya, Türkiye"],
  mersis: "[MERSİS / VERGİ NO]",
  whatsapp: "905417718590",
  whatsappDisplay: "+90 541 771 85 90",
  email: `support@${BRAND_DOMAIN}`, // TODO: gerçek destek adresi
  kvkkEmail: `privacy@${BRAND_DOMAIN}`, // TODO: gizlilik / KVKK başvurularının alınacağı adres
  // Harita işaretçisi: Ünsal Mahallesi merkezi (yaklaşık). Tam konum için Google Haritalar'da binaya sağ tıklayıp
  // koordinatları buraya yaz.
  lat: 36.9286639,
  lon: 30.6334245,
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

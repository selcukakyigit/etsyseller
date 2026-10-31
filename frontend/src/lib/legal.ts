// Hukuki metinlerde kullanılan tek kaynak. Yayına almadan önce TODO işaretli alanları gerçek bilgilerle doldur
// ve metinlerin sürümünü (LEGAL_VERSION) güncelle — kayıt onayı bu sürümle birlikte saklanacak.
import type { Lang } from "@/lib/i18n";

export const BRAND = "Ulagg";
export const BRAND_DOMAIN = "ulagg.com"; // TODO: gerçek alan adı

// Veri sorumlusu (işletme) bilgileri. TODO: gerçek e-posta adresleri.
export const COMPANY = {
  name: "CATCHOPS YAZILIM SAN. VE TİC. LTD. ŞTİ.",
  address: "Ünsal Mah. 5 Temmuz Kurtuluş Cad. Rima Apt. Sitesi No:226/B Kepez/ANTALYA",
  addressLines: ["Ünsal Mah. 5 Temmuz Kurtuluş Cad.", "Rima Apt. Sitesi No:226/B", "Kepez / Antalya, Türkiye"],
  mersis: "0203073912000001",
  tax: "Antalya Kurumlar V.D. 2030739120",
  tradeRegistry: "114386",
  whatsapp: "905417718590",
  whatsappDisplay: "+90 541 771 85 90",
  email: `support@${BRAND_DOMAIN}`,
  kvkkEmail: `privacy@${BRAND_DOMAIN}`, // TODO: gizlilik / KVKK başvurularının alınacağı adres
  // Harita işaretçisi: 5 Temmuz Kurtuluş Caddesi'nin Ünsal Mahallesi'ndeki kesimi (OpenStreetMap verisi). Bina numarası
  // haritada kayıtlı olmadığı için yaklaşıktır; Google Haritalar'da binaya sağ tıklayıp tam koordinatları buraya yazabilirsin.
  lat: 36.9346978,
  lon: 30.62966,
};

export const LEGAL_VERSION = "2026-10-31";
export const LEGAL_UPDATED: Record<Lang, string> = { tr: "31 Ekim 2026", en: "October 31, 2026" };

// Kullanılmamış kredi paketleri için iade penceresi (gün).
export const REFUND_DAYS = 14;

export const ETSY_DISCLAIMER =
  "The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.";

export const LEGAL_LINKS: { href: string; label: Record<Lang, string> }[] = [
  { href: "/terms", label: { en: "Terms of Service", tr: "Kullanım Koşulları" } },
  { href: "/privacy", label: { en: "Privacy Policy", tr: "Gizlilik Politikası" } },
  { href: "/refunds", label: { en: "Refund Policy", tr: "İade Politikası" } },
  { href: "/distance-sales", label: { en: "Distance Sales Contract", tr: "Mesafeli Satış Sözleşmesi" } },
  { href: "/kvkk", label: { en: "KVKK Notice (Turkey)", tr: "KVKK Aydınlatma Metni" } },
  { href: "/cookies", label: { en: "Cookie Policy", tr: "Çerez Politikası" } },
  { href: "/ai-data", label: { en: "AI & Data Use", tr: "Yapay Zekâ ve Veri İşleme" } },
  { href: "/contact", label: { en: "Contact", tr: "İletişim" } },
];

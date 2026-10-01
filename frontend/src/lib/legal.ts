// Hukuki metinlerde kullanılan tek kaynak. Yayına almadan önce TODO işaretli alanları gerçek bilgilerle doldur
// ve metinlerin sürümünü (LEGAL_VERSION) güncelle — kayıt onayı bu sürümle birlikte saklanacak.

export const BRAND = "Ulagg";
export const BRAND_DOMAIN = "ulagg.com"; // TODO: gerçek alan adı

// TODO: Veri sorumlusu (işletme) bilgileri
export const COMPANY = {
  name: "[ŞİRKET / İŞLETME ÜNVANI]",
  address: "[TAM ADRES]",
  mersis: "[MERSİS / VERGİ NO]",
  email: `destek@${BRAND_DOMAIN}`, // TODO: gerçek destek adresi
  kvkkEmail: `kvkk@${BRAND_DOMAIN}`, // TODO: başvuruların alınacağı adres
};

export const LEGAL_VERSION = "2026-10-01";
export const LEGAL_UPDATED = "1 Ekim 2026";

export const ETSY_DISCLAIMER =
  "The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.";

export const LEGAL_LINKS = [
  { href: "/terms", label: "Kullanım Koşulları" },
  { href: "/privacy", label: "Gizlilik Politikası" },
  { href: "/kvkk", label: "KVKK Aydınlatma Metni" },
  { href: "/cookies", label: "Çerez Politikası" },
  { href: "/ai-data", label: "Yapay Zekâ ve Veri İşleme" },
] as const;

import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";

// Site sayfalarının (tanıtım, iletişim, hukuki, hata) yazı tipleri. "latin-ext" şart: ğ, ş, ı, İ başka fonttan gelmesin.
// Başlıklar: karakterli ama okunaklı bir grotesk. Metin: sıcak, yuvarlak hatlı bir sans.
export const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700"], display: "swap" });
export const sans = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], display: "swap" });

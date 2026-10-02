import { redirect } from "next/navigation";

// Şablonlar Ayarlar'dan kenar çubuğundaki "Mağaza" menüsüne taşındı; eski adres yeni sayfaya yönlenir.
export default function OldTemplatesPage() {
  redirect("/templates");
}

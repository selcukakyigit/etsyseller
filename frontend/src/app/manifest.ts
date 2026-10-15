import type { MetadataRoute } from "next";
import { getLang } from "@/lib/i18n-server";
import { BRAND } from "@/lib/legal";

// Ana ekrana eklenebilir uygulama bildirimi. Servis çalışanı (offline önbellek) bilerek yok: uygulama giriş gerektiren,
// sürekli değişen mağaza/finans verisi gösterir; eski veriyi önbellekten sunmak yanıltıcı olur.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const lang = await getLang();
  return {
    id: "/",
    name: BRAND,
    short_name: BRAND,
    description:
      lang === "tr"
        ? "Etsy satıcıları için AI destekli operasyon ve kârlılık platformu"
        : "AI-powered operations and profit platform for Etsy sellers",
    lang,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

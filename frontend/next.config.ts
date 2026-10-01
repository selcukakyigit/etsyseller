import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// İçerik Güvenlik Politikası: sayfa yalnızca kendi alanından, API'den ve Supabase'den kod/veri yükleyebilir. Bir XSS açığı
// olsa bile dışarıdan betik çekilmesini ve verinin başka bir sunucuya gönderilmesini sınırlar. Next.js satır içi betik
// kullandığı için 'unsafe-inline' gerekli; geliştirmede hızlı yenileme için 'unsafe-eval' ve ws: da eklenir.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${api}`,
  "font-src 'self' data:",
  `connect-src 'self' ${api} ${supabase} ${supabase.replace("https://", "wss://")}${dev ? " ws: http://localhost:*" : ""}`,
  `media-src 'self' blob: https: ${api}`,
  "frame-src https://www.openstreetmap.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

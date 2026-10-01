"use client";

import StatusPage from "@/components/site/StatusPage";
import { useLang } from "@/lib/i18n-client";

// Bilerek istemci bileşeni: sunucuda cookies()/headers() okumak her sayfayı dinamik (yavaş, pahalı) yapar.
export default function NotFound() {
  return <StatusPage code={404} lang={useLang()} />;
}

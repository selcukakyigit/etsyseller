"use client";

import StatusPage from "@/components/site/StatusPage";
import { useLang } from "@/lib/i18n-client";
import "./globals.css";

// Kök düzen (layout) bile çökerse devreye girer; kendi <html>/<body> etiketini kendisi üretmek zorundadır.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = useLang();
  return (
    <html lang={lang}>
      <body>
        <StatusPage code={500} lang={lang} onRetry={reset} digest={error.digest} />
      </body>
    </html>
  );
}

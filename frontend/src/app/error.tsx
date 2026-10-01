"use client";

import { useEffect } from "react";
import StatusPage from "@/components/site/StatusPage";
import { useLang } from "@/lib/i18n-client";

// Bir sayfa render edilirken beklenmeyen hata olursa görünür; `reset` sayfayı yeniden dener.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = useLang();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <StatusPage code={500} lang={lang} onRetry={reset} digest={error.digest} />;
}

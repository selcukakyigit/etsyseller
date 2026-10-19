"use client";

import { useEffect, useState } from "react";
import StatusPage from "@/components/site/StatusPage";
import { recordClientError } from "@/lib/clientErrors";
import { useLang } from "@/lib/i18n-client";
import { supabase } from "@/lib/supabase";

// Bir sayfa render edilirken beklenmeyen hata olursa görünür; `reset` sayfayı yeniden dener.
// Giriş yapmış kullanıcının "destek" düğmesi, hatayı önceden doldurulmuş uygulama içi talep formuna götürür.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = useLang();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    console.error(error);
    recordClientError(error);
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, [error]);
  const report = `${error.message}${error.digest ? ` (${error.digest})` : ""}`.slice(0, 300);
  return <StatusPage code={500} lang={lang} onRetry={reset} digest={error.digest} contactHref={signedIn ? `/support?new=1&error=${encodeURIComponent(report)}` : undefined} />;
}

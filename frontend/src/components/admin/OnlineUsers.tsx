"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { EmptyState, Section } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";

const REFRESH_MS = 30_000;

// Yol öneki -> okunur sayfa adı (en uzun eşleşen kazanır).
const PAGES: [string, string, string][] = [
  ["/admin", "Yönetim paneli", "Admin panel"],
  ["/dashboard", "Ana sayfa", "Home"],
  ["/analysis", "Analiz", "Analysis"],
  ["/listings", "Listing'ler", "Listings"],
  ["/orders", "Siparişler", "Orders"],
  ["/finance", "Finans", "Finance"],
  ["/reviews", "Yorumlar", "Reviews"],
  ["/shipping", "Kargo ayarları", "Shipping settings"],
  ["/templates", "Açıklama şablonları", "Description templates"],
  ["/settings", "Ayarlar", "Settings"],
];

function pageName(path: string | null, t: (tr: string, en: string) => string): string {
  if (!path) return "—";
  if (/^\/listings\/[^/]+\/edit/.test(path)) return t("Listing düzenleyici", "Listing editor");
  const hit = PAGES.filter(([p]) => path === p || path.startsWith(`${p}/`)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? t(hit[1], hit[2]) : path;
}

/** Şu an sitede olan kullanıcılar (son 2 dakikada sinyal gelenler); 30 saniyede bir kendiliğinden yenilenir. */
export default function OnlineUsers() {
  const { t, locale } = useT();
  const { data, error, reload } = useApiData("admin:online", api.admin.online);
  // "x sn önce" hesabının şimdisi: render saf kalsın diye her yenilemede güncellenir.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      reload();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  const ago = (iso: string | null) => {
    if (!iso) return "";
    const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return seconds < 60 ? rtf.format(-seconds, "second") : rtf.format(-Math.round(seconds / 60), "minute");
  };

  return (
    <Section
      title={data ? t(`Şu an çevrimiçi (${data.length})`, `Online now (${data.length})`) : t("Şu an çevrimiçi", "Online now")}
      action={<span className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500"><span className="h-2 w-2 animate-pulse rounded-full bg-green-500" aria-hidden />{t("canlı", "live")}</span>}
    >
      {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.length === 0 && <EmptyState>{t("Şu an sitede kimse yok.", "Nobody is on the site right now.")}</EmptyState>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {data.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/admin/users/${u.id}`} className="flex min-w-0 items-center gap-2.5">
                <span className="relative flex-shrink-0">
                  <Avatar user={u} size={28} />
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500 dark:border-neutral-900" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-100">{u.name || u.email}</span>
                  {u.name && <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{u.email}</span>}
                </span>
              </Link>
              <span className="min-w-0 text-right">
                <span className="block truncate text-sm text-neutral-700 dark:text-neutral-300" title={u.last_path ?? ""}>
                  {pageName(u.last_path, t)}
                </span>
                <span className="block text-xs text-neutral-400 dark:text-neutral-500">{ago(u.last_seen_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

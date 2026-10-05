"use client";

import Link from "next/link";
import { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import StatusPage from "@/components/site/StatusPage";
import { PageSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { useAuthAndShop } from "@/lib/useAuthAndShop";

/** Yönetim paneli sekmeleri. Yeni bir yönetim sayfası buraya eklenir; sayfa kendi içeriğini AdminShell içinde çizer. */
const TABS = [
  { href: "/admin", tr: "Genel bakış", en: "Overview" },
  { href: "/admin/users", tr: "Kullanıcılar", en: "Users" },
  { href: "/admin/models", tr: "Modeller", en: "Models" },
  { href: "/admin/credits", tr: "Krediler", en: "Credits" },
  { href: "/admin/billing", tr: "Satış", en: "Sales" },
  { href: "/admin/messages", tr: "Mesajlar", en: "Messages" },
  { href: "/admin/system", tr: "Sistem", en: "System" },
] as const;

export type AdminTab = (typeof TABS)[number]["href"];

/** Tüm yönetim sayfalarının ortak çerçevesi. Sayfa sunucuda zaten kapılanır (proxy.ts); bu ikinci kontrol, oturum
 * istemcide değişmişse diye vardır. Yöneticilik doğrulanana kadar başlık ve sekmeler dahil hiçbir şey çizilmez; içerik
 * ancak sonra bağlanır, böylece sayfalar kendi verilerini yetki kontrolü yapmadan isteyebilir. */
export default function AdminShell({ current, children }: { current: AdminTab; children: ReactNode }) {
  const { user, shops, activeShop, setActiveShopId, error } = useAuthAndShop();
  const { t, lang } = useT();

  // Kullanıcı yüklenemediyse yöneticilik doğrulanamaz: 404. (Mağaza listesi hatası yöneticiyi engellemez.)
  if (user ? !user.is_admin : error) return <StatusPage code={404} lang={lang} />;
  if (!user) return <PageSpinner />;

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/admin">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("Yönetim", "Admin")}</h1>

        <nav aria-label={t("Yönetim bölümleri", "Admin sections")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={current === tab.href ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  current === tab.href
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {t(tab.tr, tab.en)}
              </Link>
            ))}
          </div>
        </nav>

        {children}
      </div>
    </AppShell>
  );
}

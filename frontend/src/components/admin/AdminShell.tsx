"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import LangSwitch from "@/components/LangSwitch";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import StatusPage from "@/components/site/StatusPage";
import { PageSpinner } from "@/components/ui/Spinner";
import { api, User } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import { usePresence } from "@/lib/usePresence";

/** Yönetim paneli bölümleri. Yeni bir yönetim sayfası buraya eklenir; sayfa kendi içeriğini AdminShell içinde çizer.
 * `icon`: 24x24 SVG yolu. */
const TABS = [
  { href: "/admin", tr: "Genel bakış", en: "Overview", icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" },
  { href: "/admin/users", tr: "Kullanıcılar", en: "Users", icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0" },
  { href: "/admin/models", tr: "Modeller", en: "Models", icon: "M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2zm0 0v18M4 6.5l8 4.5 8-4.5" },
  { href: "/admin/credits", tr: "Krediler", en: "Credits", icon: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v10m-3-7.5c0-1 1.3-1.5 3-1.5s3 .7 3 2-1.3 1.7-3 2-3 .8-3 2 1.3 2 3 2 3-.5 3-1.5" },
  { href: "/admin/billing", tr: "Satış", en: "Sales", icon: "M3 7h18v10H3V7zm0 4h18M7 15h3" },
  { href: "/admin/messages", tr: "Mesajlar", en: "Messages", icon: "M4 5h16v11H8l-4 4V5z" },
  { href: "/admin/system", tr: "Sistem", en: "System", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 002 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" },
] as const;

export type AdminTab = (typeof TABS)[number]["href"];

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Yönetim panelinin kendi çerçevesi: uygulamanın menüsünden ayrı sol menü ve üst çubuk. Sayfa sunucuda zaten
 * kapılanır (proxy.ts); bu ikinci kontrol, oturum istemcide değişmişse diye vardır. Yöneticilik doğrulanana kadar hiçbir
 * şey çizilmez; içerik ancak sonra bağlanır, böylece sayfalar kendi verilerini yetki kontrolü yapmadan isteyebilir. */
export default function AdminShell({ current, title, children }: { current: AdminTab; title?: string; children: ReactNode }) {
  const { user, error } = useAuthAndShop();
  const { t, lang } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  usePresence(current, !!user?.is_admin);

  // Kullanıcı yüklenemediyse yöneticilik doğrulanamaz: 404. (Mağaza listesi hatası yöneticiyi engellemez.)
  if (user ? !user.is_admin : error) return <StatusPage code={404} lang={lang} />;
  if (!user) return <PageSpinner />;

  const tab = TABS.find((x) => x.href === current);
  const heading = title ?? (tab ? t(tab.tr, tab.en) : t("Yönetim", "Admin"));

  return (
    <div className="flex min-h-screen min-w-0 bg-neutral-50 dark:bg-neutral-950">
      <aside className="sticky top-0 hidden h-screen w-60 flex-shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:flex">
        <AdminNav current={current} />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-label={t("Yönetim menüsü", "Admin menu")} className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-neutral-900">
            <AdminNav current={current} onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95 sm:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("Menüyü aç", "Open menu")}
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 lg:hidden"
          >
            <Icon d="M4 7h16M4 12h16M4 17h16" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{heading}</h1>
          <Link
            href="/dashboard"
            className="hidden items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800 sm:inline-flex"
          >
            <Icon d="M10 19l-7-7 7-7M3 12h18" className="h-4 w-4" />
            {t("Uygulamaya dön", "Back to app")}
          </Link>
          <LangSwitch className="hidden text-xs sm:flex" />
          <ThemeToggle />
          <AccountMenu user={user} />
        </header>
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

function AdminNav({ current, onNavigate }: { current: AdminTab; onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-neutral-100 px-5 dark:border-neutral-800">
        <Logo height={20} />
        <span className="rounded-md bg-[#D97757]/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#C6613F] dark:text-[#D97757]">
          {t("Yönetim", "Admin")}
        </span>
      </div>
      <nav aria-label={t("Yönetim bölümleri", "Admin sections")} className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {TABS.map((tab) => {
          const active = current === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              <Icon d={tab.icon} />
              {t(tab.tr, tab.en)}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Icon d="M10 19l-7-7 7-7M3 12h18" />
          {t("Uygulamaya dön", "Back to app")}
        </Link>
      </div>
    </>
  );
}

function AccountMenu({ user }: { user: User }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function logout() {
    await api.auth.logout();
    router.push("/login");
  }

  const item = "flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label={t("Hesap", "Account")} className="flex items-center rounded-full">
        <Avatar user={user} size={32} className="border border-neutral-200 dark:border-neutral-700" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="border-b border-neutral-100 px-3.5 py-2.5 dark:border-neutral-800">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{user.name || t("Yönetici", "Admin")}</p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{user.email}</p>
          </div>
          <Link href="/dashboard" role="menuitem" className={item} onClick={() => setOpen(false)}>
            {t("Uygulamaya dön", "Back to app")}
          </Link>
          <Link href="/settings" role="menuitem" className={item} onClick={() => setOpen(false)}>
            {t("Ayarlar", "Settings")}
          </Link>
          <div className="px-3.5 py-2 sm:hidden">
            <LangSwitch className="text-xs" />
          </div>
          <button type="button" role="menuitem" onClick={() => void logout()} className={`${item} border-t border-neutral-100 text-red-600 dark:border-neutral-800 dark:text-red-400`}>
            {t("Çıkış yap", "Log out")}
          </button>
        </div>
      )}
    </div>
  );
}

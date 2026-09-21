"use client";

import Link from "next/link";
import { API_URL } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import { ChevronRightIcon, HelpIcon, KeyIcon, ShieldIcon, StoreIcon, UserIcon } from "@/components/icons";

const CARDS = [
  {
    href: "/settings/profile",
    icon: UserIcon,
    color: "bg-blue-500",
    title: "Hesap Bilgileri",
    description: "Profilini ve fotoğrafını yönet",
  },
  {
    href: "/settings/api-keys",
    icon: KeyIcon,
    color: "bg-[#F1641E]",
    title: "API Anahtarları",
    description: "Etsy, OpenAI ve Claude bağlantılarını yönet",
  },
  {
    href: "/settings/shop",
    icon: StoreIcon,
    color: "bg-green-600",
    title: "Mağaza Bağlantısı",
    description: "Etsy mağaza bağlantı durumunu görüntüle",
  },
  {
    href: "/settings/security",
    icon: ShieldIcon,
    color: "bg-red-500",
    title: "Güvenlik",
    description: "Şifreni değiştir",
  },
  {
    href: "/settings/help",
    icon: HelpIcon,
    color: "bg-teal-600",
    title: "Yardım & Destek",
    description: "Destek al, dokümantasyona göz at",
  },
];

export default function SettingsHub() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/settings">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Ayarlar</h1>

        {bootError && <p className="text-sm text-red-600">{bootError}</p>}

        {!user && !bootError && <p className="text-sm text-neutral-400 dark:text-neutral-500">Yükleniyor…</p>}

        {user && (
          <div className="rounded-2xl bg-gradient-to-r from-[#F1641E] to-[#c94f16] p-5 flex items-center gap-4 text-white">
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API_URL}${user.avatar_url}`}
                alt=""
                className="w-14 h-14 rounded-full object-cover border-2 border-white/30 flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-white/20 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-semibold truncate">{user.name || "İsimsiz kullanıcı"}</p>
              <p className="text-sm text-white/80 truncate">{user.email}</p>
            </div>
          </div>
        )}

        {user && (
          <div className="grid sm:grid-cols-2 gap-3">
            {CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.href}
                  href={card.href}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 hover:border-neutral-300 dark:hover:border-neutral-700 transition"
                >
                  <div className={`w-10 h-10 rounded-lg ${card.color} text-white flex items-center justify-center flex-shrink-0`}>
                    <Icon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{card.title}</p>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{card.description}</p>
                  </div>
                  <ChevronRightIcon className="text-neutral-300 dark:text-neutral-600 flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

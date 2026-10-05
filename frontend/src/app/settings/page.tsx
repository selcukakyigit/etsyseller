"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import { BellIcon, ChevronRightIcon, HelpIcon, KeyIcon, ShieldIcon, StoreIcon, UserIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";
import { PageSpinner } from "@/components/ui/Spinner";

const CARDS = [
  {
    href: "/settings/profile",
    icon: UserIcon,
    color: "bg-blue-500",
    title: ["Hesap Bilgileri", "Account details"],
    description: ["Profilini ve fotoğrafını yönet", "Manage your profile and photo"],
  },
  {
    href: "/settings/billing",
    icon: KeyIcon,
    color: "bg-[#D97757]",
    title: ["Plan ve krediler", "Plan and credits"],
    description: ["Kredi bakiyen, aboneliğin ve satın alma", "Your credit balance, subscription and purchases"],
  },
  {
    href: "/settings/shop",
    icon: StoreIcon,
    color: "bg-green-600",
    title: ["Mağaza Bağlantısı", "Shop connection"],
    description: ["Etsy mağaza bağlantı durumunu görüntüle", "View your Etsy shop connection"],
  },
  {
    href: "/settings/ai",
    icon: KeyIcon,
    color: "bg-violet-600",
    title: ["Yapay Zekâ", "AI"],
    description: ["AI özelliklerini aç/kapat, verinin nereye gittiğini gör", "Turn AI features on or off and see where data goes"],
  },
  {
    href: "/settings/notifications",
    icon: BellIcon,
    color: "bg-amber-500",
    title: ["Bildirimler", "Notifications"],
    description: ["Yeni siparişte e-posta al", "Get an email on new orders"],
  },
  {
    href: "/settings/security",
    icon: ShieldIcon,
    color: "bg-red-500",
    title: ["Güvenlik", "Security"],
    description: ["Şifreni değiştir", "Change your password"],
  },
  {
    href: "/settings/danger",
    icon: ShieldIcon,
    color: "bg-neutral-700",
    title: ["Hesap ve Veriler", "Account and data"],
    description: ["Verileri sıfırla veya üyeliği sil", "Reset data or delete your account"],
  },
  {
    href: "/settings/help",
    icon: HelpIcon,
    color: "bg-teal-600",
    title: ["Yardım & Destek", "Help & Support"],
    description: ["Destek al, dokümantasyona göz at", "Get support and answers"],
  },
] as const;

export default function SettingsHub() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/settings">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("Ayarlar", "Settings")}</h1>

        {bootError && <p className="text-sm text-red-600">{bootError}</p>}

        <div className="min-h-[20px]">
          {!user && !bootError && <PageSpinner />}
        </div>

        {user && (
          <div className="rounded-2xl bg-gradient-to-r from-[#D97757] to-[#B4553A] p-5 flex items-center gap-4 text-white">
            <Avatar user={user} size={56} className="border-2 border-white/30" />
            <div className="min-w-0">
              <p className="font-semibold truncate">{user.name || t("İsimsiz kullanıcı", "Unnamed user")}</p>
              <p className="text-sm text-white/80 truncate">{user.email}</p>
            </div>
          </div>
        )}

        {user && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(card.title[0], card.title[1])}</p>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{t(card.description[0], card.description[1])}</p>
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

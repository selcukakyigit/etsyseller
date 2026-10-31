"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { Shop, User } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { useT } from "@/lib/i18n-client";
import { PageWidth, pageContainer } from "@/components/layout/pageContainer";

export default function SettingsSubpage({
  user,
  shops,
  activeShop,
  onSwitchShop,
  title,
  width = "narrow",
  children,
}: {
  user: User | null;
  shops?: Shop[] | null;
  activeShop: Shop | null;
  onSwitchShop?: (id: number) => void;
  title: string;
  /** Sayfa genişliği (bkz. pageContainer); kart ızgarası olan sayfalar (krediler) daha geniş ister. */
  width?: PageWidth;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={onSwitchShop} current="/settings">
      <div className={pageContainer(width, "normal", "space-y-6")}>
        <Link
          href="/settings"
          className="inline-block text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition"
        >
          ← {t("Ayarlar", "Settings")}
        </Link>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h1>
        {children}
      </div>
    </AppShell>
  );
}

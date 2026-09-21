"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { Shop, User } from "@/lib/api";
import AppShell from "@/components/AppShell";

export default function SettingsSubpage({
  user,
  shops,
  activeShop,
  onSwitchShop,
  title,
  children,
}: {
  user: User | null;
  shops?: Shop[] | null;
  activeShop: Shop | null;
  onSwitchShop?: (id: number) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={onSwitchShop} current="/settings">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <Link
          href="/settings"
          className="inline-block text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition"
        >
          ← Ayarlar
        </Link>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h1>
        {children}
      </div>
    </AppShell>
  );
}

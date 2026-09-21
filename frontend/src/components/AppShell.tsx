"use client";

import { ReactNode } from "react";
import { Shop, User } from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";

export default function AppShell({
  user,
  shops,
  activeShop,
  onSwitchShop,
  current,
  children,
}: {
  user: User | null;
  shops?: Shop[] | null;
  activeShop: Shop | null;
  onSwitchShop?: (id: number) => void;
  current: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {user && (
        <Sidebar user={user} shops={shops ?? null} activeShop={activeShop} onSwitchShop={onSwitchShop} current={current} />
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        {user && <Topbar activeShop={activeShop} />}
        <main className="flex-1 bg-neutral-50 dark:bg-neutral-950">{children}</main>
      </div>
    </div>
  );
}

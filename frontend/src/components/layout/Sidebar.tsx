"use client";

import Link from "next/link";
import Logo from "@/components/Logo";
import { useT } from "@/lib/i18n-client";
import SidebarNav, { ShellProps } from "./SidebarNav";

/** Masaüstü kenar çubuğu (lg ve üstü). Mobilde aynı içerik MobileDrawer'da açılır. */
export default function Sidebar(props: ShellProps) {
  const { t } = useT();
  return (
    <aside className="sticky top-0 hidden h-screen w-56 flex-shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:flex">
      <div className="border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
        <Link href="/" aria-label={t("Ana sayfa", "Home page")} className="inline-block">
          <Logo height={22} />
        </Link>
      </div>
      <SidebarNav {...props} />
    </aside>
  );
}

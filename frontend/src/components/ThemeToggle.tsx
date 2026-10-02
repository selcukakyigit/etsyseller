"use client";

import { useTheme } from "@/lib/useTheme";
import { MoonIcon, SunIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useT();

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? t("Açık moda geç", "Switch to light mode") : t("Koyu moda geç", "Switch to dark mode")}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

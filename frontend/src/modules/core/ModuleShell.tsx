"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { useT } from "@/lib/i18n-client";
import { pageContainer } from "@/components/layout/pageContainer";
import { menuBox, Popover, toolbarBtn } from "@/components/ui/Popover";
import { badge } from "./ui";
import { useHiddenTabs } from "./useHiddenTabs";

export type ShellTab<T extends string> = { id: T; tr: string; en: string; count?: number };

/** Her modül kaydının ekran iskeleti: geri bağlantısı, başlık + etiket, sağda eylemler, altında URL'e bağlı sekmeler.
 * Modül yalnızca sekmelerini ve içeriklerini verir; görünüm, tema ve dil burada bir kez çözülür. */
export default function ModuleShell<T extends string>({
  backHref,
  backLabel,
  title,
  avatar,
  label,
  roleBadge,
  actions,
  tabs,
  tab,
  onTab,
  prefsKey,
  fixedTabs,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  /** Başlığın solundaki logo (ör. EntityAvatar). */
  avatar?: ReactNode;
  label?: string;
  roleBadge?: string;
  actions?: ReactNode;
  tabs: ShellTab<T>[];
  tab: T;
  onTab: (t: T) => void;
  /** Kişiye özel sekme gizleme için anahtar (ör. "supply:12"); `fixedTabs` dışındaki sekmeler gizlenebilir. */
  prefsKey: string;
  fixedTabs: T[];
  children: ReactNode;
}) {
  const { t } = useT();
  const [hidden, setHidden] = useHiddenTabs(prefsKey);
  const shown = tabs.filter((x) => fixedTabs.includes(x.id) || !hidden.includes(x.id));
  const hideable = tabs.filter((x) => !fixedTabs.includes(x.id));
  return (
    <div className={pageContainer("page")}>
      <Link href={backHref} className="text-xs text-neutral-500 hover:underline dark:text-neutral-400">
        ← {backLabel}
      </Link>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {avatar}
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            <span className="truncate">{title}</span>
            {label && <span className={`${badge} bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300`}>{label}</span>}
            {roleBadge && <span className={`${badge} bg-[#D97757]/15 text-[#C6613F] dark:bg-[#D97757]/20 dark:text-[#E8A48C]`}>{roleBadge}</span>}
          </h1>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-4 flex items-end gap-2">
      <nav className="-mx-4 min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0" aria-label={t("Bölümler", "Sections")}>
        <div className="flex min-w-max gap-1 border-b border-neutral-200 dark:border-neutral-800">
          {shown.map((x) => {
            const active = x.id === tab;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => onTab(x.id)}
                aria-current={active ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "border-[#D97757] text-neutral-900 dark:text-neutral-100"
                    : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                {t(x.tr, x.en)}
                {x.count ? (
                  <span className="ml-1.5 rounded-full bg-[#D97757] px-1.5 py-0.5 text-[10px] font-semibold text-white">{x.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>
      {hideable.length > 0 && (
        <Popover label={t("Sekmeleri göster / gizle", "Show / hide tabs")} button={<span aria-hidden>⋯</span>} className={`${toolbarBtn} mb-1`}>
          {() => (
            <div role="menu" className={`${menuBox} w-56 py-2`}>
              <div className="px-3.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">{t("Bu ekranda göster", "Show on this screen")}</div>
              {hideable.map((x) => {
                const visible = !hidden.includes(x.id);
                return (
                  <label key={x.id} className="flex cursor-pointer items-center gap-2.5 px-3.5 py-1.5 text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => {
                        setHidden(x.id, visible);
                        if (visible && x.id === tab) onTab(fixedTabs[0]);
                      }}
                      className="h-4 w-4 accent-[#D97757]"
                    />
                    {t(x.tr, x.en)}
                  </label>
                );
              })}
            </div>
          )}
        </Popover>
      )}
      </div>
      <div className="pt-5">{children}</div>
    </div>
  );
}

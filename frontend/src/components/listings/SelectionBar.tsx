"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n-client";
import { ABOVE_BOTTOM_NAV } from "@/components/layout/constants";

type Action = { key: string; label: string; run: () => void; danger?: boolean; show?: boolean };

/** Bir ya da daha çok listing seçilince ekranın altında beliren toplu işlem çubuğu (mobilde alt menünün üstünde).
 *  Mobilde yalnızca "Etsy'de yayınla" görünür, diğer işlemler "İşlemler" menüsündedir; geniş ekranda hepsi satırdadır. */
export default function SelectionBar({
  count,
  publishCount,
  publishing,
  busy,
  renewable,
  onPublish,
  onActivate,
  onDeactivate,
  onRenew,
  onEdit,
  onDelete,
  onClear,
}: {
  count: number;
  /** Seçilenlerden yerel değişikliği olanlar (yalnızca onlar yayınlanabilir). */
  publishCount: number;
  publishing: boolean;
  busy: boolean;
  /** Seçilenlerin hepsi süresi dolmuş/tükenmiş mi (yenileme yalnızca o zaman gösterilir). */
  renewable: boolean;
  onPublish: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onRenew: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  if (count === 0) return null;

  const actions: Action[] = [
    { key: "edit", label: t("Düzenleme seçenekleri", "Editing options"), run: onEdit },
    { key: "renew", label: t("Yenile", "Renew"), run: onRenew, show: renewable },
    { key: "activate", label: t("Aktif et", "Activate"), run: onActivate },
    { key: "deactivate", label: t("Pasife al", "Deactivate"), run: onDeactivate },
    { key: "delete", label: t("Sil", "Delete"), run: onDelete, danger: true },
  ].filter((a) => a.show !== false);

  const inline = (a: Action) =>
    `rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${
      a.danger
        ? "text-red-400 hover:bg-white/10 dark:text-red-600 dark:hover:bg-black/5"
        : "text-neutral-200 hover:bg-white/10 dark:text-neutral-700 dark:hover:bg-black/5"
    }`;

  return (
    <div className={`fixed inset-x-0 z-40 flex justify-center px-3 ${ABOVE_BOTTOM_NAV}`}>
      <div
        role="toolbar"
        aria-label={t("Toplu işlemler", "Bulk actions")}
        // Ters ton: açık temada koyu, koyu temada açık çubuk; kartların (beyaz ya da siyah) üstünde net ayrışır.
        className="flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-neutral-700 bg-neutral-900 p-2 pl-4 shadow-2xl ring-1 ring-black/10 dark:border-neutral-300 dark:bg-neutral-100 dark:ring-white/20"
      >
        <span className="mr-auto whitespace-nowrap text-sm font-semibold tabular-nums text-white dark:text-neutral-900">
          {t(`${count} seçili`, `${count} selected`)}
        </span>

        <div className="hidden items-center gap-0.5 md:flex">
          {actions.map((a) => (
            <button key={a.key} type="button" onClick={a.run} disabled={busy} className={inline(a)}>
              {a.label}
            </button>
          ))}
        </div>

        <div ref={menuRef} className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="rounded-full border border-neutral-600 px-3 py-1.5 text-sm font-medium text-neutral-100 disabled:opacity-40 dark:border-neutral-400 dark:text-neutral-800"
          >
            {t("İşlemler", "Actions")} ▴
          </button>
          {menuOpen && (
            <div role="menu" className="absolute bottom-full right-0 mb-2 w-56 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-xl dark:border-neutral-300 dark:bg-neutral-100">
              {actions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    a.run();
                  }}
                  className={`block w-full px-4 py-2.5 text-left hover:bg-white/10 dark:hover:bg-black/5 ${a.danger ? "text-red-400 dark:text-red-600" : "text-neutral-100 dark:text-neutral-800"}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {publishCount > 0 && (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing || busy}
            className="whitespace-nowrap rounded-full bg-[#D97757] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#C6613F] disabled:opacity-50"
          >
            <span className="sm:hidden">{t(`Yayınla (${publishCount})`, `Publish (${publishCount})`)}</span>
            <span className="hidden sm:inline">{t(`Etsy'de yayınla (${publishCount})`, `Publish to Etsy (${publishCount})`)}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onClear}
          aria-label={t("Seçimi temizle", "Clear selection")}
          title={t("Seçimi temizle", "Clear selection")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-white/10 dark:text-neutral-500 dark:hover:bg-black/5"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

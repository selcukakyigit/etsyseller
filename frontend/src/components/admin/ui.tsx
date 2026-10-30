"use client";

import Link from "next/link";
import { ButtonHTMLAttributes, ReactNode, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

/** Yönetim sayfalarının ortak küçük parçaları: bölüm kutusu, sayı kartı, durum rozeti ve tarih/sayı biçimleri. */

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Sayfa içi sekmeler; her sekme ayrı bir adrestir (paylaşılabilir, geri tuşuyla dönülebilir). */
export function PageTabs({ tabs, current }: { tabs: readonly { href: string; tr: string; en: string }[]; current: string }) {
  const { t } = useT();
  return (
    <nav aria-label={t("Sekmeler", "Tabs")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map((tab) => {
          const active = tab.href === current;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                active
                  ? "border-[#D97757] text-neutral-900 dark:text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              {t(tab.tr, tab.en)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}

const BADGE_TONES = {
  good: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  bad: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  muted: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}>{children}</span>;
}

/** Kullanım çubuğu (ör. Etsy günlük kota). Oran %80'i geçince sarı, %95'i geçince kırmızı olur. */
export function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const color = pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-[#D97757]";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">{children}</p>;
}

/** Arayüz diline göre sayı ve tarih biçimleri. Geçersiz ya da boş tarih "—" olarak gösterilir. */
export function useFormat() {
  const { locale } = useT();
  return {
    num: (n: number) => n.toLocaleString(locale),
    money: (n: number, currency: string) => {
      try {
        return n.toLocaleString(locale, { style: "currency", currency });
      } catch {
        return `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
      }
    },
    date: (iso: string | null) => {
      if (!iso) return "—";
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(locale, { dateStyle: "medium" });
    },
    dateTime: (iso: string | null) => {
      if (!iso) return "—";
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
    },
  };
}

/** Form parçaları: tüm yönetim formları aynı görünsün, iki temada da doğru renkte olsun. */
export const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100";

const BUTTON_TONES = {
  primary: "border-[#D97757] bg-[#D97757] text-white hover:bg-[#C6613F] hover:border-[#C6613F]",
  secondary: "border-neutral-200 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800",
  danger: "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
} as const;

export function Button({
  tone = "secondary",
  busy = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof BUTTON_TONES; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${BUTTON_TONES[tone]} ${className}`}
    >
      {busy && <Spinner size={14} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400 dark:text-neutral-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${checked ? "bg-[#D97757]" : "bg-neutral-300 dark:bg-neutral-700"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Yakalanan hatanın gösterilecek metni. Ağ hatasında boştur: api.ts zaten bildirim gösterdi, ikinci kez gösterilmez. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "";
}

/** "1–50 / 230" ve Önceki / Sonraki. Sayfa başına `step` kayıt; `offset` kayıt sırasıdır. */
export function Pager({ offset, step, total, onChange }: { offset: number; step: number; total: number; onChange: (offset: number) => void }) {
  const { t } = useT();
  const f = useFormat();
  if (total <= step) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-neutral-600 dark:text-neutral-400">
      <span className="tabular-nums">
        {f.num(offset + 1)}–{f.num(Math.min(offset + step, total))} / {f.num(total)}
      </span>
      <div className="flex gap-2">
        <Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - step))}>
          {t("Önceki", "Previous")}
        </Button>
        <Button disabled={offset + step >= total} onClick={() => onChange(offset + step)}>
          {t("Sonraki", "Next")}
        </Button>
      </div>
    </div>
  );
}

/** CSV indirme düğmesi: `run` dosyayı indirir (api.admin.exportCsv); hata bildirimi burada gösterilir. */
export function ExportButton({ run }: { run: () => Promise<void> }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  async function click() {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      const msg = errorText(e);
      if (msg) toast.error(msg);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button busy={busy} onClick={() => void click()}>
      {!busy && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />
        </svg>
      )}
      {t("CSV indir", "Download CSV")}
    </Button>
  );
}

/** Gün aralığı seçici (7 / 30 / 90 gün gibi küçük düğme grubu). */
export function RangeButtons<T extends number>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  const { t } = useT();
  return (
    <div className="flex gap-1">
      {options.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={value === d}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === d ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          {t(`${d} gün`, `${d} days`)}
        </button>
      ))}
    </div>
  );
}

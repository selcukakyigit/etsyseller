import Link from "next/link";
import Logo from "@/components/Logo";
import { serif } from "@/components/site/fonts";
import { STATUS_ACTIONS, STATUS_COPY, StatusCode } from "@/lib/copy-errors";
import type { Lang } from "@/lib/i18n";

const primary =
  "inline-flex items-center rounded-full bg-[#1F1B16] px-6 py-3 text-sm font-medium text-white transition hover:bg-black dark:bg-[#F3EFE9] dark:text-[#1F1B16] dark:hover:bg-white";
const secondary =
  "inline-flex items-center rounded-full border border-black/15 px-6 py-3 text-sm font-medium text-neutral-800 transition hover:bg-black/5 dark:border-white/20 dark:text-neutral-100 dark:hover:bg-white/10";

/**
 * Tüm hata ekranları (404, 500, ...) bu tek bileşenden çıkar. Sunucu ve istemci bileşenlerinde de kullanılabilir:
 * `onRetry` verilirse "Tekrar dene" düğmesi, `digest` verilirse destek için hata kodu gösterilir.
 */
export default function StatusPage({
  code,
  lang,
  onRetry,
  digest,
}: {
  code: StatusCode;
  lang: Lang;
  onRetry?: () => void;
  digest?: string;
}) {
  const copy = STATUS_COPY[code][lang];
  const actions = STATUS_ACTIONS[lang];
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-[#FBF9F6] px-6 py-16 text-center text-neutral-800 dark:bg-[#0E0D0C] dark:text-neutral-200">
      <Link href="/" aria-label="Ulagg">
        <Logo height={28} />
      </Link>
      <p className={`${serif.className} mt-14 text-8xl leading-none text-[#D97757] sm:text-9xl`}>{code}</p>
      <h1 className="mt-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">{copy.title}</h1>
      <p className="mt-3 max-w-md leading-relaxed text-neutral-600 dark:text-neutral-300">{copy.message}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {onRetry && (
          <button type="button" onClick={onRetry} className={primary}>
            {actions.retry}
          </button>
        )}
        {code === 401 ? (
          <Link href="/login" className={onRetry ? secondary : primary}>
            {actions.signin}
          </Link>
        ) : (
          <Link href="/" className={onRetry ? secondary : primary}>
            {actions.home}
          </Link>
        )}
        {(code === 500 || code === 503) && (
          <Link href="/contact" className={secondary}>
            {actions.contact}
          </Link>
        )}
      </div>
      {digest && (
        <p className="mt-8 text-xs text-neutral-400 dark:text-neutral-500">
          {actions.code}: <span className="font-mono">{digest}</span>
        </p>
      )}
    </main>
  );
}

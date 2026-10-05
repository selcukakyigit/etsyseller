"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api, ApiError, User } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

/** Askıya alınmış ya da engellenmiş hesabın bilgi ekranı. Bu durumda yalnızca /api/auth/me açıktır; diğer her istek 403
 * döner (backend/app/auth/access.py). Hesap yeniden etkinleştirilince buradan uygulamaya dönülür. */
export default function AccountStatusPage() {
  const { t } = useT();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api.auth
      .me()
      .then((u) => {
        if (!u.status || u.status === "active") router.replace("/dashboard");
        else setUser(u);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
      });
  }, [router]);

  async function logout() {
    await api.auth.logout();
    router.replace("/login");
  }

  const blocked = user?.status === "blocked";
  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-50 px-6 py-16 dark:bg-neutral-950">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <Logo height={24} />
        {!user ? (
          <BlockSpinner />
        ) : (
          <>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {blocked ? t("Hesabın engellendi", "Your account is blocked") : t("Hesabın askıya alındı", "Your account is suspended")}
            </h1>
            <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
              {t(
                "Şu an uygulamayı kullanamazsın. Bir hata olduğunu düşünüyorsan ya da ayrıntı öğrenmek istiyorsan bize yaz; hesabın ve verilerin yerinde duruyor.",
                "You cannot use the app right now. If you think this is a mistake or want to know more, write to us; your account and data are still there.",
              )}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{user.email}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href="/contact" className="inline-flex items-center rounded-lg bg-[#D97757] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#C6613F]">
                {t("Destekle iletişime geç", "Contact support")}
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {t("Çıkış yap", "Log out")}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

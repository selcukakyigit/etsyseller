"use client";

import { errMsg } from "@/modules/core/errors";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import LangSwitch from "@/components/LangSwitch";
import Logo from "@/components/Logo";
import { PageSpinner } from "@/components/ui/Spinner";
import { ApiError, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { BRAND } from "@/lib/legal";
import { supabase } from "@/lib/supabase";
import { InviteInfo, invitesApi } from "@/modules/core/api";
import { rememberNext } from "@/modules/core/postLogin";
import { btnDark, btnOutline, btnPrimary, card, errorText, muted } from "@/modules/core/ui";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { t, locale } = useT();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invitesApi
      .lookup(token)
      .then(setInfo)
      .catch((e) => setLookupError(e instanceof ApiError && e.status === 404 ? t("Bu davet bağlantısı geçersiz.", "This invitation link is not valid.") : e instanceof Error ? e.message : ""));
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email?.toLowerCase() ?? null));
    // Dil değişince yeniden istemek gerekmiyor; yalnızca belirteç değişince.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function goLogin(register: boolean) {
    rememberNext(`/invite/${token}`);
    const q = new URLSearchParams({ email: info?.email ?? "" });
    if (register) q.set("mode", "register");
    router.push(`/login?${q}`);
  }

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const r = await invitesApi.accept(token);
      router.replace(`/${r.module}/${r.entity_id}`);
    } catch (e) {
      setError(errMsg(e, t("Davet kabul edilemedi", "Could not accept the invitation")));
      setBusy(false);
    }
  }

  async function switchAccount() {
    await api.auth.logout();
    setSessionEmail(null);
    goLogin(false);
  }

  const wrongAccount = !!info && !!sessionEmail && sessionEmail !== info.email;

  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-50 px-6 py-10 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-start justify-between">
          <Link href="/" aria-label={BRAND} className="inline-block">
            <Logo height={28} />
          </Link>
          <LangSwitch />
        </div>
        <div className={card}>
          {lookupError !== null ? (
            <p className={errorText}>{lookupError || t("Davet yüklenemedi.", "Could not load the invitation.")}</p>
          ) : !info || sessionEmail === undefined ? (
            <PageSpinner />
          ) : info.status !== "pending" ? (
            <>
              <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {info.status === "accepted" ? t("Bu davet kullanıldı", "This invitation was used") : info.status === "expired" ? t("Davetin süresi doldu", "The invitation has expired") : t("Davet iptal edildi", "The invitation was cancelled")}
              </h1>
              <p className={`${muted} mt-2`}>
                {info.status === "accepted"
                  ? t("Davet zaten kabul edildi. Giriş yaparak kayda ulaşabilirsin.", "The invitation was already accepted. Sign in to reach the record.")
                  : t(`${info.inviter || "Davet eden kişiden"} yeni bir davet isteyebilirsin.`, `You can ask ${info.inviter || "the sender"} for a new invitation.`)}
              </p>
              <Link href="/dashboard" className={`${btnOutline} mt-4`}>
                {t("Ulagg'a git", "Go to Ulagg")}
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {t(`${info.inviter} seni davet etti`, `${info.inviter} invited you`)}
              </h1>
              <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
                {t(
                  `${info.workspace_name} işletmesindeki “${info.entity_name}” kaydına erişim. Fiyat listeni güncel tutabilir, iş ve belge paylaşabilirsin. İşletmenin mağaza, sipariş ve finans bilgileri sana kapalıdır.`,
                  `Access to the “${info.entity_name}” record at ${info.workspace_name}. You can keep your price list up to date and share jobs and documents. The business's shop, order and finance data stay private.`,
                )}
              </p>
              <p className={`${muted} mt-3`}>
                {t(`Davet ${info.email} adresine gönderildi · ${new Date(info.expires_at).toLocaleDateString(locale)} tarihine kadar geçerli.`, `Sent to ${info.email} · valid until ${new Date(info.expires_at).toLocaleDateString(locale)}.`)}
              </p>

              {error && <p className={`${errorText} mt-3`}>{error}</p>}

              <div className="mt-5 flex flex-wrap gap-2">
                {sessionEmail === null ? (
                  <>
                    <button type="button" onClick={() => goLogin(false)} className={btnDark}>
                      {t("Giriş yap", "Sign in")}
                    </button>
                    <button type="button" onClick={() => goLogin(true)} className={btnOutline}>
                      {t("Hesap aç", "Create an account")}
                    </button>
                  </>
                ) : wrongAccount ? (
                  <>
                    <p className="w-full text-sm text-amber-800 dark:text-amber-300">
                      {t(`Şu an ${sessionEmail} ile giriş yapmışsın. Daveti kabul etmek için ${info.email} ile giriş yap.`, `You are signed in as ${sessionEmail}. Sign in as ${info.email} to accept.`)}
                    </p>
                    <button type="button" onClick={() => void switchAccount()} className={btnDark}>
                      {t("Hesap değiştir", "Switch account")}
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void accept()} className={btnPrimary}>
                    {t("Daveti kabul et", "Accept invitation")}
                  </button>
                )}
              </div>
              <p className={`${muted} mt-4`}>
                {t("Şifren Ulagg'da saklanmaz; giriş güvenli kimlik servisimizle yapılır.", "Ulagg never stores your password; sign-in goes through our secure identity service.")}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

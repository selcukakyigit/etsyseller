"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { EntityApi, GUEST_PERMS, GuestPerm } from "../core/api";
import { errMsg } from "../core/errors";
import { btnDanger, btnLink, btnPrimary, card, h2, input, muted, rowBorder } from "../core/ui";

const PERM_LABELS: Record<GuestPerm, [string, string]> = {
  "prices.edit": ["Fiyat listesini düzenleyebilir", "Can edit the price list"],
  "jobs.create": ["İş ekleyip gönderebilir", "Can add and send jobs"],
  "documents.upload": ["Belge yükleyebilir", "Can upload documents"],
};

function PermChecks({ value, onChange, disabled }: { value: GuestPerm[]; onChange: (v: GuestPerm[]) => void; disabled?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {GUEST_PERMS.map((p) => (
        <label key={p} className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.includes(p)}
            onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))}
            className="h-4 w-4 accent-[#D97757]"
          />
          {t(PERM_LABELS[p][0], PERM_LABELS[p][1])}
        </label>
      ))}
    </div>
  );
}

/** Kayda dışarıdan kişi davet etme ve erişimleri yönetme. Davet edilen kişi yalnızca bu kaydı görür; mağazalar,
 * siparişler, finans ve ürün dağıtımı ona kapalıdır. */
export default function SharingPanel({ api, entityId, whoTr, whoEn }: { api: EntityApi; entityId: number; whoTr: string; whoEn: string }) {
  const { t, locale } = useT();
  const { data, error, reload } = useApiData(`modkit-sharing:${api.base}:${entityId}`, () => api.sharing.overview(entityId));
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState<GuestPerm[]>([...GUEST_PERMS]);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmEl] = useConfirm();

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      reload();
    } catch (e) {
      toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
    }
    setBusy(false);
  }

  async function invite() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast.error(t("Geçerli bir e-posta adresi yaz", "Enter a valid email address"));
      return;
    }
    await run(async () => {
      const r = await api.sharing.invite(entityId, email.trim(), perms);
      if (!r.sent) toast.info(t("Davet oluşturuldu ama e-posta gönderilemedi; tekrar göndermeyi dene.", "The invitation was created but the email could not be sent; try resending."));
      setEmail("");
    }, t("Davet gönderildi", "Invitation sent"));
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className={h2}>{t(`${whoTr} davet et`, `Invite ${whoEn}`)}</h2>
        <p className={`${muted} mb-3`}>
          {t(
            "Davet e-postasındaki bağlantıyla, yalnızca bu e-posta adresiyle giriş yapan ya da hesap açan kişi katılabilir. Şifreyi Ulagg görmez; giriş, kendi hesabıyla yapılır. Davet 7 gün geçerlidir.",
            "Only someone who signs in or signs up with this email address can join through the link in the invitation. Ulagg never sees passwords; they sign in with their own account. The invitation is valid for 7 days.",
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} placeholder="ornek@firma.com" className={`${input} min-w-0 flex-1 sm:max-w-sm`} aria-label={t("E-posta", "Email")} />
          <button type="button" disabled={busy || !email.trim()} onClick={() => void invite()} className={btnPrimary}>
            {t("Davet gönder", "Send invitation")}
          </button>
        </div>
        <div className="mt-3">
          <PermChecks value={perms} onChange={setPerms} disabled={busy} />
        </div>
        <p className={`${muted} mt-3`}>
          {t(
            "Fiyat listesinde yapılan her değişiklik kayıt akışına yazılır ve sana e-postayla bildirilir; eski fiyatlar silinmez.",
            "Every price-list change is written to the activity feed and emailed to you; old prices are never deleted.",
          )}
        </p>
      </section>

      <section className={card}>
        <h2 className={`${h2} mb-3`}>{t("Erişimi olanlar", "People with access")}</h2>
        {error && !data && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!data ? (
          <BlockSpinner />
        ) : data.grants.length === 0 && data.invites.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">{t("Henüz kimse davet edilmedi.", "No one has been invited yet.")}</p>
        ) : (
          <ul>
            {data.grants.map((g) => (
              <li key={`g${g.id}`} className={`${rowBorder} py-3 last:border-0`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{g.name || g.email}</div>
                    <div className={muted}>
                      {g.email} · {t("katıldı", "joined")} {new Date(g.created_at).toLocaleDateString(locale)}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (await confirm({ title: t("Erişim kaldırılsın mı?", "Remove access?"), message: g.email, destructive: true, confirmLabel: t("Kaldır", "Remove") }))
                        await run(() => api.sharing.removeGrant(entityId, g.id));
                    }}
                    className={btnDanger}
                  >
                    {t("Erişimi kaldır", "Remove access")}
                  </button>
                </div>
                <div className="mt-2">
                  <PermChecks value={g.permissions} disabled={busy} onChange={(v) => void run(() => api.sharing.updateGrant(entityId, g.id, v), t("Yetkiler güncellendi", "Permissions updated"))} />
                </div>
              </li>
            ))}
            {data.invites.map((i) => (
              <li key={`i${i.id}`} className={`${rowBorder} flex flex-wrap items-center justify-between gap-2 py-3 last:border-0`}>
                <div className="min-w-0">
                  <div className="truncate text-sm text-neutral-900 dark:text-neutral-100">{i.email}</div>
                  <div className={`text-xs ${i.status === "expired" ? "text-amber-700 dark:text-amber-400" : "text-neutral-500 dark:text-neutral-400"}`}>
                    {i.status === "expired"
                      ? t("Davetin süresi doldu", "Invitation expired")
                      : t(`Davet bekliyor · ${new Date(i.expires_at).toLocaleDateString(locale)} tarihine kadar`, `Invitation pending · until ${new Date(i.expires_at).toLocaleDateString(locale)}`)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" disabled={busy} onClick={() => void run(() => api.sharing.resend(entityId, i.id), t("Davet yeniden gönderildi", "Invitation resent"))} className={btnLink}>
                    {t("Yeniden gönder", "Resend")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void run(() => api.sharing.revoke(entityId, i.id))} className={btnDanger}>
                    {t("İptal et", "Cancel")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {confirmEl}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { Badge, Field, errorText, inputClass } from "@/components/admin/ui";
import { Spinner } from "@/components/ui/Spinner";
import { AdminProduct, AdminUser, AdminUserStatus, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

/** Kullanıcı satırındaki "⋯" menüsü ve her işlemin penceresi. Liste ve detay sayfası aynısını kullanır. */

export type UserAction = "details" | "credits" | "note" | "plan" | "end_plan" | "password" | "role" | "suspend" | "block" | "activate" | "delete";

const btnDanger = btnPrimary.replace("bg-neutral-900", "bg-red-600").replace("hover:bg-neutral-700", "hover:bg-red-700");

/** Menüde gösterilecek işlemler: sunucu ayarındaki yöneticiye ve yöneticilere yalnızca zararsız işlemler. */
function actionsFor(u: AdminUser, inDetail: boolean): UserAction[][] {
  const first: UserAction[] = inDetail ? ["credits", "note", "plan"] : ["details", "credits", "note", "plan"];
  if (u.plan_manual) first.push("end_plan");
  first.push("password");
  if (u.env_admin) return [first];
  const second: UserAction[] = ["role"];
  const third: UserAction[] = u.status === "active" ? (u.role === "admin" ? [] : ["suspend", "block"]) : ["activate"];
  const fourth: UserAction[] = u.role === "admin" ? [] : ["delete"];
  return [first, second, third, fourth].filter((g) => g.length > 0);
}

const ICONS: Record<UserAction, string> = {
  details: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z",
  credits: "M12 5v14M5 12h14",
  note: "M4 5h16v11H8l-4 4V5z",
  plan: "M3 7l4 4 5-6 5 6 4-4-2 11H5L3 7z",
  end_plan: "M6 6l12 12M18 6L6 18",
  password: "M15 7a4 4 0 11-3.9 5H7v3H4v-3h-.5M15 7h.01",
  role: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0",
  suspend: "M10 6v12M14 6v12",
  block: "M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8",
  activate: "M5 12l5 5L20 7",
  delete: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
};
const DANGER: UserAction[] = ["suspend", "block", "delete", "end_plan"];

function label(a: UserAction, u: AdminUser | null, t: (tr: string, en: string) => string): string {
  switch (a) {
    case "details":
      return t("Detayları gör", "View details");
    case "credits":
      return t("Kredi ekle / düş", "Add or remove credits");
    case "note":
      return t("Not ekle", "Add note");
    case "plan":
      return t("Plan ata", "Assign plan");
    case "end_plan":
      return t("Verilen planı bitir", "End assigned plan");
    case "password":
      return t("Şifre sıfırlama e-postası", "Send password reset");
    case "role":
      return u?.role === "admin" ? t("Kullanıcı yap", "Make user") : t("Yönetici yap", "Make admin");
    case "suspend":
      return t("Askıya al", "Suspend");
    case "block":
      return t("Engelle", "Block");
    case "activate":
      return t("Etkinleştir", "Activate");
    case "delete":
      return t("Kullanıcıyı sil", "Delete user");
  }
}

export function UserActionsMenu({ user, inDetail = false, onSelect }: { user: AdminUser; inDetail?: boolean; onSelect: (a: UserAction) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 0;
    // Aşağıda yer yoksa düğmenin üstüne açılır.
    const top = r.bottom + height + 8 > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("İşlemler", "Actions")}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ top: pos?.top ?? -9999, right: pos?.right ?? 0 }}
            className="fixed z-[90] w-60 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          >
            <p className="px-3.5 pb-1 pt-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("İşlemler", "Actions")}</p>
            {actionsFor(user, inDetail).map((group, i) => (
              <div key={i} className={i > 0 ? "border-t border-neutral-100 pt-1 dark:border-neutral-800" : ""}>
                {group.map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onSelect(a);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      a === "delete" ? "text-red-600 dark:text-red-400" : DANGER.includes(a) ? "text-[#C6613F] dark:text-[#D97757]" : "text-neutral-800 dark:text-neutral-100"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0" aria-hidden>
                      <path d={ICONS[a]} />
                    </svg>
                    {label(a, user, t)}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function Dialog({
  title,
  children,
  confirmLabel,
  busy,
  disabled,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Modal
      z={100}
      widthClass="max-w-md"
      title={title}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || disabled} className={`${destructive ? btnDanger : btnPrimary} inline-flex items-center gap-2 disabled:opacity-50`}>
            {busy && <Spinner size={14} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-300">{children}</div>
    </Modal>
  );
}

/** Tek kullanıcıya uygulanan işlemin penceresi. `action` null ise hiçbir şey çizmez. */
export function UserActionDialog({ user, action, onClose, onDone }: { user: AdminUser; action: UserAction | null; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [bucket, setBucket] = useState<"plan" | "purchased">("purchased");
  const [text, setText] = useState("");
  const [months, setMonths] = useState("1");
  const [productId, setProductId] = useState<number | null>(null);
  const [plans, setPlans] = useState<AdminProduct[] | null>(null);

  useEffect(() => {
    if (action !== "plan") return;
    let alive = true;
    api.admin
      .billing()
      .then((b) => {
        if (!alive) return;
        const list = b.products.filter((p) => p.kind === "plan");
        setPlans(list);
        setProductId((cur) => cur ?? list.find((p) => p.active)?.id ?? list[0]?.id ?? null);
      })
      .catch((e) => errorText(e) && toast.error(errorText(e)));
    return () => {
      alive = false;
    };
  }, [action]);

  if (action === null || action === "details") return null;

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      onDone();
      onClose();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const who = user.name ? `${user.name} (${user.email})` : user.email;
  const value = Number(amount);

  switch (action) {
    case "credits":
      return (
        <Dialog
          title={t("Kredi ekle / düş", "Add or remove credits")}
          confirmLabel={t("Uygula", "Apply")}
          busy={busy}
          disabled={!Number.isInteger(value) || value === 0}
          onClose={onClose}
          onConfirm={() => void run(() => api.admin.userCredits(user.id, value, bucket, text.trim()), t("Bakiye güncellendi", "Balance updated"))}
        >
          <p>{who}</p>
          <Field label={t("Miktar (eksi değer düşer)", "Amount (negative removes)")}>
            <input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" className={inputClass} />
          </Field>
          <Field label={t("Kova", "Bucket")} hint={t("Plan kredisi dönem sonunda sıfırlanır; satın alınan süresizdir.", "Plan credits reset each period; purchased credits never expire.")}>
            <select value={bucket} onChange={(e) => setBucket(e.target.value as "plan" | "purchased")} className={inputClass}>
              <option value="purchased">{t("Satın alınan", "Purchased")}</option>
              <option value="plan">{t("Plan", "Plan")}</option>
            </select>
          </Field>
          <Field label={t("Not (isteğe bağlı)", "Note (optional)")}>
            <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} className={inputClass} />
          </Field>
        </Dialog>
      );
    case "note":
      return (
        <Dialog
          title={t("Not ekle", "Add note")}
          confirmLabel={t("Kaydet", "Save")}
          busy={busy}
          disabled={!text.trim()}
          onClose={onClose}
          onConfirm={() => void run(() => api.admin.userAddNote(user.id, text.trim()), t("Not eklendi", "Note added"))}
        >
          <p>{who}</p>
          <textarea autoFocus value={text} maxLength={2000} rows={4} onChange={(e) => setText(e.target.value)} className={inputClass} placeholder={t("Yalnızca yöneticiler görür.", "Only admins can see this.")} />
        </Dialog>
      );
    case "plan":
      return (
        <Dialog
          title={t("Plan ata", "Assign plan")}
          confirmLabel={t("Ata", "Assign")}
          busy={busy}
          disabled={productId === null}
          onClose={onClose}
          onConfirm={() => productId !== null && void run(() => api.admin.userAssignPlan(user.id, productId, Number(months)), t("Plan atandı", "Plan assigned"))}
        >
          <p>
            {t(
              "Ödeme alınmadan plan verilir (hediye, destek, ortaklık). Plan kredisi hemen yüklenir ve her dönem yenilenir; süre dolunca plan biter. Ücretli aboneliği olan kullanıcıya verilemez.",
              "Gives a plan without payment (gift, support, partnership). Plan credits are added now and renew each period; the plan ends when the time is up. Not available for users with a paid subscription.",
            )}
          </p>
          {plans === null ? (
            <Spinner />
          ) : plans.length === 0 ? (
            <p className="text-amber-700 dark:text-amber-300">{t("Önce Satış sayfasından bir plan ekleyin.", "Add a plan on the Sales page first.")}</p>
          ) : (
            <>
              <Field label={t("Plan", "Plan")}>
                <select value={productId ?? ""} onChange={(e) => setProductId(Number(e.target.value))} className={inputClass}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t(p.name_tr, p.name_en)} · {p.credits} {t("kredi", "credits")}
                      {p.active ? "" : ` (${t("satışta değil", "not for sale")})`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Süre (ay)", "Duration (months)")}>
                <select value={months} onChange={(e) => setMonths(e.target.value)} className={inputClass}>
                  {[1, 3, 6, 12, 24].map((m) => (
                    <option key={m} value={m}>
                      {t(`${m} ay`, `${m} month${m > 1 ? "s" : ""}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </Dialog>
      );
    case "end_plan":
      return (
        <Dialog
          title={t("Verilen planı bitir", "End assigned plan")}
          confirmLabel={t("Planı bitir", "End plan")}
          destructive
          busy={busy}
          onClose={onClose}
          onConfirm={() => void run(() => api.admin.userEndPlan(user.id), t("Plan bitirildi", "Plan ended"))}
        >
          <p>{t(`${who} için elle verilen plan hemen biter ve plan kredisi sıfırlanır. Satın alınan krediler kalır.`, `The assigned plan for ${who} ends now and plan credits are cleared. Purchased credits stay.`)}</p>
        </Dialog>
      );
    case "password":
      return (
        <Dialog
          title={t("Şifre sıfırlama e-postası", "Send password reset")}
          confirmLabel={t("Gönder", "Send")}
          busy={busy}
          onClose={onClose}
          onConfirm={() => void run(() => api.admin.userPasswordReset(user.id), t("E-posta gönderildi", "Email sent"))}
        >
          <p>{t(`${user.email} adresine yeni şifre belirleme bağlantısı gönderilir. Mevcut şifre, kullanıcı yenisini belirleyene kadar çalışmaya devam eder.`, `A link to set a new password is sent to ${user.email}. The current password keeps working until the user sets a new one.`)}</p>
        </Dialog>
      );
    case "role": {
      const next = user.role === "admin" ? "user" : "admin";
      return (
        <Dialog
          title={next === "admin" ? t("Yönetici yap", "Make admin") : t("Kullanıcı yap", "Make user")}
          confirmLabel={t("Onayla", "Confirm")}
          destructive={next === "admin"}
          busy={busy}
          onClose={onClose}
          onConfirm={() => void run(() => api.admin.userRole(user.id, next), t("Rol güncellendi", "Role updated"))}
        >
          <p>
            {next === "admin"
              ? t(`${who} yönetim paneline tam erişim kazanır: kullanıcıları, kredileri, anahtarları ve satışı değiştirebilir.`, `${who} gets full access to the admin panel: users, credits, keys and sales.`)
              : t(`${who} yönetim paneline erişimini kaybeder.`, `${who} loses access to the admin panel.`)}
          </p>
        </Dialog>
      );
    }
    case "suspend":
    case "block":
    case "activate": {
      const status: AdminUserStatus = action === "suspend" ? "suspended" : action === "block" ? "blocked" : "active";
      const copy = {
        suspended: [
          t("Askıya al", "Suspend"),
          t("Kullanıcı giriş yapabilir ama uygulamayı kullanamaz; neden ve destek bilgisi gösterilir. Mağaza senkronları sürer.", "The user can sign in but cannot use the app; a notice with support info is shown. Shop syncs continue."),
        ],
        blocked: [
          t("Engelle", "Block"),
          t("Kullanıcı giriş yapamaz, açık oturumları da reddedilir. Mağaza senkronları sürer.", "The user cannot sign in and open sessions are refused. Shop syncs continue."),
        ],
        active: [t("Etkinleştir", "Activate"), t("Kullanıcı uygulamayı yeniden kullanabilir.", "The user can use the app again.")],
      }[status];
      return (
        <Dialog
          title={copy[0]}
          confirmLabel={copy[0]}
          destructive={status !== "active"}
          busy={busy}
          onClose={onClose}
          onConfirm={() => void run(() => api.admin.userStatus(user.id, status, text.trim()), t("Durum güncellendi", "Status updated"))}
        >
          <p>{who}</p>
          <p>{copy[1]}</p>
          {status !== "active" && (
            <Field label={t("Neden (iç not, isteğe bağlı)", "Reason (internal, optional)")}>
              <input autoFocus value={text} maxLength={300} onChange={(e) => setText(e.target.value)} className={inputClass} />
            </Field>
          )}
        </Dialog>
      );
    }
    case "delete":
      return (
        <Dialog
          title={t("Kullanıcıyı sil", "Delete user")}
          confirmLabel={t("Kalıcı olarak sil", "Delete permanently")}
          destructive
          busy={busy}
          disabled={text.trim().toLowerCase() !== user.email.toLowerCase()}
          onClose={onClose}
          onConfirm={() => void run(() => api.admin.userDelete(user.id, text.trim()), t("Kullanıcı silindi", "User deleted"))}
        >
          <p>
            {t(
              "Hesap, giriş kaydı, mağaza bağlantıları ve tüm veriler kalıcı olarak silinir; aktif abonelik iptal edilir. Geri alınamaz.",
              "The account, sign-in record, shop connections and all data are deleted permanently; any active subscription is cancelled. This cannot be undone.",
            )}
          </p>
          <Field label={t(`Onaylamak için ${user.email} yaz`, `Type ${user.email} to confirm`)}>
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} className={inputClass} autoComplete="off" />
          </Field>
        </Dialog>
      );
  }
}

/** Liste ve detay sayfası için: menüden seçilen işlemi açar ("details" detay sayfasına gider). */
export function useUserAction(onDone: (action: UserAction) => void) {
  const router = useRouter();
  const [state, setState] = useState<{ user: AdminUser; action: UserAction } | null>(null);
  const open = (user: AdminUser, action: UserAction) => {
    if (action === "details") router.push(`/admin/users/${user.id}`);
    else setState({ user, action });
  };
  const dialog = state ? (
    <UserActionDialog key={`${state.user.id}:${state.action}`} user={state.user} action={state.action} onClose={() => setState(null)} onDone={() => onDone(state.action)} />
  ) : null;
  return { open, dialog };
}

export function StatusBadge({ user }: { user: AdminUser }) {
  const { t } = useT();
  if (user.status === "suspended") return <Badge tone="warn">{t("Askıda", "Suspended")}</Badge>;
  if (user.status === "blocked") return <Badge tone="bad">{t("Engelli", "Blocked")}</Badge>;
  return <Badge tone="good">{t("Aktif", "Active")}</Badge>;
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Avatar from "@/components/Avatar";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, Button, EmptyState, Section, StatCard, errorText, inputClass, useFormat } from "@/components/admin/ui";
import { StatusBadge, UserActionsMenu, useUserAction } from "@/components/admin/userActions";
import { BlockSpinner } from "@/components/ui/Spinner";
import { AdminUserDetail, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";

const KIND_NAMES: Record<string, [string, string]> = {
  usage: ["Kullanım", "Usage"],
  purchase: ["Paket satın alma", "Pack purchase"],
  plan_reset: ["Plan dönemi", "Plan period"],
  grant: ["Hediye", "Gift"],
  adjust: ["Yönetici düzeltmesi", "Admin adjustment"],
  refund: ["İade", "Refund"],
};
const ACTION_NAMES: Record<string, [string, string]> = {
  "user.credits": ["Kredi düzeltildi", "Credits adjusted"],
  "user.note": ["Not eklendi", "Note added"],
  "user.note_delete": ["Not silindi", "Note deleted"],
  "user.plan": ["Plan atandı", "Plan assigned"],
  "user.plan_end": ["Plan bitirildi", "Plan ended"],
  "user.password_reset": ["Şifre sıfırlama gönderildi", "Password reset sent"],
  "user.role": ["Rol değişti", "Role changed"],
  "user.status": ["Durum değişti", "Status changed"],
  "user.bulk.credits": ["Toplu kredi", "Bulk credits"],
  "user.bulk.suspend": ["Toplu askıya alma", "Bulk suspend"],
  "user.bulk.block": ["Toplu engelleme", "Bulk block"],
  "user.bulk.activate": ["Toplu etkinleştirme", "Bulk activate"],
};

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const { t } = useT();
  const id = Number(params.id);
  return (
    <AdminShell current="/admin/users" title={t("Kullanıcı", "User")}>
      {Number.isInteger(id) && id > 0 ? <Detail id={id} /> : <EmptyState>{t("Kullanıcı bulunamadı.", "User not found.")}</EmptyState>}
    </AdminShell>
  );
}

function Detail({ id }: { id: number }) {
  const { t } = useT();
  const f = useFormat();
  const router = useRouter();
  const { data, error, reload } = useApiData(`admin:user:${id}`, () => api.admin.user(id));
  const action = useUserAction((done) => (done === "delete" ? router.push("/admin/users") : reload()));

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;
  const u = data.user;

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="inline-block text-sm text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
        ← {t("Kullanıcılar", "Users")}
      </Link>

      <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar user={u} size={56} className="flex-shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">{u.name || u.email}</p>
            <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{u.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge user={u} />
              {u.role === "admin" && <Badge tone="warn">{u.env_admin ? t("Yönetici (sunucu)", "Admin (server)") : t("Yönetici", "Admin")}</Badge>}
              {u.plan ? <Badge tone="good">{u.plan}{u.plan_manual ? ` · ${t("elle", "manual")}` : ""}</Badge> : <Badge tone="muted">{t("Ücretsiz", "Free")}</Badge>}
              {!u.ai_enabled && <Badge tone="muted">{t("AI kapalı", "AI off")}</Badge>}
            </div>
            {u.status !== "active" && u.status_reason && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("Neden", "Reason")}: {u.status_reason}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button onClick={reload}>{t("Yenile", "Refresh")}</Button>
          <UserActionsMenu user={u} inDetail onSelect={(a) => action.open(u, a)} />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("Kredi", "Credits")}
          value={f.num(data.balance_plan + data.balance_purchased)}
          hint={t(`plan ${f.num(data.balance_plan)} · satın alınan ${f.num(data.balance_purchased)}`, `plan ${f.num(data.balance_plan)} · purchased ${f.num(data.balance_purchased)}`)}
        />
        <StatCard label={t("AI çağrısı (30 gün)", "AI calls (30 days)")} value={f.num(u.ai_requests_30d)} />
        <StatCard label={t("Kayıt", "Joined")} value={<span className="text-base">{f.date(u.created_at)}</span>} />
        <StatCard label={t("Son aktif", "Last active")} value={<span className="text-base">{f.dateTime(u.last_seen_at)}</span>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("Mağazalar", "Shops")}>
          {u.shops.length === 0 ? (
            <EmptyState>{t("Bağlı mağaza yok.", "No connected shops.")}</EmptyState>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {u.shops.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-sm text-neutral-900 dark:text-neutral-100">{s.shop_name}</span>
                  <span className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                    {f.dateTime(s.listings_synced_at)}
                    <Badge tone={s.is_demo ? "muted" : s.revoked ? "bad" : s.connected ? "good" : "warn"}>
                      {s.is_demo ? t("demo", "demo") : s.revoked ? t("erişim kaldırıldı", "revoked") : s.connected ? t("bağlı", "connected") : t("bağlı değil", "not connected")}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("Abonelikler", "Subscriptions")}>
          {data.subscriptions.length === 0 ? (
            <EmptyState>{t("Abonelik yok.", "No subscriptions.")}</EmptyState>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.subscriptions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-neutral-900 dark:text-neutral-100">
                    {s.product ?? "—"}
                    {s.manual && <span className="ml-1.5 text-xs text-neutral-500 dark:text-neutral-400">({t("elle verildi", "assigned")})</span>}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                    {s.ends_at ? `${t("Bitiş", "Ends")}: ${f.date(s.ends_at)}` : s.renews_at ? `${t("Yenilenme", "Renews")}: ${f.date(s.renews_at)}` : ""}
                    <Badge tone={s.status === "active" || s.status === "on_trial" ? "good" : "muted"}>{s.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Notes userId={u.id} notes={data.notes} onChanged={reload} />

      <Section title={t("Kredi hareketleri", "Credit activity")}>
        {data.ledger.length === 0 ? (
          <EmptyState>{t("Hareket yok.", "No activity.")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                  <th className="pb-2 font-medium">{t("Tarih", "Date")}</th>
                  <th className="pb-2 font-medium">{t("Tür", "Type")}</th>
                  <th className="pb-2 font-medium">{t("Ayrıntı", "Detail")}</th>
                  <th className="pb-2 text-right font-medium">{t("Değişim", "Change")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {data.ledger.map((r) => {
                  const kind = KIND_NAMES[r.kind];
                  return (
                    <tr key={r.id} className="text-neutral-800 dark:text-neutral-200">
                      <td className="whitespace-nowrap py-2 text-xs text-neutral-500 dark:text-neutral-400">{f.dateTime(r.created_at)}</td>
                      <td className="py-2">{kind ? t(kind[0], kind[1]) : r.kind}</td>
                      <td className="max-w-[280px] truncate py-2 text-xs text-neutral-500 dark:text-neutral-400">{[r.task, r.model, r.note].filter(Boolean).join(" · ")}</td>
                      <td className={`py-2 text-right tabular-nums ${r.delta > 0 ? "text-green-700 dark:text-green-400" : r.delta < 0 ? "" : "text-neutral-400 dark:text-neutral-500"}`}>
                        {r.delta !== 0 ? `${r.delta > 0 ? "+" : ""}${f.num(r.delta)}` : t(`(${r.credits} ölçüldü)`, `(${r.credits} measured)`)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("Yönetici işlemleri", "Admin activity")}>
        {data.audit.length === 0 ? (
          <EmptyState>{t("Bu kullanıcıda yönetici işlemi yok.", "No admin activity for this user.")}</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.audit.map((a) => {
              const name = ACTION_NAMES[a.action];
              return (
                <li key={a.id} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-neutral-800 dark:text-neutral-200">
                    {name ? t(name[0], name[1]) : a.action}
                    {a.detail && <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">{a.detail}</span>}
                  </span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {a.email} · {f.dateTime(a.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {action.dialog}
    </div>
  );
}

function Notes({ userId, notes, onChanged }: { userId: number; notes: AdminUserDetail["notes"]; onChanged: () => void }) {
  const { t } = useT();
  const f = useFormat();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<number | "add" | null>(null);

  async function add() {
    setBusy("add");
    try {
      await api.admin.userAddNote(userId, text.trim());
      setText("");
      onChanged();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(noteId: number) {
    setBusy(noteId);
    try {
      await api.admin.userDeleteNote(userId, noteId);
      onChanged();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title={t("Notlar", "Notes")}>
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <textarea value={text} rows={2} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={t("Yalnızca yöneticiler görür.", "Only admins can see this.")} className={inputClass} />
          <Button tone="primary" busy={busy === "add"} disabled={!text.trim() || busy !== null} onClick={() => void add()} className="sm:self-start">
            {t("Ekle", "Add")}
          </Button>
        </div>
        {notes.length === 0 ? (
          <EmptyState>{t("Not yok.", "No notes.")}</EmptyState>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-neutral-100 p-3 dark:border-neutral-800">
                <p className="whitespace-pre-wrap break-words text-sm text-neutral-800 dark:text-neutral-200">{n.text}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>
                    {n.author_email} · {f.dateTime(n.created_at)}
                  </span>
                  <Button tone="danger" busy={busy === n.id} disabled={busy !== null} onClick={() => void remove(n.id)} className="px-2 py-0.5 text-xs">
                    {t("Sil", "Delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

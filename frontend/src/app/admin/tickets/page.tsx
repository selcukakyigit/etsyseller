"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, Button, EmptyState, Section, inputClass, useFormat } from "@/components/admin/ui";
import CannedManager from "@/components/support/CannedManager";
import Composer from "@/components/support/Composer";
import { RatingBadge, StatusBadge, WaitBadge, categoryLabel } from "@/components/support/meta";
import Thread from "@/components/support/Thread";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { AdminTicketDetail, AdminTicketSummary, adminTicketsApi, CannedReply, TicketStatus } from "@/lib/supportApi";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";

type Filter = "open" | "resolved" | "all";

function errorText(e: unknown) {
  return e instanceof Error && e.message ? e.message : "";
}

export default function AdminTicketsPage() {
  return (
    <AdminShell current="/admin/tickets">
      <Suspense fallback={null}>
        <Tickets />
      </Suspense>
    </AdminShell>
  );
}

function Tickets() {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const id = Number(params.get("id")) || null;
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const { data, setData, error, loading } = useApiData(`admin:tickets:${filter}:${q}`, () => adminTicketsApi.list(filter, q));
  const canned = useApiData("admin:tickets:canned", () => adminTicketsApi.canned());
  const setCanned = (next: CannedReply[]) => canned.setData(next);

  function patchRow(updated: AdminTicketDetail) {
    if (!data) return;
    const stays = filter === "all" || (filter === "resolved") === (updated.status === "resolved");
    const row: AdminTicketSummary = { ...updated, admin_unread: false };
    setData(stays ? data.map((r) => (r.id === row.id ? row : r)) : data.filter((r) => r.id !== row.id));
  }

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
        filter === value
          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <div className={id ? "hidden lg:block" : ""}>
        <Section
          title={t("Destek talepleri", "Support requests")}
          action={
            <div className="flex items-center gap-2">
              {loading && data && <Spinner size={16} />}
              <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
                {filterButton("open", t("Açık", "Open"))}
                {filterButton("resolved", t("Çözülen", "Resolved"))}
                {filterButton("all", t("Tümü", "All"))}
              </div>
            </div>
          }
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Konu ya da e-posta ara…", "Search subject or email…")} className={`${inputClass} mb-3`} />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {!data && !error && <BlockSpinner />}
          {data && data.length === 0 && <EmptyState>{t("Talep yok.", "No requests.")}</EmptyState>}
          {data && data.length > 0 && (
            <ul className="space-y-1.5">
              {data.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/admin/tickets?id=${r.id}`}
                    className={`block rounded-lg border p-2.5 transition ${
                      r.id === id ? "border-[#D97757] bg-[#D97757]/5" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
                    }`}
                  >
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {r.admin_unread && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[#D97757]" aria-label={t("Yeni", "New")} />}
                      <span className="truncate">
                        #{r.id} · {r.subject}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{r.user.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={r.status} admin />
                      <Badge tone="muted">{categoryLabel(t, r.category)}</Badge>
                      <WaitBadge since={r.updated_at} status={r.status} />
                      <RatingBadge rating={r.rating} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <details className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <summary className="cursor-pointer text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Hazır yanıtlar", "Canned replies")}</summary>
          <div className="mt-3">
            <CannedManager replies={canned.data ?? []} onChange={setCanned} />
          </div>
        </details>
      </div>
      <div className={id ? "" : "hidden lg:block"}>
        {id ? (
          <TicketPanel key={id} canned={canned.data ?? []} id={id} onChanged={patchRow} onBack={() => router.push("/admin/tickets")} />
        ) : (
          <EmptyState>{t("Soldan bir talep seç.", "Pick a request on the left.")}</EmptyState>
        )}
      </div>
    </div>
  );
}

function TicketPanel({ id, canned, onChanged, onBack }: { id: number; canned: CannedReply[]; onChanged: (t: AdminTicketDetail) => void; onBack: () => void }) {
  const { t } = useT();
  const f = useFormat();
  const [ticket, setTicket] = useState<AdminTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [internal, setInternal] = useState(false);
  const [resolve, setResolve] = useState(false);

  useEffect(() => {
    let live = true;
    adminTicketsApi
      .get(id)
      .then((r) => live && setTicket(r))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [id]);

  function apply(updated: AdminTicketDetail) {
    setTicket(updated);
    onChanged(updated);
  }

  async function reply(body: string, files: File[]) {
    setBusy(true);
    try {
      apply(await adminTicketsApi.reply(id, body, { internal, resolve: resolve && !internal }, files));
      setInternal(false);
      setResolve(false);
      if (!internal) toast.success(t("Yanıt kullanıcıya gönderildi.", "Reply sent to the user."));
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: TicketStatus) {
    setBusy(true);
    try {
      apply(await adminTicketsApi.setStatus(id, status));
      if (status === "resolved") toast.success(t("Tamamlandı; kullanıcıya bildirim gitti.", "Marked done; the user was notified."));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function resolveGroup() {
    setBusy(true);
    try {
      apply(await adminTicketsApi.resolveGroup(id));
      toast.success(t("Aynı hatayı bildiren talepler tamamlandı; kullanıcılara bildirim gitti.", "Requests with the same error were completed; users were notified."));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!ticket) return <BlockSpinner />;
  const c = ticket.context;
  return (
    <Section
      title={`#${ticket.id} · ${ticket.subject}`}
      action={
        <button type="button" onClick={onBack} className="text-xs text-neutral-500 hover:underline lg:hidden dark:text-neutral-400">
          ← {t("Liste", "List")}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <StatusBadge status={ticket.status} admin />
          <Badge tone="muted">{categoryLabel(t, ticket.category)}</Badge>
          <Link href={`/admin/users?q=${encodeURIComponent(ticket.user.email)}`} className="text-[#D97757] hover:text-[#C6613F]">
            {ticket.user.name ? `${ticket.user.name} · ` : ""}
            {ticket.user.email}
          </Link>
          <span>{f.dateTime(ticket.created_at)}</span>
          <WaitBadge since={ticket.updated_at} status={ticket.status} />
          <RatingBadge rating={ticket.rating} />
          <div className="ml-auto flex gap-1.5">
            {ticket.status !== "resolved" ? (
              <Button tone="primary" busy={busy} onClick={() => void setStatus("resolved")}>
                {t("Tamamlandı olarak işaretle", "Mark as done")}
              </Button>
            ) : (
              <Button busy={busy} onClick={() => void setStatus("open")}>
                {t("Yeniden aç", "Reopen")}
              </Button>
            )}
          </div>
        </div>

        {(ticket.similar.length > 0 || ticket.error_count > 0) && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">
              {t(
                `Aynı hata: bu talep dahil ${ticket.similar.length + 1} talep, otomatik yakalanma ${ticket.error_count} kez.`,
                `Same error: ${ticket.similar.length + 1} requests including this one, auto-captured ${ticket.error_count} times.`,
              )}
            </p>
            {ticket.similar.length > 0 && (
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {ticket.similar.map((s) => (
                  <li key={s.id}>
                    <Link href={`/admin/tickets?id=${s.id}`} className="underline">
                      #{s.id} {s.subject}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {[ticket, ...ticket.similar].some((x) => x.status !== "resolved") && ticket.similar.length > 0 && (
              <Button busy={busy} onClick={() => void resolveGroup()}>
                {t("Hepsini tamamla ve bildir", "Complete all and notify")}
              </Button>
            )}
          </div>
        )}

        <details className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800">
          <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-300">{t("Otomatik toplanan bilgiler", "Automatically collected info")}</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[110px_1fr]">
            {([
              [t("Sayfa", "Page"), c.url],
              [t("Önceki sayfa", "Previous page"), c.referrer],
              [t("Mağaza", "Shop"), c.shop],
              [t("Tarayıcı", "Browser"), c.user_agent],
              [t("Ekran", "Viewport"), c.viewport],
              [t("Tema / dil", "Theme / language"), [c.theme, c.lang].filter(Boolean).join(" / ")],
            ] as const).map(([label, value]) =>
              value ? (
                <div key={label} className="contents">
                  <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
                  <dd className="break-all text-neutral-800 dark:text-neutral-200">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {c.errors && c.errors.length > 0 && (
            <div className="mt-2">
              <p className="text-neutral-500 dark:text-neutral-400">{t("Son arayüz hataları", "Latest UI errors")}</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-neutral-100 p-2 text-[11px] text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">{c.errors.join("\n")}</pre>
            </div>
          )}
        </details>

        <Thread messages={ticket.messages} viewer="admin" openAttachment={adminTicketsApi.attachmentUrl} />

        <Composer
          busy={busy}
          rows={4}
          snippets={canned}
          placeholder={internal ? t("İç not (yalnızca yöneticiler görür)…", "Internal note (admins only)…") : t("Kullanıcıya yanıt yaz…", "Reply to the user…")}
          submitLabel={internal ? t("Notu kaydet", "Save note") : resolve ? t("Gönder ve tamamla", "Send and complete") : t("Yanıtla", "Reply")}
          onSubmit={reply}
          extra={
            <>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-[#D97757]" />
                {t("İç not", "Internal note")}
              </label>
              {!internal && ticket.status !== "resolved" && (
                <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} className="accent-[#D97757]" />
                  {t("Gönderince tamamla", "Complete on send")}
                </label>
              )}
            </>
          }
        />
      </div>
    </Section>
  );
}

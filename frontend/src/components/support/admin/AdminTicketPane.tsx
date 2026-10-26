"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, useFormat } from "@/components/admin/ui";
import Composer from "@/components/support/Composer";
import TicketControls from "@/components/support/admin/TicketControls";
import { PriorityBadge, RatingBadge, SourceBadge, StatusBadge, WaitBadge, categoryLabel } from "@/components/support/meta";
import Thread from "@/components/support/Thread";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { AdminTicketDetail, adminTicketsApi, CannedReply, TicketOptions, TicketPatch } from "@/lib/supportApi";
import { toast } from "@/lib/toast";

function errorText(e: unknown) {
  return e instanceof Error && e.message ? e.message : "";
}

/** Yöneticinin seçili talebi: bilgi, atama/öncelik/etiket denetimleri, aynı hatayı bildirenler, konuşma + iş kaydı ve yanıt kutusu. */
export default function AdminTicketPane({
  id,
  options,
  canned,
  onChanged,
  onBack,
}: {
  id: number;
  options: TicketOptions;
  canned: CannedReply[];
  onChanged: (t: AdminTicketDetail) => void;
  onBack: () => void;
}) {
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
      .then((r) => {
        if (!live) return;
        setTicket(r);
        onChanged(r);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
    // onChanged her render'da yeni olabilir; talep yalnızca numara değişince yeniden yüklenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Tek yol: istek, sonuçla talebi ve liste satırını güncelle, hata olursa bildir. */
  async function run(action: () => Promise<AdminTicketDetail>, success?: string) {
    setBusy(true);
    try {
      const next = await action();
      setTicket(next);
      onChanged(next);
      if (success) toast.success(success);
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const patch = (changes: TicketPatch, success?: string) => run(() => adminTicketsApi.update(id, changes), success);

  async function reply(body: string, files: File[]) {
    const sentInternal = internal;
    const ok = await run(
      () => adminTicketsApi.reply(id, body, { internal, resolve: resolve && !internal }, files),
      sentInternal ? undefined : t("Yanıt kullanıcıya gönderildi.", "Reply sent to the user."),
    );
    if (ok) {
      setInternal(false);
      setResolve(false);
    }
    return ok;
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!ticket) return <BlockSpinner />;
  const c = ticket.context;
  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <button type="button" onClick={onBack} className="text-sm text-neutral-500 hover:underline lg:hidden dark:text-neutral-400">
        ← {t("Liste", "List")}
      </button>
      <h2 className="break-words text-base font-semibold text-neutral-900 dark:text-neutral-100">
        #{ticket.id} · {ticket.subject}
      </h2>
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <StatusBadge status={ticket.status} admin />
        <Badge tone="muted">{categoryLabel(t, ticket.category)}</Badge>
        <PriorityBadge priority={ticket.priority} />
        <SourceBadge source={ticket.source} />
        <Link href={`/admin/users?q=${encodeURIComponent(ticket.user.email)}`} className="text-[#D97757] hover:text-[#C6613F]">
          {ticket.user.name ? `${ticket.user.name} · ` : ""}
          {ticket.user.email}
        </Link>
        <span>{f.dateTime(ticket.created_at)}</span>
        <WaitBadge since={ticket.updated_at} status={ticket.status} />
        <RatingBadge rating={ticket.rating} />
        <div className="ml-auto">
          {ticket.status !== "resolved" ? (
            <Button tone="primary" busy={busy} onClick={() => void patch({ status: "resolved" }, t("Tamamlandı; kullanıcıya bildirim gitti.", "Marked done; the user was notified."))}>
              {t("Tamamlandı olarak işaretle", "Mark as done")}
            </Button>
          ) : (
            <Button busy={busy} onClick={() => void patch({ status: "open" })}>
              {t("Yeniden aç", "Reopen")}
            </Button>
          )}
        </div>
      </div>

      <TicketControls ticket={ticket} options={options} busy={busy} onPatch={(changes) => void patch(changes)} />

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
            <Button
              busy={busy}
              onClick={() => void run(() => adminTicketsApi.resolveGroup(id), t("Aynı hatayı bildiren talepler tamamlandı; kullanıcılara bildirim gitti.", "Requests with the same error were completed; users were notified."))}
            >
              {t("Hepsini tamamla ve bildir", "Complete all and notify")}
            </Button>
          )}
        </div>
      )}

      <details className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800">
        <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-300">{t("Otomatik toplanan bilgiler", "Automatically collected info")}</summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[110px_1fr]">
          {(
            [
              [t("Sayfa", "Page"), c.url],
              [t("Önceki sayfa", "Previous page"), c.referrer],
              [t("Mağaza", "Shop"), c.shop],
              [t("Tarayıcı", "Browser"), c.user_agent],
              [t("Ekran", "Viewport"), c.viewport],
              [t("Tema / dil", "Theme / language"), [c.theme, c.lang].filter(Boolean).join(" / ")],
              [t("İlk yanıt", "First reply"), ticket.first_response_at ? f.dateTime(ticket.first_response_at) : ""],
            ] as const
          ).map(([label, value]) =>
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
        {c.chat && c.chat.length > 0 && (
          <div className="mt-2">
            <p className="text-neutral-500 dark:text-neutral-400">{t("Asistan sohbetinin son mesajları", "Latest assistant chat messages")}</p>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 p-2 text-[11px] text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">{c.chat.join("\n")}</pre>
          </div>
        )}
      </details>

      <Thread messages={ticket.messages} viewer="admin" openAttachment={adminTicketsApi.attachmentUrl} events={ticket.events} labels={options.labels} />

      <Composer
        busy={busy}
        rows={4}
        snippets={canned}
        draftKey={`support:admin-reply:${id}`}
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
  );
}

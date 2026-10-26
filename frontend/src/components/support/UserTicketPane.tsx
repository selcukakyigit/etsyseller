"use client";

import { useEffect, useState } from "react";
import { Badge, Button, useFormat } from "@/components/admin/ui";
import Composer from "@/components/support/Composer";
import { StatusBadge, categoryLabel } from "@/components/support/meta";
import Thread from "@/components/support/Thread";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { supportApi, TicketDetail } from "@/lib/supportApi";
import { toast } from "@/lib/toast";
import { notifySupportUnreadChanged } from "@/lib/useSupportUnread";

function errorText(e: unknown) {
  return e instanceof Error && e.message ? e.message : "";
}

/** Kullanıcının seçili talebi: konuşma, yanıt kutusu, "çözüldü" ve puan. Talep her değiştiğinde `onChanged` ile liste satırı da güncellenir. */
export default function UserTicketPane({ id, onChanged }: { id: number; onChanged: (t: TicketDetail) => void }) {
  const { t } = useT();
  const f = useFormat();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    supportApi
      .get(id)
      .then((r) => {
        if (!live) return;
        setTicket(r);
        onChanged(r);
        notifySupportUnreadChanged(); // açmak okundu yapar
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
    // onChanged her render'da yeni olabilir; talep yalnızca numara değişince yeniden yüklenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function run(action: () => Promise<TicketDetail>, after?: () => void) {
    setBusy(true);
    try {
      const next = await action();
      setTicket(next);
      onChanged(next);
      after?.();
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!ticket) return <BlockSpinner />;
  const resolved = ticket.status === "resolved";
  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 break-words text-base font-semibold text-neutral-900 dark:text-neutral-100">
          #{ticket.id} · {ticket.subject}
        </h2>
        <Badge tone="muted">{categoryLabel(t, ticket.category)}</Badge>
        <StatusBadge status={ticket.status} />
      </div>
      <p className="text-xs text-neutral-400 dark:text-neutral-500">{t(`Açıldı: ${f.dateTime(ticket.created_at)}`, `Opened: ${f.dateTime(ticket.created_at)}`)}</p>
      {resolved && (
        <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          <p>{t("Bu talep tamamlandı. Hâlâ sorun varsa aşağıdan yanıtla; talep yeniden açılır.", "This request is done. If the problem remains, reply below and it will reopen.")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {ticket.rating ? (
              <span>{t("Geri bildirimin için teşekkürler.", "Thanks for your feedback.")}</span>
            ) : (
              <>
                <span>{t("Bu yardım işe yaradı mı?", "Did this help?")}</span>
                <Button onClick={() => void run(() => supportApi.rate(id, 1))} disabled={busy}>
                  👍 {t("Evet", "Yes")}
                </Button>
                <Button onClick={() => void run(() => supportApi.rate(id, -1))} disabled={busy}>
                  👎 {t("Hayır", "No")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <Thread messages={ticket.messages} viewer="user" openAttachment={supportApi.attachmentUrl} />
      <Composer
        busy={busy}
        draftKey={`support:reply:${id}`}
        placeholder={t("Yanıtını yaz… (ekran görüntüsünü yapıştırabilirsin)", "Write your reply… (you can paste a screenshot)")}
        submitLabel={resolved ? t("Yeniden aç ve gönder", "Reopen and send") : t("Gönder", "Send")}
        onSubmit={(body, files) => run(() => supportApi.reply(id, body, files))}
        extra={
          !resolved && (
            <Button onClick={() => void run(() => supportApi.resolve(id), () => notifySupportUnreadChanged())} disabled={busy}>
              {t("Çözüldü, gerek kalmadı", "Solved, no longer needed")}
            </Button>
          )
        }
      />
    </div>
  );
}

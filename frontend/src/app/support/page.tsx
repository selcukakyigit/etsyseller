"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Badge, Button, EmptyState, Field, inputClass, useFormat } from "@/components/admin/ui";
import { pageContainer } from "@/components/layout/pageContainer";
import Composer from "@/components/support/Composer";
import { CATEGORIES, StatusBadge, categoryLabel } from "@/components/support/meta";
import Thread from "@/components/support/Thread";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner, PageSpinner } from "@/components/ui/Spinner";
import { buildSupportContext } from "@/lib/clientErrors";
import { useT } from "@/lib/i18n-client";
import { supportApi, TicketCategory, TicketDetail } from "@/lib/supportApi";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import { notifySupportUnreadChanged } from "@/lib/useSupportUnread";

function errorText(e: unknown) {
  return e instanceof Error && e.message ? e.message : "";
}

function SupportPageInner() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  const params = useSearchParams();
  const id = Number(params.get("id")) || null;
  const creating = params.get("new") === "1";

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/support">
      <div className={pageContainer("reading", "normal", "space-y-5")}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {t("Yardım & Destek", "Help & Support")}
            <HelpTip>
              {t(
                "Bir hata görürsen ya da bir şeyi anlamazsan buradan talep aç; ekran görüntüsünü yapıştırabilirsin. Yanıt gelince ya da isteğin tamamlanınca burada ve e-postayla haber verilir. Talep açarken bulunduğun sayfa, tarayıcın ve son görülen hatalar otomatik eklenir.",
                "If you see a bug or something is unclear, open a request here and paste a screenshot. You are notified here and by email when we reply or when your request is done. The page you are on, your browser and the latest errors are attached automatically.",
              )}
            </HelpTip>
          </h1>
          {!creating && !id && (
            <Link href="/support?new=1" className="rounded-lg border border-[#D97757] bg-[#D97757] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#C6613F]">
              {t("Yeni talep", "New request")}
            </Link>
          )}
        </div>
        {bootError && <p className="text-sm text-red-600 dark:text-red-400">{bootError}</p>}
        {!user ? <PageSpinner /> : creating ? <NewTicket shopName={activeShop?.shop_name ?? null} prefill={params.get("error") ?? ""} /> : id ? <TicketView key={id} id={id} /> : <TicketList />}
      </div>
    </AppShell>
  );
}

function TicketList() {
  const { t } = useT();
  const f = useFormat();
  const { data, error } = useApiData("support:list", () => supportApi.list());
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;
  if (data.length === 0) return <EmptyState>{t("Henüz talebin yok.", "You have no requests yet.")}</EmptyState>;
  return (
    <ul className="space-y-2">
      {data.map((r) => (
        <li key={r.id}>
          <Link
            href={`/support?id=${r.id}`}
            className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 transition hover:border-[#D97757] dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {r.user_unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#D97757]" aria-label={t("Yeni", "New")} />}#{r.id} · {r.subject}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {categoryLabel(t, r.category)} · {f.dateTime(r.updated_at)}
              </p>
            </div>
            <StatusBadge status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NewTicket({ shopName, prefill }: { shopName: string | null; prefill: string }) {
  const { t } = useT();
  const router = useRouter();
  const [subject, setSubject] = useState(prefill ? t("Sayfa hata verdi", "A page showed an error") : "");
  const [category, setCategory] = useState<TicketCategory>(prefill ? "bug" : "question");
  const [busy, setBusy] = useState(false);

  async function submit(body: string, files: File[]) {
    if (subject.trim().length < 3) {
      toast.error(t("Kısa bir konu başlığı yaz.", "Write a short subject."));
      return false;
    }
    setBusy(true);
    try {
      const { id } = await supportApi.create({ subject, category, body, context: buildSupportContext(shopName) }, files);
      toast.success(t("Talebin alındı.", "Your request was received."));
      router.replace(`/support?id=${id}`);
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field label={t("Konu", "Subject")}>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} className={inputClass} />
        </Field>
        <Field label={t("Tür", "Type")}>
          <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className={inputClass}>
            {(Object.keys(CATEGORIES) as TicketCategory[]).map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Composer
        rows={7}
        minLength={5}
        busy={busy}
        initialBody={prefill ? t(`Şu hatayı gördüm:\n${prefill}\n\nŞunu yapmaya çalışıyordum: `, `I saw this error:\n${prefill}\n\nI was trying to: `) : ""}
        placeholder={t("Ne oldu? Ne yapmaya çalışıyordun? Ekran görüntüsünü buraya yapıştırabilirsin (Ctrl+V).", "What happened? What were you trying to do? You can paste a screenshot here (Ctrl+V).")}
        submitLabel={t("Talebi gönder", "Send request")}
        onSubmit={submit}
        extra={
          <Link href="/support" className="text-sm text-neutral-500 hover:underline dark:text-neutral-400">
            {t("Vazgeç", "Cancel")}
          </Link>
        }
      />
    </section>
  );
}

function TicketView({ id }: { id: number }) {
  const { t } = useT();
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
        notifySupportUnreadChanged(); // açmak okundu yapar
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [id]);

  async function reply(body: string, files: File[]) {
    setBusy(true);
    try {
      setTicket(await supportApi.reply(id, body, files));
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    setBusy(true);
    try {
      setTicket(await supportApi.resolve(id));
      notifySupportUnreadChanged();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function rate(rating: 1 | -1) {
    setBusy(true);
    try {
      setTicket(await supportApi.rate(id, rating));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!ticket) return <BlockSpinner />;
  const resolved = ticket.status === "resolved";
  return (
    <div className="space-y-4">
      <Link href="/support" className="text-sm text-neutral-500 hover:underline dark:text-neutral-400">
        ← {t("Taleplerim", "My requests")}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 break-words text-base font-semibold text-neutral-900 dark:text-neutral-100">
          #{ticket.id} · {ticket.subject}
        </h2>
        <Badge tone="muted">{categoryLabel(t, ticket.category)}</Badge>
        <StatusBadge status={ticket.status} />
      </div>
      {resolved && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          {t("Bu talep tamamlandı. Hâlâ sorun varsa aşağıdan yanıtla; talep yeniden açılır.", "This request is done. If the problem remains, reply below and it will reopen.")}
        </p>
      )}
      {resolved && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          {ticket.rating ? (
            <span>{t("Geri bildirimin için teşekkürler.", "Thanks for your feedback.")}</span>
          ) : (
            <>
              <span>{t("Bu yardım işe yaradı mı?", "Did this help?")}</span>
              <Button onClick={() => void rate(1)} disabled={busy}>
                👍 {t("Evet", "Yes")}
              </Button>
              <Button onClick={() => void rate(-1)} disabled={busy}>
                👎 {t("Hayır", "No")}
              </Button>
            </>
          )}
        </div>
      )}
      <Thread messages={ticket.messages} viewer="user" openAttachment={supportApi.attachmentUrl} />
      <Composer
        busy={busy}
        placeholder={t("Yanıtını yaz… (ekran görüntüsünü yapıştırabilirsin)", "Write your reply… (you can paste a screenshot)")}
        submitLabel={resolved ? t("Yeniden aç ve gönder", "Reopen and send") : t("Gönder", "Send")}
        onSubmit={reply}
        extra={
          !resolved && (
            <Button onClick={() => void resolve()} disabled={busy}>
              {t("Çözüldü, gerek kalmadı", "Solved, no longer needed")}
            </Button>
          )
        }
      />
    </div>
  );
}

// useSearchParams() üretim derlemesinde Suspense sınırı ister; yoksa sayfa önceden render edilemez ve build düşer.
export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportPageInner />
    </Suspense>
  );
}

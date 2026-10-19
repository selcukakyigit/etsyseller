"use client";

import { useState } from "react";
import { useFormat } from "@/components/admin/ui";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import type { TicketMessage } from "@/lib/supportApi";

/** Talep yazışması. `viewer`: kimin gözüyle bakıldığı; kendi mesajı sağa yaslı, karşı tarafınki solda durur.
 * `openAttachment`: imzalı adresi alır; dosya yeni sekmede açılır (kullanıcı ve yönetici uçları farklıdır). */
export default function Thread({
  messages,
  viewer,
  openAttachment,
}: {
  messages: TicketMessage[];
  viewer: "user" | "admin";
  openAttachment: (id: number) => Promise<{ url: string }>;
}) {
  const { t } = useT();
  const f = useFormat();
  const [opening, setOpening] = useState<number | null>(null);

  async function open(id: number) {
    // Açılır pencere engellenmesin diye sekme tıklama anında açılır, adres gelince yönlendirilir.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setOpening(id);
    try {
      const { url } = await openAttachment(id);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      if (e instanceof Error && e.message) toast.error(e.message);
    } finally {
      setOpening(null);
    }
  }

  return (
    <ul className="space-y-3">
      {messages.map((m) => {
        const mine = m.author === viewer;
        const tone = m.internal
          ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
          : mine
            ? "border-[#D97757]/30 bg-[#D97757]/10"
            : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900";
        const who = m.internal
          ? t("İç not (kullanıcı görmez)", "Internal note (hidden from user)")
          : m.author === "admin"
            ? t("Ulagg destek", "Ulagg support")
            : viewer === "user"
              ? t("Sen", "You")
              : t("Kullanıcı", "User");
        return (
          <li key={m.id} className={`rounded-lg border p-3 ${tone} ${mine && !m.internal ? "sm:ml-10" : "sm:mr-10"}`}>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              <span className="font-medium text-neutral-700 dark:text-neutral-200">{who}</span> · {f.dateTime(m.created_at)}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">{m.body}</p>
            {m.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.attachments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => void open(a.id)}
                    disabled={opening === a.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {opening === a.id && <Spinner size={12} />}
                    <span className="truncate">{a.filename}</span>
                    <span className="text-neutral-400 dark:text-neutral-500">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

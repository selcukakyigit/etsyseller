"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api";
import { Lang } from "@/lib/i18n";

const T = {
  en: {
    name: "Your name",
    email: "Email",
    topic: "Topic",
    topics: { support: "Using Ulagg", etsy: "Etsy connection", billing: "Billing", privacy: "Privacy or data request", other: "Something else" },
    message: "Message",
    messageHint: "Tell us what you are trying to do and what happened.",
    send: "Send message",
    sending: "Sending…",
    done: "Thanks, your message is on its way. We will reply to your email.",
    fail: "We could not send your message. Please try again, or write to us on WhatsApp.",
    limit: "You have sent several messages already. Please try again a bit later.",
    notice: "We use your details only to answer you. See the privacy policy.",
  },
  tr: {
    name: "Adın",
    email: "E-posta",
    topic: "Konu",
    topics: { support: "Ulagg kullanımı", etsy: "Etsy bağlantısı", billing: "Faturalama", privacy: "Gizlilik veya veri talebi", other: "Başka bir konu" },
    message: "Mesaj",
    messageHint: "Ne yapmaya çalıştığını ve ne olduğunu yaz.",
    send: "Mesajı gönder",
    sending: "Gönderiliyor…",
    done: "Teşekkürler, mesajın bize ulaştı. E-posta adresine döneceğiz.",
    fail: "Mesajın gönderilemedi. Tekrar dene ya da bize WhatsApp'tan yaz.",
    limit: "Kısa sürede birkaç mesaj gönderdin. Biraz sonra tekrar dene.",
    notice: "Bilgilerini yalnızca sana cevap vermek için kullanırız. Gizlilik politikasına bak.",
  },
};

const field =
  "w-full rounded-lg border border-black/15 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-[#F1641E] dark:border-white/15 dark:bg-[#171513] dark:text-neutral-100";
const label = "mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400";

export default function ContactForm({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [state, setState] = useState<"idle" | "sending" | "done" | "error" | "limit">("idle");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setState("sending");
    try {
      const res = await fetch(`${API_URL}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          topic: data.get("topic"),
          message: data.get("message"),
          website: data.get("website"),
          lang,
        }),
      });
      if (res.status === 429) return setState("limit");
      if (!res.ok) return setState("error");
      form.reset();
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-xl border border-emerald-600/20 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-950/30 dark:text-emerald-200">
        {t.done}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="c-name">{t.name}</label>
          <input id="c-name" name="name" required maxLength={120} autoComplete="name" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="c-email">{t.email}</label>
          <input id="c-email" name="email" type="email" required autoComplete="email" className={field} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="c-topic">{t.topic}</label>
        <select id="c-topic" name="topic" defaultValue="support" className={field}>
          {Object.entries(t.topics).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="c-message">{t.message}</label>
        <textarea id="c-message" name="message" required minLength={10} maxLength={5000} rows={6} placeholder={t.messageHint} className={`${field} resize-y`} />
      </div>
      {/* Bal küpü: insanlar görmez, botlar doldurur. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />

      {state === "error" && <p className="text-sm text-red-600">{t.fail}</p>}
      {state === "limit" && <p className="text-sm text-amber-700 dark:text-amber-400">{t.limit}</p>}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-full bg-[#1F1B16] px-6 py-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60 dark:bg-[#F3EFE9] dark:text-[#1F1B16] dark:hover:bg-white"
        >
          {state === "sending" ? t.sending : t.send}
        </button>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t.notice}</p>
      </div>
    </form>
  );
}

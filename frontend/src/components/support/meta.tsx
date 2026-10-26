"use client";

import { useState } from "react";
import { Badge } from "@/components/admin/ui";
import { useT } from "@/lib/i18n-client";
import type { TicketCategory, TicketEvent, TicketLabelOption, TicketPriority, TicketSource, TicketStatus } from "@/lib/supportApi";

export const CATEGORIES: Record<TicketCategory, [string, string]> = {
  bug: ["Hata / sorun", "Bug / problem"],
  question: ["Soru", "Question"],
  feature: ["Özellik isteği", "Feature request"],
  billing: ["Fatura / ödeme", "Billing / payment"],
  other: ["Diğer", "Other"],
};

const STATUS: Record<TicketStatus, { label: [string, string]; adminLabel: [string, string]; tone: "warn" | "muted" | "good" }> = {
  open: { label: ["İnceleniyor", "Under review"], adminLabel: ["Açık", "Open"], tone: "warn" },
  waiting_user: { label: ["Yanıtını bekliyoruz", "Waiting for you"], adminLabel: ["Kullanıcı bekleniyor", "Waiting for user"], tone: "muted" },
  resolved: { label: ["Tamamlandı", "Done"], adminLabel: ["Çözüldü", "Resolved"], tone: "good" },
};

/** `admin`: yönetici dilinde ("Açık" / "Kullanıcı bekleniyor"); kullanıcıya "İnceleniyor" / "Yanıtını bekliyoruz" gösterilir. */
export function StatusBadge({ status, admin = false }: { status: TicketStatus; admin?: boolean }) {
  const { t } = useT();
  const s = STATUS[status];
  const [tr, en] = admin ? s.adminLabel : s.label;
  return <Badge tone={s.tone}>{t(tr, en)}</Badge>;
}

export function categoryLabel(t: (tr: string, en: string) => string, c: TicketCategory) {
  const [tr, en] = CATEGORIES[c] ?? CATEGORIES.other;
  return t(tr, en);
}

const HOUR = 3_600_000;

/** Yanıt bekleme süresi (yönetici listesi): 8 saati geçince sarı, 24 saati geçince kırmızı. Yalnızca yönetici sırasındaki (open) talepte gösterilir. */
export function WaitBadge({ since, status }: { since: string; status: TicketStatus }) {
  const { t } = useT();
  const [now] = useState(() => Date.now());
  if (status !== "open") return null;
  const hours = Math.max(0, Math.floor((now - new Date(since).getTime()) / HOUR));
  const label = hours < 1 ? t("<1 sa", "<1h") : hours < 48 ? t(`${hours} sa`, `${hours}h`) : t(`${Math.floor(hours / 24)} gün`, `${Math.floor(hours / 24)}d`);
  return <Badge tone={hours >= 24 ? "bad" : hours >= 8 ? "warn" : "muted"}>{label}</Badge>;
}

/** Kullanıcının puanı: 👍 işe yaradı / 👎 yaramadı. */
export function RatingBadge({ rating }: { rating: 1 | -1 | null }) {
  const { t } = useT();
  if (!rating) return null;
  return <span title={rating === 1 ? t("İşe yaradı", "Helped") : t("İşe yaramadı", "Did not help")}>{rating === 1 ? "👍" : "👎"}</span>;
}

const PRIORITY: Record<TicketPriority, { label: [string, string]; tone: "bad" | "muted" }> = {
  urgent: { label: ["Acil", "Urgent"], tone: "bad" },
  normal: { label: ["Normal", "Normal"], tone: "muted" },
  low: { label: ["Düşük", "Low"], tone: "muted" },
};

export function priorityLabel(t: (tr: string, en: string) => string, p: TicketPriority) {
  const [tr, en] = PRIORITY[p].label;
  return t(tr, en);
}

/** Normal öncelik listeyi kalabalıklaştırmasın diye yalnızca acil ve düşük gösterilir. */
export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { t } = useT();
  if (priority === "normal") return null;
  return <Badge tone={PRIORITY[priority].tone}>{priorityLabel(t, priority)}</Badge>;
}

const SOURCE: Record<TicketSource, [string, string]> = {
  web: ["Destek ekranı", "Support page"],
  assistant: ["Asistan", "Assistant"],
  error: ["Otomatik hata", "Automatic error"],
};

export function sourceLabel(t: (tr: string, en: string) => string, s: TicketSource) {
  const [tr, en] = SOURCE[s] ?? SOURCE.web;
  return t(tr, en);
}

/** Varsayılan kaynak (destek ekranı) listeyi kalabalıklaştırmasın diye gösterilmez. */
export function SourceBadge({ source }: { source: TicketSource }) {
  const { t } = useT();
  if (source === "web") return null;
  return <Badge tone="muted">{sourceLabel(t, source)}</Badge>;
}

export function labelName(t: (tr: string, en: string) => string, options: TicketLabelOption[], key: string) {
  const o = options.find((x) => x.key === key);
  return o ? t(o.tr, o.en) : key;
}

/** İş kaydı satırının okunur metni ("Ayşe önceliği Acil yaptı"). */
export function eventText(t: (tr: string, en: string) => string, e: TicketEvent, labels: TicketLabelOption[]): string {
  const who = e.actor ?? t("Sistem", "System");
  switch (e.kind) {
    case "created":
      return t(`Talep açıldı (${sourceLabel(t, e.detail as TicketSource)})`, `Request opened (${sourceLabel(t, e.detail as TicketSource)})`);
    case "status": {
      const [tr, en] = STATUS[e.detail as TicketStatus]?.adminLabel ?? [e.detail, e.detail];
      return t(`${who} durumu "${tr}" yaptı`, `${who} set the status to "${en}"`);
    }
    case "assignee":
      return e.detail ? t(`${who} talebi ${e.detail} kişisine atadı`, `${who} assigned the request to ${e.detail}`) : t(`${who} atamayı kaldırdı`, `${who} removed the assignee`);
    case "priority":
      return t(`${who} önceliği "${priorityLabel(t, e.detail as TicketPriority)}" yaptı`, `${who} set the priority to "${priorityLabel(t, e.detail as TicketPriority)}"`);
    case "labels": {
      const names = e.detail ? e.detail.split(",").map((k) => labelName(t, labels, k)).join(", ") : t("etiket yok", "no labels");
      return t(`${who} etiketleri değiştirdi: ${names}`, `${who} changed the labels: ${names}`);
    }
    case "rating":
      return e.detail === "1" ? t("Kullanıcı işe yaradı dedi 👍", "The user said it helped 👍") : t("Kullanıcı işe yaramadı dedi 👎", "The user said it did not help 👎");
  }
}

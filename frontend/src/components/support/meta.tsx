"use client";

import { useState } from "react";
import { Badge } from "@/components/admin/ui";
import { useT } from "@/lib/i18n-client";
import type { TicketCategory, TicketStatus } from "@/lib/supportApi";

export const CATEGORIES: Record<TicketCategory, [string, string]> = {
  bug: ["Hata / sorun", "Bug / problem"],
  question: ["Soru", "Question"],
  feature: ["Özellik isteği", "Feature request"],
  billing: ["Ödeme / kredi", "Billing / credits"],
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

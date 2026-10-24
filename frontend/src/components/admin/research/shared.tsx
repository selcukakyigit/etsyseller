"use client";

import { Badge } from "@/components/admin/ui";
import type { KeywordState, ResearchJob, ResearchKeyword } from "@/lib/researchApi";
import { useT } from "@/lib/i18n-client";

/** Yönetim > Araştırma sayfalarının ortak küçük parçaları. */

export function StateBadge({ state, reason = "", detail = "" }: { state: KeywordState; reason?: ResearchKeyword["reason"]; detail?: string }) {
  const { t } = useT();
  if (state === "fresh") return <Badge tone="good">{t("Güncel", "Fresh")}</Badge>;
  if (state === "stale") return <Badge tone="warn">{t("Yenilenmeli", "Stale")}</Badge>;
  // Ölçüm yok: nedeni ayrı ayrı gösterilir (sırada, başarısız, başka pazarda ölçülmüş, hiç istenmemiş).
  const why = {
    queued: ["muted", t("Sırada", "Queued"), ""],
    failed: ["bad", t("Ölçülemedi", "Failed"), detail],
    other_market: ["warn", t("Başka pazarda", "Other market"), t(`Ölçüm şu pazarlarda var: ${detail}`, `Measured in: ${detail}`)],
    none: ["muted", t("Henüz istenmedi", "Not requested"), ""],
  } as const;
  const [tone, label, title] = reason ? why[reason] : (["muted", t("Metrik yok", "No metrics"), ""] as const);
  return (
    <span title={title || undefined}>
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}

export function JobStatusBadge({ status }: { status: ResearchJob["status"] }) {
  const { t } = useT();
  const map: Record<ResearchJob["status"], [Parameters<typeof Badge>[0]["tone"], string, string]> = {
    queued: ["muted", "Sırada", "Queued"],
    running: ["warn", "Çalışıyor", "Running"],
    done: ["good", "Bitti", "Done"],
    failed: ["bad", "Başarısız", "Failed"],
    dead: ["bad", "Vazgeçildi", "Dead"],
    cancelled: ["muted", "İptal", "Cancelled"],
  };
  const [tone, tr, en] = map[status];
  return <Badge tone={tone}>{t(tr, en)}</Badge>;
}

/** Kuyruğa alınamayan isteğin nedeni (backend `QueueRefused.reason`). */
export function useRefusedText() {
  const { t } = useT();
  return (reason: string | null): string | null => {
    switch (reason) {
      case null:
        return null;
      case "budget":
        return t("Aylık bütçe doldu; eski veriyle devam ediliyor.", "Monthly budget reached; continuing with old data.");
      case "disabled":
        return t("Araştırma kapalı.", "Research is turned off.");
      case "not_configured":
        return t("Sağlayıcı kimlik bilgisi girilmemiş.", "Provider credentials are not set.");
      case "market":
        return t("Bu pazar sağlayıcıda desteklenmiyor.", "This market is not supported by the provider.");
      default:
        return t("İstek kuyruğa alınamadı.", "The request could not be queued.");
    }
  };
}

export const fmtMoney = (n: number, locale: string) => n.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

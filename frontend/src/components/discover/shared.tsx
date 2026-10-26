"use client";

import type { Intent } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";

/** Keşfet'in ortak çeviri yardımcıları. */

export function useIntentLabel() {
  const { t } = useT();
  return (intent: Intent | null): string | null => {
    switch (intent) {
      case "informational":
        return t("Bilgi arıyor", "Researching");
      case "commercial":
        return t("Karşılaştırıyor", "Comparing");
      case "transactional":
        return t("Almaya yakın", "Ready to buy");
      case "navigational":
        return t("Belirli yer", "Specific site");
      default:
        return null;
    }
  };
}

/** Kuyruğa alınamayan aramanın nedeni (backend `QueueRefused.reason`). */
export function useRefusedText() {
  const { t } = useT();
  return (reason: string | null): string => {
    switch (reason) {
      case "shop_month":
        return t("Bu ayki yeni kelime araştırma hakkın doldu. Daha önce araştırılmış kelimeler sınırsız; hakkın gelecek ay yenilenir.", "You have used this month's new keyword searches. Keywords already researched are unlimited; your allowance renews next month.");
      case "shop_searches":
        return t("Bugünlük yeni kelime araştırma sınırına ulaştın. Daha önce araştırılmış kelimeler sınırsız; yarın devam edebilirsin.", "You have reached today's limit of new keyword searches. Keywords already researched are unlimited; you can continue tomorrow.");
      case "shop_daily":
        return t("Bugünkü araştırma hakkın doldu; yarın yeniden dene.", "You have used today's research allowance; try again tomorrow.");
      case "budget":
        return t("Araştırma şu an yoğun; birazdan yeniden dene.", "Research is busy right now; try again shortly.");
      case "not_configured":
      case "disabled":
        return t("Kelime araştırması şu an kullanılamıyor.", "Keyword research is not available right now.");
      case "market":
        return t("Bu pazar desteklenmiyor.", "This market is not supported.");
      default:
        return t("Araştırma şu an yapılamıyor.", "Research is not available right now.");
    }
  };
}

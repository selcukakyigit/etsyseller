"use client";

import { Badge, Button, Section } from "@/components/admin/ui";
import { API_URL, AdminBilling } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

/** Lemon Squeezy anahtarlarının durumu ve webhook kurulumu. */
export default function LemonSection({ data }: { data: AdminBilling; onChanged: () => void }) {
  const { t } = useT();
  const webhookUrl = `${API_URL}/webhooks/lemonsqueezy`;
  const row = (ok: boolean, label: string, fix: string) => (
    <li className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-neutral-800 dark:text-neutral-200">{label}</span>
      {ok ? <Badge tone="good">{t("Hazır", "Ready")}</Badge> : <span className="text-xs text-amber-700 dark:text-amber-300">{fix}</span>}
    </li>
  );
  return (
    <Section title={t("Lemon Squeezy bağlantısı", "Lemon Squeezy connection")}>
      <ul className="space-y-2">
        {row(data.lemon_configured, t("API anahtarı ve mağaza no.", "API key and store ID"), t("Sunucuya LEMONSQUEEZY_API_KEY ve LEMONSQUEEZY_STORE_ID ekleyin", "Add LEMONSQUEEZY_API_KEY and LEMONSQUEEZY_STORE_ID on the server"))}
        {row(data.webhook_configured, t("Webhook sırrı", "Webhook secret"), t("Sunucuya LEMONSQUEEZY_WEBHOOK_SECRET ekleyin", "Add LEMONSQUEEZY_WEBHOOK_SECRET on the server"))}
      </ul>
      <div className="mt-3 space-y-1">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t(
            "Lemon'da Settings > Webhooks: aşağıdaki adres, aynı sır ve şu olaylar: order_created, order_refunded, subscription_created, subscription_updated, subscription_cancelled, subscription_resumed, subscription_expired, subscription_paused, subscription_unpaused, subscription_payment_success.",
            "In Lemon, Settings > Webhooks: the URL below, the same secret and these events: order_created, order_refunded, subscription_created, subscription_updated, subscription_cancelled, subscription_resumed, subscription_expired, subscription_paused, subscription_unpaused, subscription_payment_success.",
          )}
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">{webhookUrl}</code>
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(webhookUrl).then(() => toast.success(t("Kopyalandı", "Copied")));
            }}
          >
            {t("Kopyala", "Copy")}
          </Button>
        </div>
      </div>
    </Section>
  );
}

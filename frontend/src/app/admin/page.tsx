"use client";

import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import { EmptyState, Section, StatCard, UsageBar, useFormat } from "@/components/admin/ui";
import { useApiData } from "@/lib/useApiData";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

export default function AdminOverviewPage() {
  return (
    <AdminShell current="/admin">
      <Overview />
    </AdminShell>
  );
}

function Overview() {
  const { t } = useT();
  const f = useFormat();
  const { data, error } = useApiData("admin:overview", api.admin.overview);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("Kullanıcılar", "Users")}
          value={f.num(data.users_total)}
          hint={t(`Son 7 gün +${f.num(data.users_7d)} · 30 gün +${f.num(data.users_30d)}`, `+${f.num(data.users_7d)} in 7 days · +${f.num(data.users_30d)} in 30 days`)}
        />
        <StatCard
          label={t("Bağlı mağazalar", "Connected shops")}
          value={f.num(data.shops_connected)}
          hint={t(`${f.num(data.shops_revoked)} erişimi kaldırılmış · ${f.num(data.shops_demo)} demo`, `${f.num(data.shops_revoked)} revoked · ${f.num(data.shops_demo)} demo`)}
        />
        <StatCard
          label={t("AI istekleri (30 gün)", "AI requests (30 days)")}
          value={f.num(data.ai_requests_30d)}
          hint={t(
            `${f.num(data.ai_input_tokens_30d)} girdi · ${f.num(data.ai_output_tokens_30d)} çıktı token`,
            `${f.num(data.ai_input_tokens_30d)} input · ${f.num(data.ai_output_tokens_30d)} output tokens`,
          )}
        />
        <Link href="/admin/messages" className="block rounded-xl transition hover:opacity-90">
          <StatCard label={t("Açık mesajlar", "Open messages")} value={f.num(data.open_messages)} hint={t("İletişim formu", "Contact form")} />
        </Link>
      </div>

      <Section title={t("Etsy günlük kota", "Etsy daily quota")}>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="tabular-nums text-neutral-900 dark:text-neutral-100">
              {f.num(data.etsy_calls_today)} / {f.num(data.etsy_daily_limit)}
            </span>
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{t("UTC gün başından beri", "Since UTC midnight")}</span>
          </div>
          <UsageBar used={data.etsy_calls_today} limit={data.etsy_daily_limit} />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            {t(
              "Sayaç sunucu belleğindedir; sunucu yeniden başlarsa sıfırdan sayar, gerçek kullanım biraz daha yüksek olabilir.",
              "The counter lives in server memory; it restarts from zero when the server restarts, so real usage may be a little higher.",
            )}
          </p>
        </div>
      </Section>

      <Section title={t("Modele göre AI kullanımı (30 gün)", "AI usage by model (30 days)")}>
        {data.ai_by_model.length === 0 ? (
          <EmptyState>{t("Son 30 günde AI isteği yok.", "No AI requests in the last 30 days.")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                  <th className="pb-2 font-medium">{t("Model", "Model")}</th>
                  <th className="pb-2 text-right font-medium">{t("İstek", "Requests")}</th>
                  <th className="pb-2 text-right font-medium">{t("Girdi token", "Input tokens")}</th>
                  <th className="pb-2 text-right font-medium">{t("Çıktı token", "Output tokens")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {data.ai_by_model.map((m) => (
                  <tr key={`${m.provider}/${m.model}`} className="text-neutral-800 dark:text-neutral-200">
                    <td className="py-2">
                      <span className="font-mono text-xs">{m.model}</span>
                      <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">{m.provider}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{f.num(m.requests)}</td>
                    <td className="py-2 text-right tabular-nums">{f.num(m.input_tokens)}</td>
                    <td className="py-2 text-right tabular-nums">{f.num(m.output_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
          {t(
            "Tüm AI görevleri (asistan, SEO, alt metin, belge okuma, görsel) sayılır. Maliyet ve kredi dökümü Krediler sayfasında.",
            "All AI tasks (assistant, SEO, alt text, document reading, images) are counted. The cost and credit breakdown is on the Credits page.",
          )}
        </p>
      </Section>
    </div>
  );
}

"use client";

import AdminShell from "@/components/admin/AdminShell";
import { useState } from "react";
import { Badge, Button, EmptyState, Section, UsageBar, errorText, useFormat } from "@/components/admin/ui";
import { useApiData } from "@/lib/useApiData";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { AdminJob, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";

// Zamanlanmış işlerin okunur adları (kimlikler backend/app/jobs/scheduler.py'deki `id`'lerdir).
const JOB_NAMES: Record<string, [string, string]> = {
  order_sync: ["Sipariş senkronu", "Order sync"],
  listing_refresh: ["Listing yenileme", "Listing refresh"],
  finance_sync: ["Finans senkronu", "Finance sync"],
  shop_profile: ["Mağaza profili", "Shop profile"],
  reviews: ["Yorumlar", "Reviews"],
  daily_stats: ["Günlük istatistik", "Daily stats"],
  listing_health: ["Listing sağlığı", "Listing health"],
  rank_tracking: ["Sıra takibi", "Rank tracking"],
  demand_trends: ["Talep trendleri", "Demand trends"],
  retention_purge: ["Saklama süresi temizliği", "Retention cleanup"],
};

export default function AdminSystemPage() {
  return (
    <AdminShell current="/admin/system">
      <div className="space-y-6">
        <System />
        <AuditLog />
      </div>
    </AdminShell>
  );
}

function System() {
  const { t } = useT();
  const f = useFormat();
  const { data, error, loading, reload } = useApiData("admin:system", api.admin.system);

  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <BlockSpinner />;

  const staleCount = data.shops.filter((s) => s.stale).length;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {loading && <Spinner size={14} />}
          {t("Yenile", "Refresh")}
        </button>
      </div>

      <Section title={t("Etsy günlük kota", "Etsy daily quota")}>
        <div className="space-y-2">
          <p className="text-sm tabular-nums text-neutral-900 dark:text-neutral-100">
            {f.num(data.etsy_calls_today)} / {f.num(data.etsy_daily_limit)}
          </p>
          <UsageBar used={data.etsy_calls_today} limit={data.etsy_daily_limit} />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            {t(
              `Arka plan işleri ${f.num(data.etsy_background_budget)} çağrıya ulaşınca durur; kalan pay kullanıcıların sayfa açmasına ayrılır.`,
              `Background jobs pause at ${f.num(data.etsy_background_budget)} calls; the rest is kept for users opening pages.`,
            )}
          </p>
        </div>
      </Section>

      <Section
        title={t("Zamanlanmış işler", "Scheduled jobs")}
        action={data.scheduler_running ? <Badge tone="good">{t("Çalışıyor", "Running")}</Badge> : <Badge tone="bad">{t("Durmuş", "Stopped")}</Badge>}
      >
        {data.jobs.length === 0 ? (
          <EmptyState>{t("Bu süreçte zamanlanmış iş yok.", "No scheduled jobs in this process.")}</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.jobs.map((job) => (
              <JobRow key={job.id} job={job} canRun={data.scheduler_running} onStarted={reload} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
          {t(
            "Son çalışma bilgisi sunucu yeniden başlayınca sıfırlanır. Mağaza bazındaki hatalar işlerin kendi kayıtlarındadır; burada yalnızca işin tamamen çöktüğü durumlar görünür.",
            "Last-run info resets when the server restarts. Per-shop errors are in each job's own logs; only jobs that crashed outright show up here.",
          )}
        </p>
      </Section>

      <Section
        title={t("Listing senkronu", "Listing sync")}
        action={staleCount > 0 ? <Badge tone="warn">{t(`${staleCount} gecikmiş`, `${staleCount} behind`)}</Badge> : null}
      >
        {data.shops.length === 0 ? (
          <EmptyState>{t("Bağlı mağaza yok.", "No connected shops.")}</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.shops.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{s.shop_name}</p>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{s.owner_email}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>{f.dateTime(s.listings_synced_at)}</span>
                  {s.revoked ? (
                    <Badge tone="bad">{t("Erişim kaldırıldı", "Access revoked")}</Badge>
                  ) : s.stale ? (
                    <Badge tone="warn">{t("6 saatten eski", "Older than 6 h")}</Badge>
                  ) : (
                    <Badge tone="good">{t("Güncel", "Fresh")}</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function JobRow({ job, canRun, onStarted }: { job: AdminJob; canRun: boolean; onStarted: () => void }) {
  const { t } = useT();
  const f = useFormat();
  const [starting, setStarting] = useState(false);
  const name = JOB_NAMES[job.id];

  async function run() {
    if (!window.confirm(t("Bu iş şimdi bir kez çalıştırılsın mı? Etsy kotasından harcar.", "Run this job once now? It uses Etsy quota."))) return;
    setStarting(true);
    try {
      await api.admin.runJob(job.id);
      toast.success(t("İş sıraya alındı", "Job queued"));
      onStarted();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <li className="py-2.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {name ? t(name[0], name[1]) : job.id}
          <span className="ml-2 font-mono text-xs font-normal text-neutral-400 dark:text-neutral-500">{job.id}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span>
            {t("Son", "Last")}: {f.dateTime(job.last_run)}
          </span>
          <span>
            {t("Sonraki", "Next")}: {f.dateTime(job.next_run)}
          </span>
          {job.last_ok === true && <Badge tone="good">{t("Başarılı", "OK")}</Badge>}
          {job.last_ok === false && <Badge tone="bad">{t("Hata", "Failed")}</Badge>}
          {canRun && (
            <Button busy={starting} onClick={() => void run()} className="px-2 py-0.5 text-xs">
              {t("Şimdi çalıştır", "Run now")}
            </Button>
          )}
        </div>
      </div>
      {job.last_error && <p className="mt-1 break-words font-mono text-xs text-red-600 dark:text-red-400">{job.last_error}</p>}
    </li>
  );
}

// Yönetici işlemlerinin okunur adları (backend/app/admin/router.py'deki audit.record eylemleri).
const ACTIONS: Record<string, [string, string]> = {
  "job.run": ["İş elle çalıştırıldı", "Job run manually"],
  "model.create": ["Model eklendi", "Model added"],
  "model.update": ["Model güncellendi", "Model updated"],
  "model.delete": ["Model silindi", "Model deleted"],
  "task.assign": ["Görev modeli değişti", "Task model changed"],
  "key.set": ["Anahtar kaydedildi", "Key saved"],
  "key.clear": ["Anahtar silindi", "Key removed"],
  "credits.settings": ["Kredi ayarları değişti", "Credit settings changed"],
  "credits.adjust": ["Bakiye düzeltildi", "Balance adjusted"],
  "product.create": ["Ürün eklendi", "Product added"],
  "product.update": ["Ürün güncellendi", "Product updated"],
  "product.delete": ["Ürün silindi", "Product deleted"],
};

function AuditLog() {
  const { t } = useT();
  const f = useFormat();
  const { data, error } = useApiData("admin:audit", api.admin.audit);
  return (
    <Section title={t("Yönetici işlem kaydı", "Admin activity log")}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <BlockSpinner />}
      {data && data.length === 0 && <EmptyState>{t("Henüz kayıt yok.", "No entries yet.")}</EmptyState>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {data.map((a) => {
            const name = ACTIONS[a.action];
            return (
              <li key={a.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 text-sm text-neutral-800 dark:text-neutral-200">
                  {name ? t(name[0], name[1]) : a.action}
                  {a.target && <span className="ml-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">{a.target}</span>}
                </p>
                <p className="flex-shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                  {a.email} · {f.dateTime(a.created_at)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

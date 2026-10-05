"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, EmptyState, Section, useFormat } from "@/components/admin/ui";
import { useApiData } from "@/lib/useApiData";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { AdminUser, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

const PAGE_SIZE = 50;

export default function AdminUsersPage() {
  return (
    <AdminShell current="/admin/users">
      <Users />
    </AdminShell>
  );
}

function Users() {
  const { t } = useT();
  const f = useFormat();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  // Her tuşta istek atmamak için yazma bitince (300 ms) aranır; yeni aramada ilk sayfaya dönülür.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(input.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [input]);

  const { data, error, loading } = useApiData(`admin:users:${query}:${offset}`, () => api.admin.users(query, offset, PAGE_SIZE));
  const total = data?.total ?? 0;

  return (
    <Section
      title={data ? t(`Kullanıcılar (${f.num(total)})`, `Users (${f.num(total)})`) : t("Kullanıcılar", "Users")}
      action={loading && data ? <Spinner size={16} /> : null}
    >
      <div className="space-y-4">
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("E-posta ya da isimle ara", "Search by email or name")}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
        />

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!data && !error && <BlockSpinner />}
        {data && data.items.length === 0 && <EmptyState>{t("Kullanıcı bulunamadı.", "No users found.")}</EmptyState>}

        {data && data.items.length > 0 && (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.items.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </ul>
        )}

        {data && total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {t("Önceki", "Previous")}
            </button>
            <span className="tabular-nums text-xs text-neutral-500 dark:text-neutral-400">
              {f.num(offset + 1)}–{f.num(Math.min(offset + PAGE_SIZE, total))} / {f.num(total)}
            </span>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {t("Sonraki", "Next")}
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const { t } = useT();
  const f = useFormat();
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar user={user} size={36} className="flex-shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{user.email}</p>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {user.name || t("İsimsiz", "No name")} · {t("Kayıt", "Joined")} {f.date(user.created_at)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:max-w-[55%] sm:justify-end">
        {user.shops.length === 0 && <Badge tone="muted">{t("Mağaza yok", "No shop")}</Badge>}
        {user.shops.map((s) => (
          <Badge key={s.id} tone={s.is_demo ? "muted" : s.revoked ? "bad" : s.connected ? "good" : "warn"}>
            {s.shop_name}
            {s.is_demo ? ` · ${t("demo", "demo")}` : s.revoked ? ` · ${t("erişim kaldırıldı", "revoked")}` : !s.connected ? ` · ${t("bağlı değil", "not connected")}` : ""}
          </Badge>
        ))}
        <Badge tone={user.ai_enabled ? "muted" : "warn"}>
          {user.ai_enabled ? t(`AI ${f.num(user.ai_requests_30d)} istek/30g`, `AI ${f.num(user.ai_requests_30d)} req/30d`) : t("AI kapalı", "AI off")}
        </Badge>
      </div>
    </li>
  );
}

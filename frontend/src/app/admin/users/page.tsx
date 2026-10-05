"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import AdminShell from "@/components/admin/AdminShell";
import { Badge, Button, EmptyState, Field, errorText, inputClass, useFormat } from "@/components/admin/ui";
import { StatusBadge, UserActionsMenu, useUserAction } from "@/components/admin/userActions";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { BlockSpinner, Spinner } from "@/components/ui/Spinner";
import { AdminBulkAction, AdminUserQuery, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";

const PAGE_SIZE = 50;
const EMPTY_QUERY: AdminUserQuery = { q: "", status: "", plan: "", joined_from: "", joined_to: "", sort: "newest", offset: 0 };

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
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<AdminUserQuery>(EMPTY_QUERY);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<AdminBulkAction | null>(null);

  // Arama yazma bitince (300 ms) uygulanır; filtre değişince ilk sayfaya dönülür ve seçim temizlenir.
  useEffect(() => {
    const id = setTimeout(() => setQuery((q) => (q.q === search.trim() ? q : { ...q, q: search.trim(), offset: 0 })), 300);
    return () => clearTimeout(id);
  }, [search]);
  const key = `admin:users:${JSON.stringify(query)}`;
  const { data, error, loading, reload } = useApiData(key, () => api.admin.users({ ...query, limit: PAGE_SIZE }));
  const products = useApiData("admin:billing", api.admin.billing).data?.products.filter((p) => p.kind === "plan") ?? [];
  const action = useUserAction(reload);

  function update(patch: Partial<AdminUserQuery>) {
    setQuery((q) => ({ ...q, ...patch, offset: "offset" in patch ? patch.offset ?? 0 : 0 }));
    setSelected(new Set());
  }

  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const allSelected = items.length > 0 && items.every((u) => selected.has(u.id));
  const filtered = query.q || query.status || query.plan || query.joined_from || query.joined_to;

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900 lg:flex-row lg:items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("E-posta ya da isimle ara", "Search by email or name")}
          className={`${inputClass} lg:max-w-xs`}
        />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select value={query.status} onChange={(e) => update({ status: e.target.value as AdminUserQuery["status"] })} className={`${inputClass} sm:w-auto`} aria-label={t("Durum", "Status")}>
            <option value="">{t("Tüm durumlar", "All statuses")}</option>
            <option value="active">{t("Aktif", "Active")}</option>
            <option value="suspended">{t("Askıda", "Suspended")}</option>
            <option value="blocked">{t("Engelli", "Blocked")}</option>
          </select>
          <select value={query.plan} onChange={(e) => update({ plan: e.target.value })} className={`${inputClass} sm:w-auto`} aria-label={t("Plan", "Plan")}>
            <option value="">{t("Tüm planlar", "All plans")}</option>
            <option value="free">{t("Ücretsiz", "Free")}</option>
            <option value="paid">{t("Planı olan", "On a plan")}</option>
            {products.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {t(p.name_tr, p.name_en)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            {t("Kayıt", "Joined")}
            <input type="date" value={query.joined_from} max={query.joined_to || undefined} onChange={(e) => update({ joined_from: e.target.value })} className={`${inputClass} py-1.5`} aria-label={t("Başlangıç", "From")} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            –
            <input type="date" value={query.joined_to} min={query.joined_from || undefined} onChange={(e) => update({ joined_to: e.target.value })} className={`${inputClass} py-1.5`} aria-label={t("Bitiş", "To")} />
          </label>
          <select value={query.sort} onChange={(e) => update({ sort: e.target.value as AdminUserQuery["sort"] })} className={`${inputClass} sm:w-auto`} aria-label={t("Sıralama", "Sort")}>
            <option value="newest">{t("En yeni kayıt", "Newest")}</option>
            <option value="oldest">{t("En eski kayıt", "Oldest")}</option>
            <option value="last_seen">{t("Son aktif", "Last active")}</option>
          </select>
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          {filtered && (
            <Button
              onClick={() => {
                setSearch("");
                update(EMPTY_QUERY);
              }}
            >
              {t("Filtreleri temizle", "Clear filters")}
            </Button>
          )}
          <Button busy={loading && !!data} onClick={reload} aria-label={t("Yenile", "Refresh")}>
            {!(loading && data) && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-4 w-4" aria-hidden>
                <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
              </svg>
            )}
            {t("Yenile", "Refresh")}
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#D97757]/40 bg-[#D97757]/5 px-3 py-2 dark:bg-[#D97757]/10">
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(`${selected.size} kullanıcı seçildi`, `${selected.size} users selected`)}</span>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button onClick={() => setBulk("credits")}>{t("Kredi ekle", "Add credits")}</Button>
            <Button onClick={() => setBulk("activate")}>{t("Etkinleştir", "Activate")}</Button>
            <Button onClick={() => setBulk("suspend")}>{t("Askıya al", "Suspend")}</Button>
            <Button tone="danger" onClick={() => setBulk("block")}>
              {t("Engelle", "Block")}
            </Button>
            <Button onClick={() => setSelected(new Set())}>{t("Seçimi kaldır", "Clear selection")}</Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {error && <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!data && !error && <BlockSpinner />}
        {data && items.length === 0 && <EmptyState>{t("Kullanıcı bulunamadı.", "No users found.")}</EmptyState>}
        {data && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((u) => u.id)))}
                      aria-label={t("Sayfadakilerin hepsini seç", "Select all on this page")}
                      className="h-4 w-4 accent-[#D97757]"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">{t("Kullanıcı", "User")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("Durum", "Status")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("Plan", "Plan")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("Rol", "Role")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t("Kredi", "Credits")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("Mağazalar", "Shops")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t("AI (30 g)", "AI (30 d)")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("Son aktif", "Last active")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("Kayıt", "Joined")}</th>
                  <th className="w-12 px-3 py-2.5">
                    <span className="sr-only">{t("İşlemler", "Actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {items.map((u) => (
                  <tr key={u.id} className={selected.has(u.id) ? "bg-[#D97757]/5 dark:bg-[#D97757]/10" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={t(`${u.email} seç`, `Select ${u.email}`)} className="h-4 w-4 accent-[#D97757]" />
                    </td>
                    <td className="max-w-[260px] px-3 py-2.5">
                      <Link href={`/admin/users/${u.id}`} className="flex min-w-0 items-center gap-2.5">
                        <Avatar user={u} size={32} className="flex-shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-neutral-900 hover:underline dark:text-neutral-100">{u.name || u.email}</span>
                          {u.name && <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{u.email}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge user={u} />
                    </td>
                    <td className="px-3 py-2.5">
                      {u.plan ? (
                        <Badge tone="good">
                          {u.plan}
                          {u.plan_manual ? ` · ${t("elle", "manual")}` : ""}
                        </Badge>
                      ) : (
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">{t("Ücretsiz", "Free")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.role === "admin" ? <Badge tone="warn">{t("Yönetici", "Admin")}</Badge> : <span className="text-xs text-neutral-500 dark:text-neutral-400">{t("Kullanıcı", "User")}</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${u.credits <= 0 ? "text-neutral-400 dark:text-neutral-500" : "text-neutral-900 dark:text-neutral-100"}`}>{f.num(u.credits)}</td>
                    <td className="max-w-[180px] px-3 py-2.5">
                      {u.shops.length === 0 ? (
                        <span className="text-xs text-neutral-400 dark:text-neutral-500">—</span>
                      ) : (
                        <span className="block truncate text-xs text-neutral-700 dark:text-neutral-300" title={u.shops.map((s) => s.shop_name).join(", ")}>
                          {u.shops.map((s) => s.shop_name).join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{u.ai_enabled ? f.num(u.ai_requests_30d) : t("kapalı", "off")}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-neutral-500 dark:text-neutral-400">{f.dateTime(u.last_seen_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-neutral-500 dark:text-neutral-400">{f.date(u.created_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <UserActionsMenu user={u} onSelect={(a) => action.open(u, a)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-3 py-2.5 text-sm dark:border-neutral-800">
            <span className="tabular-nums text-xs text-neutral-500 dark:text-neutral-400">
              {f.num(query.offset + 1)}–{f.num(Math.min(query.offset + PAGE_SIZE, total))} / {f.num(total)}
            </span>
            <div className="flex gap-2">
              <Button disabled={query.offset === 0 || loading} onClick={() => update({ offset: Math.max(0, query.offset - PAGE_SIZE) })}>
                {t("Önceki", "Previous")}
              </Button>
              <Button disabled={query.offset + PAGE_SIZE >= total || loading} onClick={() => update({ offset: query.offset + PAGE_SIZE })}>
                {t("Sonraki", "Next")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {action.dialog}
      {bulk && (
        <BulkDialog
          action={bulk}
          userIds={[...selected]}
          onClose={() => setBulk(null)}
          onDone={() => {
            setSelected(new Set());
            reload();
          }}
        />
      )}
    </div>
  );
}

function BulkDialog({ action, userIds, onClose, onDone }: { action: AdminBulkAction; userIds: number[]; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const [amount, setAmount] = useState("");
  const [bucket, setBucket] = useState<"plan" | "purchased">("purchased");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const value = Number(amount);
  const titles: Record<AdminBulkAction, string> = {
    credits: t("Seçilenlere kredi ekle", "Add credits to selected"),
    activate: t("Seçilenleri etkinleştir", "Activate selected"),
    suspend: t("Seçilenleri askıya al", "Suspend selected"),
    block: t("Seçilenleri engelle", "Block selected"),
  };

  async function run() {
    setBusy(true);
    try {
      const results = await api.admin.usersBulk(userIds, action, { amount: action === "credits" ? value : undefined, bucket, reason: reason.trim() });
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) toast.success(t(`${results.length} kullanıcı güncellendi`, `${results.length} users updated`));
      else toast.error(t(`${results.length - failed.length} başarılı, ${failed.length} başarısız: ${failed[0].error}`, `${results.length - failed.length} done, ${failed.length} failed: ${failed[0].error}`));
      onDone();
      onClose();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const destructive = action === "block" || action === "suspend";
  return (
    <Modal
      z={100}
      widthClass="max-w-md"
      title={titles[action]}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || (action === "credits" && (!Number.isInteger(value) || value === 0))}
            className={`${destructive ? btnPrimary.replace("bg-neutral-900", "bg-red-600").replace("hover:bg-neutral-700", "hover:bg-red-700") : btnPrimary} inline-flex items-center gap-2 disabled:opacity-50`}
          >
            {busy && <Spinner size={14} />}
            {t("Uygula", "Apply")}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-300">
        <p>
          {t(
            `${userIds.length} kullanıcıya uygulanır. Kendi hesabın ve yöneticiler atlanır.`,
            `Applies to ${userIds.length} users. Your own account and admins are skipped.`,
          )}
        </p>
        {action === "credits" && (
          <>
            <Field label={t("Miktar (eksi değer düşer)", "Amount (negative removes)")}>
              <input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" className={inputClass} />
            </Field>
            <Field label={t("Kova", "Bucket")}>
              <select value={bucket} onChange={(e) => setBucket(e.target.value as "plan" | "purchased")} className={inputClass}>
                <option value="purchased">{t("Satın alınan", "Purchased")}</option>
                <option value="plan">{t("Plan", "Plan")}</option>
              </select>
            </Field>
          </>
        )}
        {action !== "activate" && (
          <Field label={action === "credits" ? t("Not (isteğe bağlı)", "Note (optional)") : t("Neden (iç not, isteğe bağlı)", "Reason (internal, optional)")}>
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, FinProduct, InvoiceCandidate, InvoiceShipment } from "@/lib/api";
import { useRegenProgress } from "@/lib/useRegenProgress";
import { tNow as t } from "@/lib/i18n";
import { useCached } from "@/lib/pageCache";
import { BlockSpinner } from "@/components/ui/Spinner";

const card = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
const input = "rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
/** Menüdeki hazır aralık -> [başlangıç, bitiş] (boş = sınırsız). "custom" için tarihler kullanıcıdan gelir. */
const RANGES: { id: string; label: [string, string]; get?: () => [string, string] }[] = [
  { id: "all", label: ["Tüm tarihler", "All dates"], get: () => ["", ""] },
  { id: "7", label: ["Son 7 gün", "Last 7 days"], get: () => [daysAgo(7), ""] },
  { id: "30", label: ["Son 30 gün", "Last 30 days"], get: () => [daysAgo(30), ""] },
  { id: "90", label: ["Son 90 gün", "Last 90 days"], get: () => [daysAgo(90), ""] },
  { id: "month", label: ["Bu ay", "This month"], get: () => [iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), ""] },
  { id: "lastmonth", label: ["Geçen ay", "Last month"], get: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
  { id: "year", label: ["Bu yıl", "This year"], get: () => [iso(new Date(new Date().getFullYear(), 0, 1)), ""] },
  { id: "custom", label: ["Özel aralık…", "Custom range…"] },
];

type Review = { id: number; candidate: InvoiceCandidate; receiptId: number | null };
type Progress = { done: number; total: number; startedAt: number; name: string };

/** Dosya sayısı + mevcut dosyanın zaman-bazlı tahmini ilerlemesiyle tek bir yüzdelik dolum çubuğu. */
function ProgressBar({ p }: { p: Progress }) {
  const cur = useRegenProgress({ phase: "running", startedAt: p.startedAt });
  const pct = Math.min(99, Math.round(((p.done + cur / 100) / p.total) * 100));
  return (
    <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="relative h-5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-[#D97757]/70 transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-neutral-900 dark:text-neutral-50">
          {p.name} {t("okunuyor…", "reading…")} %{pct} ({p.done}/{p.total})
        </span>
      </div>
    </div>
  );
}

/**
 * "Kargo faturaları" sekmesi: fatura dosyası (PDF/görsel/Excel/CSV/HTML) yükle → yapay zekâ gönderi satırlarını
 * çıkarır → her satır takip no / alıcı adına göre bir SİPARİŞLE eşleşir → onayla → tutar o siparişin ürünlerine
 * dağıtılıp gerçek kargo maliyeti olarak yazılır. Dosyanın kendisi saklanmaz, yalnızca çıkarılan veri.
 */
export default function ShippingInvoices({
  shopId,
  products,
  money2,
  onSaved,
}: {
  shopId: number;
  products: FinProduct[];
  money2: Intl.NumberFormat;
  onSaved: () => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [invStart, setInvStart] = useState("");
  const [invEnd, setInvEnd] = useState("");
  const [range, setRange] = useState("all");
  const [sort, setSort] = useState("inv_date");
  const [page, setPage] = useState(0);
  const PER_PAGE = 20;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextId, setNextId] = useState(1);
  // Kayıtlı faturalar sekme belleğinde tutulur: sekmeye geri dönünce liste beklemeden görünür, arkada tazelenir.
  const [list, setList] = useCached<{ items: InvoiceShipment[]; total: number; total_amount: number }>(
    `fin-invoices:${shopId}:${q}:${kind}:${invStart}:${invEnd}:${sort}:${page}`,
    { keepPrevious: true },
  );
  const saved = list?.items ?? [];
  const total = list?.total ?? 0;
  const totalAmount = list?.total_amount ?? 0;
  const titleOf = (id: number) => products.find((p) => p.listing_id === id)?.title || `Listing ${id}`;

  const loadSaved = useCallback(() => {
    api.finance.invoices
      .list(shopId, { q, kind, invStart, invEnd, sort, page, perPage: PER_PAGE })
      .then((r) => setList({ items: r.items, total: r.total, total_amount: r.total_amount }))
      .catch(() => setList({ items: [], total: 0, total_amount: 0 }));
  }, [shopId, q, kind, invStart, invEnd, sort, page, setList]);
  // Arama yazılırken her tuşta istek atmamak için kısa bir gecikme; aramasız açılışta beklemeden yükle.
  useEffect(() => {
    const timer = setTimeout(loadSaved, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [loadSaved, q]);
  // Süzgeç değişince ilk sayfaya dön.
  const onFilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
    setSelected(new Set());
  };
  const hasFilter = !!(q || kind || range !== "all");
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const shipKey = (g: InvoiceShipment) => `${g.receipt_id}-${g.tracking_no}-${g.lines[0]?.id}`;
  const selectedShipments = saved.filter((g) => selected.has(shipKey(g)));
  const allOnPage = saved.length > 0 && saved.every((g) => selected.has(shipKey(g)));
  const toggleSel = (key: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  async function removeSelected() {
    const lineCount = selectedShipments.reduce((n, g) => n + g.lines.length, 0);
    const msg = t(
      `${selectedShipments.length} gönderi (${lineCount} fatura kalemi) silinsin mi? Bu siparişlerin kargo maliyeti tekrar 0'a döner. Bu işlem geri alınamaz.`,
      `Delete ${selectedShipments.length} shipments (${lineCount} invoice lines)? Shipping cost for these orders goes back to 0. This cannot be undone.`,
    );
    if (!window.confirm(msg)) return;
    await api.finance.invoices.removeMany(shopId, selectedShipments.flatMap((g) => g.lines.map((l) => l.id)));
    setSelected(new Set());
    loadSaved();
    onSaved();
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    let id = nextId;
    const added: Review[] = [];
    for (let i = 0; i < list.length; i++) {
      setProgress({ done: i, total: list.length, startedAt: Date.now(), name: list[i].name });
      try {
        const candidates = await api.finance.invoices.parse(shopId, list[i]);
        for (const c of candidates) {
          added.push({ id: id++, candidate: c, receiptId: c.already_saved ? null : (c.matches[0]?.receipt_id ?? null) });
        }
      } catch (e) {
        // Ağ hatasında (sunucu yanıt vermediğinde) mesaj boş gelir; dosya adının yanında boşluk kalmasın.
        const msg = e instanceof Error && e.message ? e.message : t("okunamadı, tekrar dene", "could not be read, try again");
        setError(`${list[i].name}: ${msg}`);
      }
    }
    setNextId(id);
    setReviews((r) => [...r, ...added]);
    setProgress(null);
  }

  async function confirmOne(r: Review): Promise<boolean> {
    if (r.receiptId === null) return false;
    try {
      await api.finance.invoices.confirm(shopId, r.receiptId, r.candidate);
      setReviews((list) => list.filter((x) => x.id !== r.id));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Kaydedilemedi", "Could not save"));
      return false;
    }
  }

  async function confirm(r: Review) {
    setSaving(true);
    if (await confirmOne(r)) {
      loadSaved();
      onSaved();
    }
    setSaving(false);
  }

  // Takip no ile kesin eşleşen (skor ≥ 0,9) ve daha önce kaydedilmemiş satırların tümünü tek tıkla onaylar.
  const sure = reviews.filter((r) => !r.candidate.already_saved && r.receiptId !== null && (r.candidate.matches.find((m) => m.receipt_id === r.receiptId)?.score ?? 0) >= 0.9);
  async function confirmSure() {
    setSaving(true);
    for (const r of sure) await confirmOne(r);
    loadSaved();
    onSaved();
    setSaving(false);
  }

  async function remove(id: number) {
    await api.finance.invoices.remove(shopId, id);
    loadSaved();
    onSaved();
  }

  const patch = (id: number, p: Partial<Review>) => setReviews((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="text-base font-semibold">{t("Kargo faturası yükle", "Upload shipping invoices")}</h2>
        <p className="mb-3 text-xs text-neutral-500">
          {t(
            "PDF, JPG/PNG, Excel (xlsx/xls), CSV ya da HTML. Faturadaki her gönderi, takip numarası / alıcı adına göre bir siparişle eşleşir ve tutarı o siparişin ürünlerine yazılır. Aynı gönderi için gümrük + nakliye gibi birden fazla fatura yüklenebilir, hepsi toplanır. Dosyalar saklanmaz, yalnızca çıkarılan tutarlar kaydedilir.",
            "PDF, JPG/PNG, Excel (xlsx/xls), CSV or HTML. Each shipment on the invoice is matched to an order by tracking number / recipient name, and the amount is added to that order's items. You can upload several invoices for one shipment (e.g. customs + freight); they are added up. Files are not stored, only the extracted amounts.",
          )}
        </p>
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!progress) void handleFiles(e.dataTransfer.files);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 hover:border-neutral-400 dark:border-neutral-700"
        >
          <span className="text-2xl">🧾</span>
          <span className="font-medium text-neutral-700 dark:text-neutral-200">{t("Faturaları buraya bırak ya da tıkla", "Drop invoices here or click")}</span>
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.html,.htm"
            className="hidden"
            disabled={!!progress}
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {progress && <ProgressBar p={progress} />}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      {reviews.length > 0 && (
        <section className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t("Onay bekleyenler", "Waiting for confirmation")} ({reviews.length})</h2>
            {sure.length > 0 && (
              <button type="button" disabled={saving} onClick={() => void confirmSure()} className="rounded-full bg-[#D97757] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                {t("Kesin eşleşenleri onayla", "Confirm sure matches")} ({sure.length})
              </button>
            )}
          </div>
          <div className="space-y-3">
            {reviews.map((r) => {
              const c = r.candidate;
              const match = c.matches.find((m) => m.receipt_id === r.receiptId);
              return (
                <div key={r.id} className={`rounded-lg border p-3 text-sm ${c.already_saved ? "border-amber-300 dark:border-amber-800" : "border-neutral-200 dark:border-neutral-800"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="font-semibold">{c.recipient || t("Alıcı yok", "No recipient")}</span>
                      {c.recipient_country && <span className="text-neutral-500"> · {c.recipient_country}</span>}
                      <div className="text-xs text-neutral-500">
                        {c.vendor} · {t("takip", "tracking")} {c.tracking_no || "—"} · {c.ship_date ?? c.invoice_date}
                        {c.weight_kg ? ` · ${c.weight_kg} kg` : ""} · {c.description || c.kind}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-semibold">{money2.format(c.amount)}</div>
                      <div className="text-xs text-neutral-500">
                        {c.original_currency} {c.original_amount.toFixed(2)} · {c.fx_source}
                      </div>
                    </div>
                  </div>

                  {c.already_saved && <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">{t("Bu gönderi zaten kayıtlı — tekrar eklenmez.", "This shipment is already saved — it will not be added again.")}</div>}
                  {c.check_note && <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">⚠ {c.check_note}</div>}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select value={c.kind} onChange={(e) => patch(r.id, { candidate: { ...c, kind: e.target.value as InvoiceCandidate["kind"] } })} className={input}>
                      <option value="nakliye">{t("Nakliye", "Freight")}</option>
                      <option value="gümrük">{t("Gümrük", "Customs")}</option>
                      <option value="ek hizmet">{t("Ek hizmet", "Extra service")}</option>
                      <option value="diğer">{t("Diğer", "Other")}</option>
                    </select>
                    {c.matches.length > 0 ? (
                      <select value={r.receiptId ?? ""} onChange={(e) => patch(r.id, { receiptId: e.target.value ? Number(e.target.value) : null })} className={`${input} max-w-sm`}>
                        <option value="">{t("Sipariş seç…", "Choose order…")}</option>
                        {c.matches.map((m) => (
                          <option key={m.receipt_id} value={m.receipt_id}>
                            %{Math.round(m.score * 100)} ({m.reason}) · {m.buyer} · {m.date} · {m.country}{m.canceled ? t(" · İPTAL", " · CANCELED") : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        placeholder={t("Sipariş no (eşleşme yok)", "Order no. (no match)")}
                        onChange={(e) => patch(r.id, { receiptId: e.target.value ? Number(e.target.value) : null })}
                        className={`${input} w-48`}
                      />
                    )}
                    <button type="button" disabled={r.receiptId === null || c.already_saved || saving} onClick={() => void confirm(r)} className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
                      {t("Onayla", "Confirm")}
                    </button>
                    <button type="button" onClick={() => setReviews((l) => l.filter((x) => x.id !== r.id))} className="text-sm text-neutral-500 hover:underline">
                      {t("Atla", "Skip")}
                    </button>
                  </div>
                  {match?.canceled && (
                    <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      ⚠{" "}
                      {t(
                        "Bu sipariş iptal edilmiş: Finans iptal edilen siparişleri saymadığı için bu kargo maliyeti hiçbir raporda görünmez.",
                        "This order was canceled: finance ignores canceled orders, so this shipping cost will not appear in any report.",
                      )}
                    </div>
                  )}
                  {match && (
                    <ul className="mt-1 text-xs text-neutral-500">
                      {match.items.map((it, i) => (
                        <li key={i} className="line-clamp-1">
                          → {it.qty}× {it.title}
                          {it.variant_key ? ` [${it.variant_key.slice(0, 40)}]` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">{t("Kayıtlı gönderiler", "Saved shipments")} ({total})</h2>
          <span className="text-sm text-neutral-500">
            {t("Toplam", "Total")}: <b className="text-neutral-900 dark:text-neutral-100">{money2.format(totalAmount)}</b>
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-2 text-xs text-neutral-500">
          <input value={q} onChange={(e) => onFilter(setQ)(e.target.value)} placeholder={t("Müşteri, takip no, ürün ara", "Search customer, tracking no., item")} className={`${input} w-56`} />
          <select value={kind} onChange={(e) => onFilter(setKind)(e.target.value)} className={input}>
            <option value="">{t("Tüm türler", "All types")}</option>
            <option value="nakliye">{t("Nakliye", "Freight")}</option>
            <option value="gümrük">{t("Gümrük", "Customs")}</option>
            <option value="ek hizmet">{t("Ek hizmet", "Extra service")}</option>
            <option value="diğer">{t("Diğer", "Other")}</option>
          </select>
          <select
            value={range}
            onChange={(e) => {
              const id = e.target.value;
              setRange(id);
              const r = RANGES.find((x) => x.id === id);
              if (r?.get) {
                const [from, to] = r.get();
                setInvStart(from);
                setInvEnd(to);
              }
              setPage(0);
            }}
            className={input}
            title={t("Fatura tarihi aralığı", "Invoice date range")}
          >
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id === "all" ? t("Fatura tarihi: tümü", "Invoice date: all") : t(...r.label)}
              </option>
            ))}
          </select>
          {range === "custom" && (
            <span className="flex items-center gap-1">
              <input type="date" value={invStart} onChange={(e) => onFilter(setInvStart)(e.target.value)} className={input} aria-label={t("Başlangıç", "Start")} />
              <span>–</span>
              <input type="date" value={invEnd} onChange={(e) => onFilter(setInvEnd)(e.target.value)} className={input} aria-label={t("Bitiş", "End")} />
            </span>
          )}
          <select value={sort} onChange={(e) => onFilter(setSort)(e.target.value)} className={input}>
            <option value="inv_date">{t("Fatura tarihine göre", "By invoice date")}</option>
            <option value="order_date">{t("Sipariş tarihine göre", "By order date")}</option>
            <option value="buyer">{t("Müşteri adına göre", "By customer name")}</option>
            <option value="amount">{t("Tutara göre", "By amount")}</option>
          </select>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setKind("");
                setRange("all");
                setInvStart("");
                setInvEnd("");
                setPage(0);
              }}
              className="pb-1 text-neutral-500 underline"
            >
              {t("Süzgeçleri temizle", "Clear filters")}
            </button>
          )}
        </div>
        {selectedShipments.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">
            <span className="font-medium">{t(`${selectedShipments.length} gönderi seçili`, `${selectedShipments.length} shipments selected`)}</span>
            <button type="button" onClick={() => void removeSelected()} className="rounded-full bg-red-600 px-4 py-1 text-xs font-semibold text-white hover:bg-red-700">
              {t("Seçilenleri sil", "Delete selected")}
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-neutral-500 underline">
              {t("Seçimi temizle", "Clear selection")}
            </button>
          </div>
        )}
        {list === null ? (
          <BlockSpinner />
        ) : saved.length === 0 ? (
          <p className="text-sm text-neutral-400">{hasFilter ? t("Bu süzgeçlere uyan fatura yok.", "No invoices match these filters.") : t("Henüz onaylanmış fatura yok.", "No confirmed invoices yet.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
                  <th className="w-6 py-2 pr-1">
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      onChange={(e) => setSelected(e.target.checked ? new Set(saved.map(shipKey)) : new Set())}
                      aria-label={t("Sayfadakilerin hepsini seç", "Select all on this page")}
                      className="h-4 w-4 accent-[#D97757]"
                    />
                  </th>
                  <th className="w-5 py-2" />
                  <th className="py-2 pr-3 font-medium">{t("Müşteri", "Customer")}</th>
                  <th className="py-2 pr-3 font-medium">{t("Takip no", "Tracking no.")}</th>
                  <th className="py-2 pr-3 font-medium">{t("Ürün", "Item")}</th>
                  <th className="py-2 pr-3 font-medium">{t("Sipariş tarihi", "Order date")}</th>
                  <th className="py-2 pr-3 font-medium">{t("Son fatura", "Latest invoice")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("Kalem", "Lines")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("Toplam", "Total")}</th>
                  <th className="py-2 text-right font-medium">Kg</th>
                </tr>
              </thead>
              <tbody>
                {saved.map((g) => {
                  const key = shipKey(g);
                  const open = expanded.has(key);
                  return (
                    <Fragment key={key}>
                      <tr onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })} className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40">
                        <td className="py-2 pr-1" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSel(key)} aria-label={t("Gönderiyi seç", "Select shipment")} className="h-4 w-4 accent-[#D97757]" />
                        </td>
                        <td className="py-2 text-xs text-neutral-400">{open ? "▼" : "▶"}</td>
                        <td className="py-2 pr-3 font-medium">{g.buyer || "—"}</td>
                        <td className="py-2 pr-3 text-xs text-neutral-500">{g.tracking_no || "—"}</td>
                        <td className="py-2 pr-3">
                          <div className="line-clamp-1 max-w-xs">{g.products[0]?.title || titleOf(g.products[0]?.listing_id ?? 0)}</div>
                          {g.products.length > 1 && <div className="text-[11px] text-neutral-400">{t(`+${g.products.length - 1} ürün daha`, `+${g.products.length - 1} more items`)}</div>}
                        </td>
                        <td className="py-2 pr-3">{g.order_date ?? "—"}</td>
                        <td className="py-2 pr-3">{g.last_invoice_date}</td>
                        <td className="py-2 pr-3 text-right">
                          {g.lines.length}
                          {g.warnings.length > 0 && <span className="ml-1 text-amber-500" title={g.warnings.join(" · ")}>⚠</span>}
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold">{money2.format(g.total)}</td>
                        <td className="py-2 text-right">{g.weight_kg ?? "—"}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-neutral-100 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-950/40">
                          <td colSpan={2} />
                          <td colSpan={8} className="py-2 pr-3">
                            {g.warnings.length > 0 && (
                              <div className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                ⚠ {g.warnings.join(" · ")} — {t("faturaları kontrol edin.", "check the invoices.")}
                              </div>
                            )}
                            {g.lines.map((l) => (
                              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 py-1.5 last:border-0 dark:border-neutral-800">
                                <div>
                                  <span className="mr-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-medium dark:bg-neutral-800">{l.kind}</span>
                                  {l.description || "—"}
                                  <span className="ml-2 text-xs text-neutral-400">{l.invoice_no || l.source_filename} · {l.invoice_date}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span>
                                    {money2.format(l.amount)}
                                    <span className="ml-1 text-[11px] text-neutral-400">{l.original_currency} {l.original_amount.toFixed(2)}</span>
                                  </span>
                                  <button type="button" onClick={(ev) => { ev.stopPropagation(); void remove(l.id); }} className="text-xs text-red-600 hover:underline">
                                    {t("Sil", "Delete")}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PER_PAGE && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">
              ‹ {t("Önceki", "Previous")}
            </button>
            <span className="text-neutral-500">
              {t("Sayfa", "Page")} {page + 1} / {pages}
            </span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">
              {t("Sonraki", "Next")} ›
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, FinProduct, InvoiceCandidate, InvoiceShipment } from "@/lib/api";
import { useRegenProgress } from "@/lib/useRegenProgress";

const card = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
const input = "rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
/** Menüdeki hazır aralık -> [başlangıç, bitiş] (boş = sınırsız). "custom" için tarihler kullanıcıdan gelir. */
const RANGES: { id: string; label: string; get?: () => [string, string] }[] = [
  { id: "all", label: "Tüm tarihler", get: () => ["", ""] },
  { id: "7", label: "Son 7 gün", get: () => [daysAgo(7), ""] },
  { id: "30", label: "Son 30 gün", get: () => [daysAgo(30), ""] },
  { id: "90", label: "Son 90 gün", get: () => [daysAgo(90), ""] },
  { id: "month", label: "Bu ay", get: () => [iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), ""] },
  { id: "lastmonth", label: "Geçen ay", get: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
  { id: "year", label: "Bu yıl", get: () => [iso(new Date(new Date().getFullYear(), 0, 1)), ""] },
  { id: "custom", label: "Özel aralık…" },
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
        <div className="h-full rounded-full bg-[#F1641E]/70 transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-neutral-900 dark:text-neutral-50">
          {p.name} okunuyor… %{pct} ({p.done}/{p.total})
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
  const [saved, setSaved] = useState<InvoiceShipment[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
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
  const titleOf = (id: number) => products.find((p) => p.listing_id === id)?.title || `Listing ${id}`;

  const loadSaved = useCallback(() => {
    api.finance.invoices
      .list(shopId, { q, kind, invStart, invEnd, sort, page, perPage: PER_PAGE })
      .then((r) => {
        setSaved(r.items);
        setTotal(r.total);
        setTotalAmount(r.total_amount);
      })
      .catch(() => setSaved([]));
  }, [shopId, q, kind, invStart, invEnd, sort, page]);
  // Arama yazılırken her tuşta istek atmamak için kısa bir gecikme.
  useEffect(() => {
    const t = setTimeout(loadSaved, 250);
    return () => clearTimeout(t);
  }, [loadSaved]);
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
    if (!window.confirm(`${selectedShipments.length} gönderi (${lineCount} fatura kalemi) silinsin mi? Bu siparişlerin kargo maliyeti tekrar 0'a döner. Bu işlem geri alınamaz.`)) return;
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
        setError(`${list[i].name}: ${e instanceof Error ? e.message : "okunamadı"}`);
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
      setError(e instanceof Error ? e.message : "Kaydedilemedi");
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
        <h2 className="text-base font-semibold">Kargo faturası yükle</h2>
        <p className="mb-3 text-xs text-neutral-500">
          PDF, JPG/PNG, Excel (xlsx/xls), CSV ya da HTML. Faturadaki her gönderi, takip numarası / alıcı adına göre bir siparişle eşleşir ve
          tutarı o siparişin ürünlerine yazılır. Aynı gönderi için gümrük + nakliye gibi birden fazla fatura yüklenebilir, hepsi toplanır.
          Dosyalar saklanmaz, yalnızca çıkarılan tutarlar kaydedilir.
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
          <span className="font-medium text-neutral-700 dark:text-neutral-200">Faturaları buraya bırak ya da tıkla</span>
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
            <h2 className="text-base font-semibold">Onay bekleyenler ({reviews.length})</h2>
            {sure.length > 0 && (
              <button type="button" disabled={saving} onClick={() => void confirmSure()} className="rounded-full bg-[#F1641E] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                Kesin eşleşenleri onayla ({sure.length})
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
                      <span className="font-semibold">{c.recipient || "Alıcı yok"}</span>
                      {c.recipient_country && <span className="text-neutral-500"> · {c.recipient_country}</span>}
                      <div className="text-xs text-neutral-500">
                        {c.vendor} · takip {c.tracking_no || "—"} · {c.ship_date ?? c.invoice_date}
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

                  {c.already_saved && <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">Bu gönderi zaten kayıtlı — tekrar eklenmez.</div>}
                  {c.check_note && <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">⚠ {c.check_note}</div>}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select value={c.kind} onChange={(e) => patch(r.id, { candidate: { ...c, kind: e.target.value as InvoiceCandidate["kind"] } })} className={input}>
                      <option value="nakliye">Nakliye</option>
                      <option value="gümrük">Gümrük</option>
                      <option value="ek hizmet">Ek hizmet</option>
                      <option value="diğer">Diğer</option>
                    </select>
                    {c.matches.length > 0 ? (
                      <select value={r.receiptId ?? ""} onChange={(e) => patch(r.id, { receiptId: e.target.value ? Number(e.target.value) : null })} className={`${input} max-w-sm`}>
                        <option value="">Sipariş seç…</option>
                        {c.matches.map((m) => (
                          <option key={m.receipt_id} value={m.receipt_id}>
                            %{Math.round(m.score * 100)} ({m.reason}) · {m.buyer} · {m.date} · {m.country}{m.canceled ? " · İPTAL" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        placeholder="Sipariş no (eşleşme yok)"
                        onChange={(e) => patch(r.id, { receiptId: e.target.value ? Number(e.target.value) : null })}
                        className={`${input} w-48`}
                      />
                    )}
                    <button type="button" disabled={r.receiptId === null || c.already_saved || saving} onClick={() => void confirm(r)} className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
                      Onayla
                    </button>
                    <button type="button" onClick={() => setReviews((l) => l.filter((x) => x.id !== r.id))} className="text-sm text-neutral-500 hover:underline">
                      Atla
                    </button>
                  </div>
                  {match?.canceled && (
                    <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      ⚠ Bu sipariş iptal edilmiş: Finans iptal edilen siparişleri saymadığı için bu kargo maliyeti hiçbir raporda görünmez.
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
          <h2 className="text-base font-semibold">Kayıtlı gönderiler ({total})</h2>
          <span className="text-sm text-neutral-500">
            Toplam: <b className="text-neutral-900 dark:text-neutral-100">{money2.format(totalAmount)}</b>
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-2 text-xs text-neutral-500">
          <input value={q} onChange={(e) => onFilter(setQ)(e.target.value)} placeholder="Müşteri, takip no, ürün ara" className={`${input} w-56`} />
          <select value={kind} onChange={(e) => onFilter(setKind)(e.target.value)} className={input}>
            <option value="">Tüm türler</option>
            <option value="nakliye">Nakliye</option>
            <option value="gümrük">Gümrük</option>
            <option value="ek hizmet">Ek hizmet</option>
            <option value="diğer">Diğer</option>
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
            title="Fatura tarihi aralığı"
          >
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id === "all" ? "Fatura tarihi: tümü" : r.label}
              </option>
            ))}
          </select>
          {range === "custom" && (
            <span className="flex items-center gap-1">
              <input type="date" value={invStart} onChange={(e) => onFilter(setInvStart)(e.target.value)} className={input} aria-label="Başlangıç" />
              <span>–</span>
              <input type="date" value={invEnd} onChange={(e) => onFilter(setInvEnd)(e.target.value)} className={input} aria-label="Bitiş" />
            </span>
          )}
          <select value={sort} onChange={(e) => onFilter(setSort)(e.target.value)} className={input}>
            <option value="inv_date">Fatura tarihine göre</option>
            <option value="order_date">Sipariş tarihine göre</option>
            <option value="buyer">Müşteri adına göre</option>
            <option value="amount">Tutara göre</option>
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
              Süzgeçleri temizle
            </button>
          )}
        </div>
        {selectedShipments.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">
            <span className="font-medium">{selectedShipments.length} gönderi seçili</span>
            <button type="button" onClick={() => void removeSelected()} className="rounded-full bg-red-600 px-4 py-1 text-xs font-semibold text-white hover:bg-red-700">
              Seçilenleri sil
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-neutral-500 underline">
              Seçimi temizle
            </button>
          </div>
        )}
        {saved.length === 0 ? (
          <p className="text-sm text-neutral-400">{hasFilter ? "Bu süzgeçlere uyan fatura yok." : "Henüz onaylanmış fatura yok."}</p>
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
                      aria-label="Sayfadakilerin hepsini seç"
                      className="h-4 w-4 accent-[#F1641E]"
                    />
                  </th>
                  <th className="w-5 py-2" />
                  <th className="py-2 pr-3 font-medium">Müşteri</th>
                  <th className="py-2 pr-3 font-medium">Takip no</th>
                  <th className="py-2 pr-3 font-medium">Ürün</th>
                  <th className="py-2 pr-3 font-medium">Sipariş tarihi</th>
                  <th className="py-2 pr-3 font-medium">Son fatura</th>
                  <th className="py-2 pr-3 text-right font-medium">Kalem</th>
                  <th className="py-2 pr-3 text-right font-medium">Toplam</th>
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
                          <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSel(key)} aria-label="Gönderiyi seç" className="h-4 w-4 accent-[#F1641E]" />
                        </td>
                        <td className="py-2 text-xs text-neutral-400">{open ? "▼" : "▶"}</td>
                        <td className="py-2 pr-3 font-medium">{g.buyer || "—"}</td>
                        <td className="py-2 pr-3 text-xs text-neutral-500">{g.tracking_no || "—"}</td>
                        <td className="py-2 pr-3">
                          <div className="line-clamp-1 max-w-xs">{g.products[0]?.title || titleOf(g.products[0]?.listing_id ?? 0)}</div>
                          {g.products.length > 1 && <div className="text-[11px] text-neutral-400">+{g.products.length - 1} ürün daha</div>}
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
                                ⚠ {g.warnings.join(" · ")} — faturaları kontrol edin.
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
                                    Sil
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
              ‹ Önceki
            </button>
            <span className="text-neutral-500">
              Sayfa {page + 1} / {pages}
            </span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">
              Sonraki ›
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

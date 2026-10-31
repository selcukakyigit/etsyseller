"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, FinProduct, InvoiceCandidate, InvoiceShipment } from "@/lib/api";
import { tNow as t } from "@/lib/i18n";
import { useCached } from "@/lib/pageCache";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import DateRangePicker, { presetOptions } from "@/components/ui/DateRangePicker";
import DocumentAnalyzer from "@/modules/components/DocumentAnalyzer";
import HelpTip from "@/components/ui/HelpTip";
import VendorBadge, { KNOWN_CARRIERS } from "./VendorBadge";
import InvoiceReviewGroup, { CHECK_FROM, Review, STRONG_FROM } from "./InvoiceReviewGroup";

type ReviewFilter = "all" | "sure" | "check" | "weak" | "nomatch";

// Aynı gönderinin kalemleri tek kartta toplanır: takip no, yoksa alıcı + tarih anahtarıdır.
const groupKeyOf = (c: InvoiceCandidate) => c.tracking_no || `${c.recipient}|${c.ship_date ?? c.invoice_date}`;

const card = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
/** Süzgeç satırındaki kutular: tarih seçiciyle (DateRangePicker) aynı yükseklik ve kenarlık. */
const filterCtl = "h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";


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
  focus = null,
  onFocusUsed,
}: {
  shopId: number;
  products: FinProduct[];
  money2: Intl.NumberFormat;
  onSaved: () => void;
  /** Verilirse yalnızca bu siparişin faturaları listelenir, gönderi açılıp vurgulanır (sipariş penceresinden gelinir). */
  focus?: { receiptId: number; label: string } | null;
  onFocusUsed?: () => void;
}) {
  const [confirm, confirmElement] = useConfirm();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [docVendor, setDocVendor] = useState(""); // belgedeki boş firmalara yazılan ortak firma
  const [otherMode, setOtherMode] = useState(false); // listede olmayan firmayı yazmak için
  const lastReviewCount = useRef(0);
  const [highlight, setHighlight] = useState<number | null>(null); // vurgulanan gönderinin sipariş no
  const [receiptFilter, setReceiptFilter] = useState<{ id: number; label: string } | null>(null); // tek siparişin faturaları
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [invStart, setInvStart] = useState("");
  const [invEnd, setInvEnd] = useState("");
  const [range, setRange] = useState("all");
  const [sort, setSort] = useState("inv_date");
  const [desc, setDesc] = useState<boolean | null>(null); // null: sütunun varsayılan yönü
  const [page, setPage] = useState(0);
  const PER_PAGE = 20;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [batch, setBatch] = useState<{ ids: number[]; reviews: Review[]; shipments: number } | null>(null); // son toplu onay (geri alınabilir)
  const [notice, setNotice] = useState<string | null>(null); // yükleme sonucu bilgisi (ör. her şey zaten kayıtlı)
  const nextId = useRef(1);
  // Kayıtlı faturalar sekme belleğinde tutulur: sekmeye geri dönünce liste beklemeden görünür, arkada tazelenir.
  const [list, setList] = useCached<{ items: InvoiceShipment[]; total: number; total_amount: number }>(
    `fin-invoices:${shopId}:${q}:${kind}:${invStart}:${invEnd}:${sort}:${desc}:${receiptFilter?.id ?? ""}:${page}`,
    { keepPrevious: true },
  );
  const saved = list?.items ?? [];
  const total = list?.total ?? 0;
  const totalAmount = list?.total_amount ?? 0;
  const titleOf = (id: number) => products.find((p) => p.listing_id === id)?.title || `Listing ${id}`;

  const loadSaved = useCallback(() => {
    api.finance.invoices
      .list(shopId, { q, kind, invStart, invEnd, sort, desc, receiptId: receiptFilter?.id, page, perPage: PER_PAGE })
      .then((r) => setList({ items: r.items, total: r.total, total_amount: r.total_amount }))
      .catch(() => setList({ items: [], total: 0, total_amount: 0 }));
  }, [shopId, q, kind, invStart, invEnd, sort, desc, receiptFilter, page, setList]);
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
  const DEFAULT_DESC: Record<string, boolean> = { buyer: false, tracking: false, vendor: false, product: false, order_date: true, inv_date: true, lines: true, amount: true, weight: true };
  const effDesc = desc ?? DEFAULT_DESC[sort] ?? true;
  const onSort = (id: string) => {
    if (id === sort) setDesc(!effDesc);
    else {
      setSort(id);
      setDesc(null);
    }
    setPage(0);
  };
  const hasFilter = !!(q || kind || range !== "all" || receiptFilter);
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
    if (!(await confirm({ title: t("Gönderiler silinsin mi?", "Delete shipments?"), message: msg, confirmLabel: t("Sil", "Delete"), destructive: true }))) return;
    await api.finance.invoices.removeMany(shopId, selectedShipments.flatMap((g) => g.lines.map((l) => l.id)));
    setSelected(new Set());
    loadSaved();
    onSaved();
  }

  // Her dosya/metin ayrı okunur; adaylar onay listesine eklenir (satır kimliği yalnızca liste anahtarı içindir).
  function addCandidates(candidates: InvoiceCandidate[]) {
    // Hiçbir kalemi yeni olmayan gönderiler listeye alınmaz (aynı belge tekrar yüklenince onlarca kart çıkmasın); tek bir not gösterilir.
    const withNew = new Set(candidates.filter((c) => !c.already_saved).map(groupKeyOf));
    const fullySaved = candidates.filter((c) => !withNew.has(groupKeyOf(c)));
    const shipments = new Set(fullySaved.map(groupKeyOf)).size;
    candidates = candidates.filter((c) => withNew.has(groupKeyOf(c)));
    setNotice(
      fullySaved.length === 0
        ? null
        : candidates.length === 0
          ? t(
              `Bu belgedeki ${fullySaved.length} kalemin (${shipments} gönderi) hepsi zaten kayıtlı. Eklenecek yeni bir şey yok, hiçbir değişiklik yapılmadı.`,
              `All ${fullySaved.length} lines (${shipments} shipments) in this document are already saved. There is nothing new to add and nothing was changed.`,
            )
          : t(`${fullySaved.length} kalem (${shipments} gönderi) zaten kayıtlıydı, listeye alınmadı.`, `${fullySaved.length} lines (${shipments} shipments) were already saved and were left out of the list.`),
    );
    const added: Review[] = candidates.map((c) => ({ id: nextId.current++, candidate: c, receiptId: c.already_saved ? null : (c.matches[0]?.receipt_id ?? null) }));
    setReviews((r) => [...r, ...added]);
  }

  async function readFile(file: File) {
    setError(null);
    setNotice(null);
    try {
      addCandidates(await api.finance.invoices.parse(shopId, file));
    } catch (e) {
      // Ağ hatasında (sunucu yanıt vermediğinde) mesaj boş gelir; dosya adının yanında boşluk kalmasın.
      const msg = e instanceof Error && e.message ? e.message : t("okunamadı, tekrar dene", "could not be read, try again");
      setError(`${file.name}: ${msg}`);
    }
  }

  async function readText(text: string) {
    setError(null);
    setNotice(null);
    try {
      addCandidates(await api.finance.invoices.parseText(shopId, text));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("Metin okunamadı, tekrar dene", "The text could not be read, try again"));
    }
  }

  const duplicateOf = (r: Review) => r.candidate.matches.find((m) => m.receipt_id === r.receiptId)?.duplicate_of ?? null;
  const askDuplicate = (msg: string) =>
    confirm({ title: t("Aynı tutarda kalem zaten var", "A line with the same amount already exists"), message: msg, confirmLabel: t("Yine de kaydet", "Save anyway"), cancelLabel: t("Vazgeç", "Cancel") });

  // `dupAsked`: aynı gönderinin kalemleri için olası mükerrer sorusu zaten sorulup onaylandı (kalem başına tekrar sorulmaz).
  async function confirmOne(r: Review, dupAsked = false): Promise<number[] | null> {
    if (r.receiptId === null) return null;
    // Siparişte aynı tutarda kalem varsa (ör. aynı fatura hem ekran görüntüsü hem Excel olarak yüklendi) ikinci onay iste.
    const dup = duplicateOf(r);
    if (dup && !dupAsked && !(await askDuplicate(t(
      `Bu siparişe aynı tutarda bir kalem zaten kayıtlı (${dup.invoice_no} · ${dup.invoice_date}). Aynı fatura iki kez yüklenmiş olabilir.`,
      `This order already has a line with the same amount (${dup.invoice_no} · ${dup.invoice_date}). The same invoice may have been uploaded twice.`,
    )))) return null;
    try {
      let res: { ids: number[] };
      try {
        res = await api.finance.invoices.confirm(shopId, r.receiptId, r.candidate, !!dup);
      } catch (e) {
        // Sipariş elle girildiyse ya da aynı yüklemede iki kopya varsa mükerreri sunucu yakalar (409).
        if (!(e instanceof ApiError && e.status === 409) || !(await askDuplicate(e.message))) throw e;
        res = await api.finance.invoices.confirm(shopId, r.receiptId, r.candidate, true);
      }
      setReviews((list) => list.filter((x) => x.id !== r.id));
      return res.ids;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Kaydedilemedi", "Could not save"));
      return null;
    }
  }

  // Aynı gönderinin kalemleri tek kartta toplanır: takip no, yoksa alıcı + tarih anahtarıdır.
  const groups: Review[][] = [];
  const groupIndex = new Map<string, number>();
  for (const r of reviews) {
    const c = r.candidate;
    const key = groupKeyOf(c);
    const at = groupIndex.get(key);
    if (at === undefined) {
      groupIndex.set(key, groups.length);
      groups.push([r]);
    } else groups[at].push(r);
  }
  const openLines = (g: Review[]) => g.filter((r) => !r.candidate.already_saved);
  const scoreOf = (g: Review[]) => g[0].candidate.matches.find((m) => m.receipt_id === g[0].receiptId)?.score ?? 0;

  async function confirmGroup(g: Review[]) {
    setSaving(true);
    // Olası mükerrer (aynı tutarda kalem) uyarısı gönderi için BİR kez sorulur.
    const dupLine = openLines(g).find((r) => duplicateOf(r));
    const dup = dupLine ? duplicateOf(dupLine) : null;
    const proceed = !dup || (await askDuplicate(t(
      `Bu siparişe aynı tutarda bir kalem zaten kayıtlı (${dup.invoice_no} · ${dup.invoice_date}). Aynı fatura iki kez yüklenmiş olabilir.`,
      `This order already has a line with the same amount (${dup.invoice_no} · ${dup.invoice_date}). The same invoice may have been uploaded twice.`,
    )));
    if (proceed) {
      for (const r of openLines(g)) await confirmOne(r, true);
      loadSaved();
      onSaved();
    }
    setSaving(false);
  }

  // Süzgeç: eşleşme bandı (kesin / kontrol et / zayıf / eşleşmeyen). Toplu işlemler yalnızca GÖRÜNEN gönderilere uygulanır.
  const bandKeyOf = (g: Review[]): Exclude<ReviewFilter, "all"> => {
    const ms = g[0].candidate.matches;
    if (ms.length === 0) return "nomatch";
    const sc = g[0].receiptId !== null ? scoreOf(g) : ms[0].score;
    return sc >= STRONG_FROM ? "sure" : sc >= CHECK_FROM ? "check" : "weak";
  };
  const counts = { all: groups.length, sure: 0, check: 0, weak: 0, nomatch: 0 };
  for (const g of groups) counts[bandKeyOf(g)]++;
  // Sıra: kesin → kontrol et → zayıf → eşleşmeyen → olası mükerrer (en altta); aynı grupta skoru yüksek olan üstte.
  const BAND_RANK = { sure: 0, check: 1, weak: 2, nomatch: 3 };
  const rankOf = (g: Review[]) => (g.some((r) => duplicateOf(r)) ? 4 : BAND_RANK[bandKeyOf(g)]);
  const scoreForSort = (g: Review[]) => (g[0].receiptId !== null ? scoreOf(g) : (g[0].candidate.matches[0]?.score ?? 0));
  const visible = (filter === "all" ? groups : groups.filter((g) => bandKeyOf(g) === filter)).slice().sort((a, b) => rankOf(a) - rankOf(b) || scoreForSort(b) - scoreForSort(a));
  // Toplu onaya yalnızca kesin ve "kontrol et" gönderiler girer: zayıf/eşleşmeyen ve olası mükerrer uyarılılar tek tek karar ister.
  const bulkEligible = visible.filter((g) => openLines(g).length > 0 && g[0].receiptId !== null && !g.some((r) => duplicateOf(r)) && ["sure", "check"].includes(bandKeyOf(g)));
  const bulkTotal = bulkEligible.reduce((sum, g) => sum + openLines(g).reduce((n, r) => n + r.candidate.amount, 0), 0);

  async function confirmVisible() {
    const left = visible.length - bulkEligible.length;
    const ok = await confirm({
      title: t(`${bulkEligible.length} gönderi onaylansın mı?`, `Confirm ${bulkEligible.length} shipments?`),
      message: t(
        `Toplam ${money2.format(bulkTotal)} kargo maliyeti eşleşen siparişlere yazılır.${left > 0 ? ` ${left} gönderi (zayıf/eşleşmeyen/mükerrer uyarılı) dahil değil, onlara tek tek bakmalısın.` : ""} Yanlış olursa "Geri al" ile kaldırabilirsin.`,
        `A total of ${money2.format(bulkTotal)} shipping cost is written to the matched orders.${left > 0 ? ` ${left} shipments (weak, unmatched or possible duplicates) are not included; review them one by one.` : ""} If something is wrong you can undo it.`,
      ),
      confirmLabel: t("Onayla", "Confirm"),
    });
    if (!ok) return;
    setSaving(true);
    const ids: number[] = [];
    const done: Review[] = [];
    for (const g of bulkEligible) {
      for (const r of openLines(g)) {
        const got = await confirmOne(r, true);
        if (got) {
          ids.push(...got);
          done.push(r);
        }
      }
    }
    setBatch(ids.length > 0 ? { ids, reviews: done, shipments: bulkEligible.length } : null);
    loadSaved();
    onSaved();
    setSaving(false);
  }

  async function skipVisible() {
    const ok = await confirm({
      title: t(`${visible.length} gönderi listeden çıkarılsın mı?`, `Remove ${visible.length} shipments from the list?`),
      message: t("Hiçbir şey kaydedilmez. Bu gönderileri tekrar görmek için belgeyi yeniden yüklemen gerekir.", "Nothing is saved. To see these shipments again you need to upload the document again."),
      confirmLabel: t("Listeden çıkar", "Remove from list"),
    });
    if (!ok) return;
    const ids = new Set(visible.flat().map((r) => r.id));
    setReviews((list) => list.filter((x) => !ids.has(x.id)));
  }

  // Toplu onayı geri alır: eklenen kalemler silinir, gönderiler onay listesine geri döner.
  async function undoBatch() {
    if (!batch) return;
    setSaving(true);
    try {
      await api.finance.invoices.removeMany(shopId, batch.ids);
      setReviews((list) => [...batch.reviews, ...list]);
      setBatch(null);
      loadSaved();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Geri alınamadı", "Could not undo"));
    }
    setSaving(false);
  }

  // Yükleme özeti: kaç gönderi/kalem, kaçı zaten kayıtlı, kaçı kesin ya da şüpheli.
  const lineCount = reviews.length;
  const savedLines = reviews.filter((r) => r.candidate.already_saved).length;
  const weakGroups = groups.filter((g) => openLines(g).length > 0 && g[0].candidate.matches.length > 0 && scoreOf(g) < 0.6).length;
  const noMatchGroups = groups.filter((g) => openLines(g).length > 0 && g[0].candidate.matches.length === 0).length;

  async function remove(id: number) {
    await api.finance.invoices.remove(shopId, id);
    loadSaved();
    onSaved();
  }

  // Sipariş penceresinden gelindi: yalnızca o siparişin faturaları listelenir, süzgeçler temizlenir, gönderi vurgulanır (render sırasında, bir kez).
  const [seenFocus, setSeenFocus] = useState(0);
  if (focus && focus.receiptId !== seenFocus) {
    setSeenFocus(focus.receiptId);
    setReceiptFilter({ id: focus.receiptId, label: focus.label });
    setQ("");
    setKind("");
    setRange("all");
    setInvStart("");
    setInvEnd("");
    setPage(0);
    setHighlight(focus.receiptId);
  } else if (!focus && seenFocus) setSeenFocus(0);
  useEffect(() => {
    if (focus) onFocusUsed?.();
  }, [focus, onFocusUsed]);
  // Vurgulanan gönderi listeye gelince görünür alana kaydırılır (satır zaten açık çizilir); birkaç saniye sonra vurgu söner.
  useEffect(() => {
    if (highlight === null) return;
    const hit = list?.items.find((g) => g.receipt_id === highlight);
    if (!hit) return;
    document.getElementById(`ship-${shipKey(hit)}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(timer);
  }, [highlight, list]);

  // Belgeden okunan firmalar (büyük/küçük harf farkı yok sayılır), en çok geçen başta.
  const detectedVendors = (() => {
    const seen = new Map<string, { name: string; n: number }>();
    for (const r of reviews) {
      const v = r.candidate.vendor.trim();
      if (!v) continue;
      const e = seen.get(v.toLowerCase());
      if (e) e.n++;
      else seen.set(v.toLowerCase(), { name: v, n: 1 });
    }
    return [...seen.values()].sort((a, b) => b.n - a.n).map((e) => e.name);
  })();
  // Yeni belge geldiğinde ortak firma boşsa en çok okunan firma seçilir; sonra firması boş olan her gönderi ortak firmayı alır.
  useEffect(() => {
    const added = reviews.length > lastReviewCount.current;
    lastReviewCount.current = reviews.length;
    const v = docVendor || (added ? detectedVendors[0] : "") || "";
    if (v && v !== docVendor) setDocVendor(v);
    if (v && reviews.some((r) => !r.candidate.vendor.trim())) {
      setReviews((list) => list.map((r) => (r.candidate.vendor.trim() ? r : { ...r, candidate: { ...r.candidate, vendor: v } })));
    }
  }, [reviews, docVendor, detectedVendors]);
  const OTHER = "__other";
  const vendorOptions = [...detectedVendors, ...KNOWN_CARRIERS].filter((v, i, all) => all.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i); // büyük/küçük harf tekrarı yok, okunan ad önde
  // Ortak firma değişince: boş olanlar ve eski ortak firmayı taşıyanlar yenisini alır; elle farklı yazılanlara dokunulmaz.
  const changeDocVendor = (next: string) => {
    const prev = docVendor.trim().toLowerCase();
    setDocVendor(next);
    setReviews((list) => list.map((r) => {
      const cur = r.candidate.vendor.trim().toLowerCase();
      return !cur || cur === prev ? { ...r, candidate: { ...r.candidate, vendor: next } } : r;
    }));
  };

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
        <DocumentAnalyzer
          accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.html,.htm"
          hint={t("PDF, Excel, resim ya da HTML", "PDF, Excel, image or HTML")}
          onFile={readFile}
          onText={readText}
        />
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {notice && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span>✓ {notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label={t("Kapat", "Close")} className="shrink-0 text-emerald-700 hover:underline dark:text-emerald-400">
              {t("Kapat", "Close")}
            </button>
          </div>
        )}
      </section>

      {reviews.length > 0 && (
        <section className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              {t("Onay bekleyenler", "Waiting for confirmation")} ({groups.length} {t("gönderi", "shipments")})
            </h2>
          </div>
          <p className="mb-3 text-xs text-neutral-500">
            {t(`${lineCount} kalem`, `${lineCount} lines`)}
            {savedLines > 0 && ` · ${t(`${savedLines} tanesi zaten kayıtlı (eklenmez)`, `${savedLines} already saved (not added)`)}`}
            {counts.sure > 0 && ` · ${t(`${counts.sure} kesin`, `${counts.sure} sure`)}`}
            {weakGroups > 0 && <b className="text-red-600 dark:text-red-400">{` · ${t(`${weakGroups} zayıf eşleşme`, `${weakGroups} weak matches`)}`}</b>}
            {noMatchGroups > 0 && ` · ${t(`${noMatchGroups} eşleşmeyen`, `${noMatchGroups} unmatched`)}`}
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("Kargo firması", "Carrier")}
              <select
                value={docVendor && vendorOptions.includes(docVendor) ? docVendor : otherMode || docVendor ? OTHER : ""}
                onChange={(e) => {
                  if (e.target.value === OTHER) {
                    setOtherMode(true);
                    return;
                  }
                  setOtherMode(false);
                  changeDocVendor(e.target.value);
                }}
                className={`${filterCtl} w-44`}
              >
                <option value="">{t("— Seç —", "— Pick —")}</option>
                {vendorOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                <option value={OTHER}>{t("Başka…", "Other…")}</option>
              </select>
              {(otherMode || (docVendor && !vendorOptions.includes(docVendor))) && (
                <input value={docVendor} onChange={(e) => changeDocVendor(e.target.value)} maxLength={120} autoFocus={otherMode} placeholder={t("Firma adı yaz", "Type the carrier")} className={`${filterCtl} w-40`} />
              )}
              {docVendor && <VendorBadge name={docVendor} />}
              <HelpTip>
                {t(
                  "Belgeden okunan firma otomatik gelir (birden çoksa en çok geçeni). Firması boş kalan tüm gönderilere bu firma yazılır; değiştirirseniz hepsi güncellenir. Bir gönderiyi kendi kartından ayrıca değiştirebilirsiniz. Firma yalnızca listede ayırt etmek içindir, eşleşmeyi ve maliyeti etkilemez.",
                  "The carrier read from the document is filled in automatically (the most frequent one if there are several). It is written to every shipment that has none; change it and they all update. You can still change a single shipment on its own card. The carrier only tells shipments apart in the list; it does not affect matching or cost.",
                )}
              </HelpTip>
            </label>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(
              [
                ["all", t("Tümü", "All")],
                ["sure", t("Kesin", "Sure")],
                ["check", t("Kontrol et", "Check")],
                ["weak", t("Zayıf", "Weak")],
                ["nomatch", t("Eşleşmeyen", "Unmatched")],
              ] as [ReviewFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  filter === key
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {label} ({counts[key]})
              </button>
            ))}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving || bulkEligible.length === 0}
                onClick={() => void confirmVisible()}
                title={t("Görünen gönderilerden kesin ve “kontrol et” olanları onaylar; zayıf, eşleşmeyen ve mükerrer uyarılılar dahil değildir", "Confirms the visible shipments that are sure or “check”; weak, unmatched and possible duplicates are not included")}
                className="rounded-full bg-[#D97757] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#C6613F] disabled:opacity-40"
              >
                {t("Görünenleri onayla", "Confirm visible")} ({bulkEligible.length})
              </button>
              <button type="button" disabled={saving || visible.length === 0} onClick={() => void skipVisible()} className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                {t("Görünenleri atla", "Skip visible")} ({visible.length})
              </button>
            </span>
          </div>
          {visible.length > 0 && (
            <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-300">
              {t(
                `Toplam ${money2.format(bulkTotal)} kargo maliyeti eşleşen siparişlere yazılır.`,
                `A total of ${money2.format(bulkTotal)} shipping cost is written to the matched orders.`,
              )}
              {visible.length > bulkEligible.length && (
                <b className="text-amber-700 dark:text-amber-400">
                  {" "}
                  {t(
                    `${visible.length - bulkEligible.length} gönderi (zayıf/eşleşmeyen/mükerrer uyarılı) dahil değil, onlara tek tek bakmalısın.`,
                    `${visible.length - bulkEligible.length} shipments (weak, unmatched or possible duplicates) are not included; review them one by one.`,
                  )}
                </b>
              )}{" "}
              {t("Yanlış olursa “Geri al” ile kaldırabilirsin.", "If something is wrong you can remove it with “Undo”.")}
            </p>
          )}
          {batch && (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <span>✓ {t(`${batch.shipments} gönderi (${batch.reviews.length} kalem) kaydedildi.`, `${batch.shipments} shipments (${batch.reviews.length} lines) saved.`)}</span>
              <span className="flex shrink-0 gap-3">
                <button type="button" disabled={saving} onClick={() => void undoBatch()} className="font-semibold underline disabled:opacity-40">
                  {t("Geri al", "Undo")}
                </button>
                <button type="button" onClick={() => setBatch(null)} className="hover:underline">
                  {t("Kapat", "Close")}
                </button>
              </span>
            </div>
          )}
          {visible.length === 0 && <p className="text-sm text-neutral-400">{t("Bu süzgeçte gönderi yok.", "No shipments in this filter.")}</p>}
          <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {visible.map((g) => {
              const ids = new Set(g.map((r) => r.id));
              return (
                <InvoiceReviewGroup
                  key={g[0].id}
                  lines={g}
                  money2={money2}
                  saving={saving}
                  duplicateOf={duplicateOf}
                  onOrder={(receiptId) => setReviews((list) => list.map((x) => (ids.has(x.id) ? { ...x, receiptId } : x)))}
                  onVendor={(vendor) => setReviews((list) => list.map((x) => (ids.has(x.id) ? { ...x, candidate: { ...x.candidate, vendor } } : x)))}
                  onKind={(id, kind) => patch(id, { candidate: { ...(reviews.find((x) => x.id === id) as Review).candidate, kind } })}
                  onSkipLine={(id) => setReviews((list) => list.filter((x) => x.id !== id))}
                  onSkipAll={() => setReviews((list) => list.filter((x) => !ids.has(x.id)))}
                  onConfirm={() => void confirmGroup(g)}
                />
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
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          {receiptFilter && (
            <button
              type="button"
              onClick={() => setReceiptFilter(null)}
              title={t("Süzgeci kaldır", "Remove filter")}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 text-sm font-medium text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300"
            >
              {t("Sipariş", "Order")} #{receiptFilter.id}
              {receiptFilter.label && ` · ${receiptFilter.label}`}
              <span aria-hidden>✕</span>
            </button>
          )}
          <input value={q} onChange={(e) => onFilter(setQ)(e.target.value)} placeholder={t("Müşteri, takip no, ürün ara", "Search customer, tracking no., item")} className={`${filterCtl} w-56`} />
          <select value={kind} onChange={(e) => onFilter(setKind)(e.target.value)} className={filterCtl}>
            <option value="">{t("Tüm türler", "All types")}</option>
            <option value="nakliye">{t("Nakliye", "Freight")}</option>
            <option value="gümrük">{t("Gümrük", "Customs")}</option>
            <option value="ek hizmet">{t("Ek hizmet", "Extra service")}</option>
            <option value="diğer">{t("Diğer", "Other")}</option>
          </select>
          <DateRangePicker
            label={t("Fatura tarihi aralığı", "Invoice date range")}
            value={range}
            custom={invStart && invEnd ? { start: invStart, end: invEnd } : null}
            options={[{ id: "all", label: t("Fatura tarihi: tümü", "Invoice date: all"), range: null }, ...presetOptions(["7d", "30d", "90d", "month", "last_month", "ytd"], t)]}
            onChange={(id, r) => {
              setRange(id);
              setInvStart(r?.start ?? "");
              setInvEnd(r?.end ?? "");
              setPage(0);
            }}
          />
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setKind("");
                setReceiptFilter(null);
                setRange("all");
                setInvStart("");
                setInvEnd("");
                setPage(0);
              }}
              className="text-neutral-500 underline"
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
            <span className="ml-auto text-neutral-600 dark:text-neutral-300">
              {t("Seçilenlerin toplamı", "Selected total")}:{" "}
              <b className="tabular-nums text-neutral-900 dark:text-neutral-100">{money2.format(selectedShipments.reduce((sum, g) => sum + g.total, 0))}</b>
            </span>
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
                  <SortTh label={t("Müşteri", "Customer")} id="buyer" sort={sort} desc={effDesc} onSort={onSort} className="py-2 pr-3" />
                  <SortTh label={t("Takip no", "Tracking no.")} id="tracking" sort={sort} desc={effDesc} onSort={onSort} className="py-2 pr-3" />
                  <SortTh label={t("Firma", "Carrier")} id="vendor" sort={sort} desc={effDesc} onSort={onSort} className="py-2 pr-3" />
                  <SortTh label={t("Ürün", "Item")} id="product" sort={sort} desc={effDesc} onSort={onSort} className="py-2 pr-3" />
                  <SortTh label={t("Sipariş tarihi", "Order date")} id="order_date" sort={sort} desc={effDesc} onSort={onSort} className="py-2 pr-3" />
                  <SortTh label={t("Son fatura", "Latest invoice")} id="inv_date" sort={sort} desc={effDesc} onSort={onSort} className="py-2 pr-3" />
                  <SortTh label={t("Kalem", "Lines")} id="lines" sort={sort} desc={effDesc} onSort={onSort} className="py-2 pr-3 text-right" />
                  <SortTh label={t("Toplam", "Total")} id="amount" sort={sort} desc={effDesc} onSort={onSort} className="py-2 pr-3 text-right" />
                  <SortTh label={"Kg"} id="weight" sort={sort} desc={effDesc} onSort={onSort} className="py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {saved.map((g, idx) => {
                  const key = shipKey(g);
                  const open = expanded.has(key) || (highlight !== null && g.receipt_id === highlight);
                  return (
                    <Fragment key={key}>
                      <tr id={`ship-${key}`} onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })} className={`cursor-pointer border-b border-neutral-100 hover:bg-neutral-200/60 dark:border-neutral-800 dark:hover:bg-neutral-800/70 ${highlight !== null && g.receipt_id === highlight ? "bg-orange-100 outline outline-2 -outline-offset-2 outline-[#D97757] dark:bg-orange-950/40" : idx % 2 === 0 ? "bg-white dark:bg-neutral-900" : "bg-neutral-100/70 dark:bg-neutral-800/40"}`}>
                        <td className="py-2 pr-1" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSel(key)} aria-label={t("Gönderiyi seç", "Select shipment")} className="h-4 w-4 accent-[#D97757]" />
                        </td>
                        <td className="py-2 text-xs text-neutral-400">{open ? "▼" : "▶"}</td>
                        <td className="py-2 pr-3 font-medium">{g.buyer || "—"}</td>
                        <td className="py-2 pr-3 text-xs text-neutral-500">{g.tracking_no || "—"}</td>
                        <td className="py-2 pr-3"><VendorBadge name={g.vendor} /></td>
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
                          <td colSpan={9} className="py-2 pr-3">
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
      {confirmElement}
    </div>
  );
}

/** Tıklanınca sıralayan sütun başlığı; aktif sütunda yön oku görünür. */
function SortTh({ label, id, sort, desc, onSort, className = "" }: { label: string; id: string; sort: string; desc: boolean; onSort: (id: string) => void; className?: string }) {
  const active = sort === id;
  return (
    <th className={`font-medium ${className}`} aria-sort={active ? (desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => onSort(id)} className={`inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100 ${active ? "text-neutral-900 dark:text-neutral-100" : ""}`}>
        {label}
        <span className={`text-[10px] ${active ? "" : "opacity-0"}`} aria-hidden>{desc ? "▼" : "▲"}</span>
      </button>
    </th>
  );
}

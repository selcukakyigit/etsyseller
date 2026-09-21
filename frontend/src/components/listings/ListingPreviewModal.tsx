"use client";

import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { api, WorkingCopy } from "@/lib/api";

type Loaded = { id: number; data: WorkingCopy; local: boolean } | { id: number; error: string };

const units: Record<string, string> = { mm: "mm", cm: "cm", m: "m", in: "in", inches: "in", ft: "ft" };
const madeBy: Record<string, string> = { i_did: "Yapan", someone_else: "Başka biri yaptı", collective: "Ortaklık/kolektif yaptı" };

function Check({ ok, label, hint }: { ok: boolean | "warn"; label: string; hint?: string }) {
  const color = ok === true ? "text-emerald-600" : ok === "warn" ? "text-amber-600" : "text-red-600";
  return (
    <div className="flex items-start gap-2 py-0.5 text-xs">
      <span className={`mt-px font-bold ${color}`}>{ok === true ? "✓" : ok === "warn" ? "!" : "✕"}</span>
      <span>
        {label}
        {hint && <span className="text-neutral-400"> — {hint}</span>}
      </span>
    </div>
  );
}

/** Etsy'deki gibi açılır/kapanır bölüm. */
function Accordion({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-neutral-200 py-3 dark:border-neutral-800">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left text-base font-medium text-neutral-900 dark:text-neutral-100" aria-expanded={open}>
        {title}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && <div className="pt-3">{children}</div>}
    </div>
  );
}

/** Listing'in alıcıya nasıl görüneceğinin önizlemesi (Etsy ürün sayfasına benzer) + yayın öncesi kontrol listesi.
 *  Yerel değişiklik varsa onu, yoksa Etsy'deki hâlini gösterir. Hiçbir şeyi değiştirmez, Etsy'ye istek atmaz. */
export default function ListingPreviewModal({ shopId, listingId, shopName, onClose }: { shopId: number; listingId: number; shopName?: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [active, setActive] = useState(0);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [moreDesc, setMoreDesc] = useState(false);
  const [moreMaterials, setMoreMaterials] = useState(false);
  const [fetchedName, setFetchedName] = useState("");

  // Mağaza adı verilmediyse (ör. asistan kartından açıldığında) yerel mağaza listesinden bul; Etsy'ye istek atmaz.
  useEffect(() => {
    if (shopName) return;
    let cancelled = false;
    api.shops
      .list()
      .then((list) => {
        const name = list.find((s) => s.id === shopId)?.shop_name;
        if (!cancelled && name) setFetchedName(name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [shopId, shopName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = await api.listings.getLocal(shopId, listingId);
        if (local.exists && local.data) {
          if (!cancelled) setLoaded({ id: listingId, data: local.data, local: true });
          return;
        }
        if (listingId < 0) throw new Error("Yeni listing bulunamadı.");
        const live = await api.listings.getEdit(shopId, listingId);
        if (!cancelled) setLoaded({ id: listingId, data: live as WorkingCopy, local: false });
      } catch (e) {
        if (!cancelled) setLoaded({ id: listingId, error: e instanceof Error ? e.message : "Önizleme yüklenemedi" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, listingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const view = loaded && loaded.id === listingId ? loaded : null;
  const data = view && "data" in view ? view.data : null;

  const info = useMemo(() => {
    if (!data) return null;
    const products = data.inventory.products.filter((p) => p.offerings.some((o) => o.is_enabled !== false));
    const currency = products[0]?.offerings[0]?.price.currency_code ?? "USD";
    const groups = new Map<number, { name: string; values: string[] }>();
    products.forEach((p) =>
      p.property_values.forEach((pv) => {
        const g = groups.get(pv.property_id) ?? { name: pv.property_name, values: [] };
        pv.values.forEach((v) => !g.values.includes(v) && g.values.push(v));
        groups.set(pv.property_id, g);
      }),
    );
    return { products, currency, groups: [...groups.entries()].map(([id, g]) => ({ id, ...g })) };
  }, [data]);

  const images = data ? [...data.images].sort((a, b) => a.rank - b.rank) : [];
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: info?.currency ?? "USD" }).format(n);

  // Seçilen seçeneklere uyan ürünlerin fiyatı; hepsi seçilmediyse Etsy gibi "$67.50+" gösterilir.
  const matching = info ? info.products.filter((p) => Object.entries(choice).every(([pid, val]) => !val || p.property_values.some((pv) => pv.property_id === Number(pid) && pv.values.includes(val)))) : [];
  const prices = matching.flatMap((p) => p.offerings.filter((o) => o.is_enabled !== false).map((o) => o.price.amount / o.price.divisor));
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  const allChosen = info ? info.groups.every((g) => choice[g.id]) : true;
  const priceText = min === null ? "—" : max !== min && !allChosen ? `${money(min)}+` : money(min);
  const stock = matching.reduce((n, p) => n + p.offerings.reduce((m, o) => m + (o.quantity ?? 0), 0), 0);

  const dims = data && (data.item_length || data.item_width || data.item_height) ? [data.item_length, data.item_width, data.item_height].filter(Boolean).join(" × ") + ` ${units[data.item_dimensions_unit ?? ""] ?? data.item_dimensions_unit ?? ""}` : null;
  const questions = data?.personalization?.questions ?? [];
  const maker = shopName || fetchedName || "mağaza";
  const next = (d: number) => setActive((i) => (images.length ? (i + d + images.length) % images.length : 0));
  const materialsText = data ? data.materials.join(", ") : "";
  const descLong = (data?.description.length ?? 0) > 420 || (data?.description.split("\n").length ?? 0) > 7;

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8" onMouseDown={onClose}>
      <div className="w-full max-w-6xl rounded-2xl bg-[#faf9f7] shadow-2xl dark:bg-neutral-950" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Önizleme</h2>
            {view && "data" in view && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${view.local ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
                {view.local ? "Yerel taslak (Etsy'ye gönderilmedi)" : "Etsy'deki hâli"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/listings/${listingId}/edit`} className="rounded-lg bg-[#F1641E] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#d9560f]">
              Düzenle
            </Link>
            <button type="button" onClick={onClose} aria-label="Kapat" className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800">
              ✕
            </button>
          </div>
        </div>

        {!view && <p className="p-8 text-center text-sm text-neutral-400">Yükleniyor…</p>}
        {view && "error" in view && <p className="p-8 text-center text-sm text-red-600">{view.error}</p>}

        {data && info && (
          <div className="grid items-start gap-8 p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {/* Galeri: solda dikey küçük resimler, ortada 1:1 kare içinde ortalanmış fotoğraf (açıklama uzayınca gerilmez) */}
            <div className="flex flex-col-reverse gap-3 md:flex-row md:items-start lg:sticky lg:top-4 lg:self-start">
              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] md:max-h-[34rem] md:flex-col md:overflow-y-auto md:overflow-x-visible [&::-webkit-scrollbar]:hidden">
                  {images.map((img, i) => (
                    <button key={img.listing_image_id} type="button" onClick={() => setActive(i)} className={`h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border-2 ${i === active ? "border-neutral-900 dark:border-neutral-100" : "border-transparent opacity-80 hover:opacity-100"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url_170x135 || img.url_570xN} alt={img.alt_text ?? ""} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <div className="relative aspect-square min-w-0 flex-1 self-start overflow-hidden rounded-2xl bg-neutral-200 dark:bg-neutral-900">
                {images[active] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={images[active].url_570xN || images[active].url_fullxfull} alt={images[active].alt_text ?? ""} className="absolute inset-0 h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-neutral-400">Fotoğraf yok</div>
                )}
                <span className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-800 shadow" aria-hidden>
                  ♡
                </span>
                {images.length > 1 && (
                  <>
                    <button type="button" onClick={() => next(-1)} aria-label="Önceki fotoğraf" className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-lg shadow hover:bg-neutral-100">
                      ‹
                    </button>
                    <button type="button" onClick={() => next(1)} aria-label="Sonraki fotoğraf" className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-lg shadow hover:bg-neutral-100">
                      ›
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Sağ sütun */}
            <div className="min-w-0">
              <div className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">{priceText}</div>
              <div className="mt-0.5 text-xs text-neutral-500">Yerel vergiler dahil (uygulanabilir yerlerde)</div>
              <h1 className="mt-3 text-base leading-snug text-neutral-800 dark:text-neutral-100">{data.title || "(başlık yok)"}</h1>
              <div className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                <b className="font-semibold underline">{maker}</b> <span className="text-amber-500">★★★★★</span>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-neutral-700 dark:text-neutral-200">
                {data.return_policy_id && (
                  <li className="flex gap-2">
                    <span className="text-emerald-700">✓</span>İade ve değişim kabul edilir
                  </li>
                )}
                <li className="flex gap-2">
                  <span className="text-emerald-700">✓</span>
                  {stock > 0 ? `Stokta ${stock} adet` : "Stokta yok"}
                </li>
              </ul>

              {info.groups.map((g) => (
                <div key={g.id} className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-neutral-800 dark:text-neutral-100">{g.name}</label>
                  <select
                    value={choice[g.id] ?? ""}
                    onChange={(e) => setChoice((c) => ({ ...c, [g.id]: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-400 bg-white px-3 py-3 text-sm text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                  >
                    <option value="">Bir seçenek belirle</option>
                    {g.values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {questions.map((q, i) => (
                <div key={i} className="mt-4">
                  <div className="mb-1 text-sm font-medium">
                    {q.question_text}
                    {q.required && <span className="text-red-600"> *</span>}
                  </div>
                  {q.instructions && <div className="mb-1 text-xs text-neutral-500">{q.instructions}</div>}
                  {q.question_type === "dropdown" ? (
                    <select disabled className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
                      <option>{q.options.map((o) => o.label).join(" · ") || "Bir seçenek belirle"}</option>
                    </select>
                  ) : q.question_type === "text_input" ? (
                    <div className="rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900">Yazı girişi{q.max_allowed_characters ? ` (en fazla ${q.max_allowed_characters} karakter)` : ""}</div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-3 text-sm text-neutral-400 dark:border-neutral-700">Dosya yükleme</div>
                  )}
                </div>
              ))}

              <button type="button" title="Önizlemede sepet çalışmaz" className="mt-5 w-full cursor-default rounded-full bg-[#222] px-4 py-3.5 text-sm font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                Sepete ekle
              </button>
              <div className="mt-3 text-center text-sm font-medium text-neutral-800 dark:text-neutral-200">
                <span className="text-red-600">♥</span> Koleksiyona ekle
              </div>

              <div className="mt-6">
                <Accordion title="Ürün detayları" defaultOpen>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Öne çıkanlar</div>
                  <ul className="mt-2 space-y-2 text-sm text-neutral-700 dark:text-neutral-200">
                    {data.who_made && (
                      <li className="flex gap-2">
                        <span aria-hidden>✋</span>
                        <span>
                          {madeBy[data.who_made] ?? data.who_made}
                          {data.who_made === "i_did" && (
                            <>
                              : <b>{maker}</b>
                            </>
                          )}
                        </span>
                      </li>
                    )}
                    {materialsText && (
                      <li className="flex gap-2">
                        <span aria-hidden>🏷</span>
                        <span className="min-w-0">
                          Malzemeler: {moreMaterials || materialsText.length <= 60 ? materialsText : `${materialsText.slice(0, 60)}…`}
                          {materialsText.length > 60 && (
                            <button type="button" onClick={() => setMoreMaterials((v) => !v)} className="ml-1 rounded-full bg-neutral-200 px-2 text-xs font-bold dark:bg-neutral-800" aria-label="Malzemelerin tamamını göster">
                              •••
                            </button>
                          )}
                        </span>
                      </li>
                    )}
                    {dims && (
                      <li className="flex gap-2">
                        <span aria-hidden>📐</span>
                        <span>Ölçüler: {dims}</span>
                      </li>
                    )}
                  </ul>
                  <div className="relative mt-4">
                    <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-700 dark:text-neutral-200 ${!moreDesc && descLong ? "max-h-40 overflow-hidden" : ""}`}>{data.description || "(açıklama yok)"}</p>
                    {!moreDesc && descLong && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#faf9f7] to-transparent dark:from-neutral-950" />}
                  </div>
                  {descLong && (
                    <div className="mt-3 text-center">
                      <button type="button" onClick={() => setMoreDesc((v) => !v)} className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100">
                        {moreDesc ? "Daha az göster" : "Bu ürün hakkında daha fazlasını öğren"}
                      </button>
                    </div>
                  )}
                </Accordion>
                <Accordion title="Kargo ve iade politikaları">
                  <ul className="space-y-2 text-sm text-neutral-700 dark:text-neutral-200">
                    <li className="flex gap-2">
                      <span aria-hidden>📦</span>
                      {data.shipping_profile_id ? "Kargo profili seçili" : <span className="text-amber-600">Kargo profili seçilmemiş</span>}
                    </li>
                    <li className="flex gap-2">
                      <span aria-hidden>↩️</span>
                      {data.return_policy_id ? "İade politikası seçili" : <span className="text-amber-600">İade politikası seçilmemiş</span>}
                    </li>
                  </ul>
                  <p className="mt-2 text-xs text-neutral-400">Tahmini teslimat, ücretsiz kargo ve iade süresi gibi ayrıntılar Etsy&apos;deki kargo profilinden ve iade politikasından gelir.</p>
                </Accordion>
              </div>
            </div>

            {/* Etiketler + kontrol listesi */}
            <div className="min-w-0 lg:col-span-2">
              {data.tags.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-neutral-500">Etiketler (alıcıya görünmez, aramada kullanılır)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((t) => (
                      <span key={t} className="rounded-full bg-neutral-200 px-2.5 py-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h3 className="mb-2 text-sm font-semibold">Yayın öncesi kontrol</h3>
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <Check ok={data.title.length >= 80 && data.title.length <= 140 ? true : data.title.length > 0 && data.title.length <= 140 ? "warn" : false} label={`Başlık ${data.title.length}/140 karakter`} hint={data.title.length < 80 ? "80–120 arası daha iyi" : undefined} />
                  <Check ok={data.tags.length === 13 ? true : data.tags.length > 0 ? "warn" : false} label={`${data.tags.length}/13 etiket`} hint={data.tags.length < 13 ? "13'ünü de kullan" : undefined} />
                  <Check ok={images.length >= 5 ? true : images.length > 0 ? "warn" : false} label={`${images.length} fotoğraf`} hint={images.length < 5 ? "en az 5 önerilir" : undefined} />
                  <Check ok={data.description.length >= 300 ? true : data.description.length > 0 ? "warn" : false} label={`Açıklama ${data.description.length} karakter`} />
                  <Check ok={!!data.taxonomy_id} label="Kategori" hint={data.taxonomy_id ? undefined : "seçilmemiş"} />
                  <Check ok={!!data.shipping_profile_id} label="Kargo profili" hint={data.shipping_profile_id ? undefined : "seçilmemiş"} />
                  <Check ok={min !== null && min > 0} label="Fiyat" />
                  <Check
                    ok={images.length > 0 && images.every((i) => !!i.alt_text) ? true : "warn"}
                    label={`Fotoğraf alt metinleri (${images.filter((i) => !!i.alt_text).length}/${images.length})`}
                    hint={images.every((i) => !!i.alt_text) ? undefined : "düzenleyicide yeni fotoğraflar için yapay zekâyla yazılabilir"}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

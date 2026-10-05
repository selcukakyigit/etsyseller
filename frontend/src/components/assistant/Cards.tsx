"use client";

import Link from "next/link";
import { useState } from "react";
import { ChatCard } from "@/lib/api";
import ListingPreviewModal from "@/components/listings/ListingPreviewModal";
import InvoiceReviewCard from "./InvoiceReviewCard";
import EtsyDataReviewCard from "./EtsyDataReviewCard";
import { useT } from "@/lib/i18n-client";
import EtsyLink from "@/components/ui/EtsyLink";

const box = "mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900";
const head = "border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100";

function currencyFormatter(locale: string) {
  return (cur: string, n: number, digits = 0) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: cur, maximumFractionDigits: digits }).format(n);
}

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const good = invert ? pct <= 0 : pct >= 0;
  return (
    <span className={`text-[11px] font-medium ${good ? "text-emerald-600" : "text-red-600"}`}>
      {pct >= 0 ? "▲" : "▼"} %{Math.abs(pct).toFixed(0)}
    </span>
  );
}

/** Asistanın araç sonuçlarını gösteren görsel kartlar. */
export default function Card({ card, shopId }: { card: ChatCard; shopId: number }) {
  const [preview, setPreview] = useState(false);
  const { t, lang, locale } = useT();
  const fmt = currencyFormatter(locale);
  const names = new Intl.DisplayNames([lang], { type: "region", fallback: "code" });
  if (card.type === "finance") {
    return (
      <div className={box}>
        <div className={head}>{card.title}</div>
        <div className="grid grid-cols-2 gap-px bg-neutral-100 dark:bg-neutral-800 sm:grid-cols-3">
          {card.kpis.map((k) => (
            <div key={k.label} className={`bg-white px-4 py-3 dark:bg-neutral-900 ${k.highlight ? "!bg-emerald-50 dark:!bg-emerald-950" : ""}`}>
              <div className="text-[11px] text-neutral-500">{k.label}</div>
              <div className="text-lg font-semibold">{k.count ? k.value : fmt(card.currency, k.value)}</div>
              <Delta cur={k.value} prev={k.prev} invert={k.invert} />
              <span className="ml-1 text-[10px] text-neutral-400">{t("geçen yıl", "last year")}</span>
            </div>
          ))}
        </div>
        {card.countries.length > 0 && (
          <div className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
            <b>{t("En çok satış:", "Top sales:")}</b> {card.countries.map((c) => `${names.of(c.iso) ?? c.iso} ${fmt(card.currency, c.sales)}`).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  if (card.type === "pnl") {
    const m = (n: number) => fmt(card.currency, n);
    return (
      <div className={box}>
        <div className={head}>{card.title}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="px-3 py-1.5 font-medium">{t("Ay", "Month")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("Satış", "Sales")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("Ücretler", "Fees")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("Reklam/diğer", "Ads/other")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("Maliyet", "Cost")}</th>
                <th className="px-3 py-1.5 text-right font-medium">{t("Net kâr", "Net profit")}</th>
              </tr>
            </thead>
            <tbody>
              {card.rows.map((r, i) => (
                <tr key={r.month} className={i % 2 ? "bg-neutral-50 dark:bg-neutral-800/40" : ""}>
                  <td className="px-3 py-1">{r.month}</td>
                  <td className="px-2 py-1 text-right">{m(r.sales)}</td>
                  <td className="px-2 py-1 text-right text-neutral-500">{m(r.fees)}</td>
                  <td className="px-2 py-1 text-right text-neutral-500">{m(r.overhead)}</td>
                  <td className="px-2 py-1 text-right text-neutral-500">{m(r.cogs)}</td>
                  <td className={`px-3 py-1 text-right font-semibold ${r.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{m(r.profit)}</td>
                </tr>
              ))}
              <tr className="border-t border-neutral-200 font-semibold dark:border-neutral-700">
                <td className="px-3 py-1.5">{t("Toplam", "Total")}</td>
                <td className="px-2 py-1.5 text-right">{m(card.totals.sales)}</td>
                <td className="px-2 py-1.5 text-right">{m(card.totals.fees)}</td>
                <td className="px-2 py-1.5 text-right">{m(card.totals.overhead)}</td>
                <td className="px-2 py-1.5 text-right">{m(card.totals.cogs)}</td>
                <td className={`px-3 py-1.5 text-right ${card.totals.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{m(card.totals.profit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (card.type === "products") {
    return (
      <div className={box}>
        <div className={head}>{card.title}</div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {card.rows.map((p) => (
            <div key={p.listing_id} className="flex items-center gap-3 px-4 py-2 text-xs">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt="" className="h-9 w-9 flex-shrink-0 rounded object-cover" />
              ) : (
                <div className="h-9 w-9 flex-shrink-0 rounded bg-neutral-100 dark:bg-neutral-800" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{p.title}</span>
                  <EtsyLink listingId={p.listing_id} />
                </div>
                <div className="text-neutral-500">{t(`${p.units} adet · satış`, `${p.units} units · sales`)} {fmt(card.currency, p.sales)}</div>
                {p.prev_units !== undefined && (
                  <div className="text-neutral-400">
                    {t(`geçen yıl aynı dönem: ${p.prev_units} adet`, `same period last year: ${p.prev_units} units`)} · {fmt(card.currency, p.prev_sales ?? 0)}
                  </div>
                )}
              </div>
              <div className={`text-right font-semibold ${p.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {fmt(card.currency, p.profit)}
                <div className="text-[11px] font-normal text-neutral-500">%{p.margin}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (card.type === "performance") {
    const s = card.sales;
    const pct = (a: number, b: number) => (b ? `${a >= b ? "▲" : "▼"} %${Math.abs(((a - b) / b) * 100).toFixed(0)}` : "—");
    const f = card.freshness;
    return (
      <div className={box}>
        <div className={head}>{card.title}</div>
        <div className="grid grid-cols-2 gap-px bg-neutral-100 dark:bg-neutral-800 sm:grid-cols-4">
          <div className="bg-white px-4 py-3 dark:bg-neutral-900">
            <div className="text-[11px] text-neutral-500">{t("Satış adedi", "Units sold")}</div>
            <div className="text-lg font-semibold">{s.units}</div>
            <div className={`text-[11px] ${s.units >= s.prev_units ? "text-emerald-600" : "text-red-600"}`}>{pct(s.units, s.prev_units)} <span className="text-neutral-400">{t("önceki", "previous")} {s.prev_units}</span></div>
          </div>
          <div className="bg-white px-4 py-3 dark:bg-neutral-900">
            <div className="text-[11px] text-neutral-500">{t("Ciro", "Revenue")}</div>
            <div className="text-lg font-semibold">{fmt("USD", s.revenue)}</div>
            <div className={`text-[11px] ${s.revenue >= s.prev_revenue ? "text-emerald-600" : "text-red-600"}`}>{pct(s.revenue, s.prev_revenue)}</div>
          </div>
          <div className="bg-white px-4 py-3 dark:bg-neutral-900">
            <div className="text-[11px] text-neutral-500">{t("Görüntülenme", "Views")}</div>
            <div className="text-lg font-semibold">{card.views_now.available ? card.views_now.views : "—"}</div>
            <div className="text-[11px] text-neutral-400">{card.views_now.available ? (card.views_now.partial ? t(`izleme ${card.views_now.tracking_started}'de başladı`, `tracking started ${card.views_now.tracking_started}`) : t("dönem içi artış", "increase in period")) : t("geçmiş yok", "no history")}</div>
          </div>
          <div className="bg-white px-4 py-3 dark:bg-neutral-900">
            <div className="text-[11px] text-neutral-500">{t("İçerik güncelliği", "Content freshness")}</div>
            <div className="text-lg font-semibold">{f.days_since_content_change !== undefined ? `${f.days_since_content_change} ${t("gün", "days")}` : f.unchanged_for_at_least_days ? `≥ ${f.unchanged_for_at_least_days} ${t("gün", "days")}` : t("bilinmiyor", "unknown")}</div>
            <div className="text-[11px] text-neutral-400">{f.etsy_last_modified_days !== null ? t(`Etsy son değişiklik: ${f.etsy_last_modified_days} gün`, `Last changed on Etsy: ${f.etsy_last_modified_days} days ago`) : ""}</div>
          </div>
        </div>
        <div className="border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-500 dark:border-neutral-800">
          {card.period.start} – {card.period.end} · {t("önceki", "previous")}: {card.previous_period.start} – {card.previous_period.end}
          {card.conversion_percent !== null && ` · ${t("dönüşüm", "conversion")} %${card.conversion_percent}`} ·{" "}
          {t(`toplam ${card.lifetime.views} görüntülenme, ${card.lifetime.favorites} favori`, `total ${card.lifetime.views} views, ${card.lifetime.favorites} favorites`)}
        </div>
      </div>
    );
  }

  if (card.type === "stale") {
    return (
      <div className={box}>
        <div className={head}>{card.title}</div>
        {card.rows.length === 0 ? (
          <p className="px-4 py-3 text-xs text-neutral-500">{t("Bu eşiği aşan listing yok.", "No listings above this threshold.")}</p>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {card.rows.map((r) => (
              <div key={r.listing_id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{r.title}</span>
                    <EtsyLink listingId={r.listing_id} />
                  </div>
                  <div className="text-neutral-500">
                    {t(`son 180 gün ${r.units_recent} adet · önceki 180 gün ${r.units_previous} adet · ${r.views} görüntülenme`, `last 180 days ${r.units_recent} units · previous 180 days ${r.units_previous} units · ${r.views} views`)}
                  </div>
                </div>
                <div className="whitespace-nowrap text-right font-semibold text-amber-600">
                  {r.exact ? "" : "≥ "}
                  {r.days} {t("gün", "days")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (card.type === "ad_report") {
    const m = card.metrics;
    return (
      <div className={box}>
        <div className={head}>{t("Reklam analizi", "Ad analysis")} · {card.title}</div>
        <div className="grid grid-cols-2 gap-px bg-neutral-100 dark:bg-neutral-800 sm:grid-cols-4">
          {[
            [t("Harcama", "Spend"), fmt("USD", card.spend, 2)],
            ["CTR", m.ctr_yuzde !== null ? `%${m.ctr_yuzde}` : "—"],
            [t("Tıklama başına", "Cost per click"), m.tiklama_basina_maliyet !== null ? fmt("USD", m.tiklama_basina_maliyet, 2) : "—"],
            ["ROAS", m.roas !== null ? String(m.roas) : "—"],
          ].map(([l, v]) => (
            <div key={l} className="bg-white px-4 py-3 dark:bg-neutral-900">
              <div className="text-[11px] text-neutral-500">{l}</div>
              <div className="text-lg font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1 border-t border-neutral-100 px-4 py-2 text-xs dark:border-neutral-800">
          <div className="text-neutral-500">
            {t(`${card.views} görüntülenme · ${card.clicks} tıklama · ${card.orders} sipariş · gelir`, `${card.views} views · ${card.clicks} clicks · ${card.orders} orders · revenue`)} {fmt("USD", card.revenue, 2)}
          </div>
          {card.close.length > 0 && (
            <div>
              <b className="text-red-600">{t("Kapatma adayı:", "Consider turning off:")}</b> {card.close.join(", ")} <span className="text-neutral-400">{t("(Etsy Ads panelinden elle)", "(manually in Etsy Ads)")}</span>
            </div>
          )}
          {card.good.length > 0 && (
            <div>
              <b className="text-emerald-600">{t("Koru:", "Keep:")}</b> {card.good.join(", ")}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (card.type === "movers") {
    return (
      <div className={box}>
        <div className={head}>{card.title}</div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {card.rows.map((p) => (
            <div key={p.listing_id} className="flex items-center gap-3 px-4 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{p.title}</span>
                  <EtsyLink listingId={p.listing_id} />
                </div>
                <div className="text-neutral-500">
                  {p.prev_units} → {p.units} {t("adet", "units")} · {fmt(card.currency, p.prev_sales)} → {fmt(card.currency, p.sales)}
                </div>
              </div>
              <div className={`whitespace-nowrap text-right font-semibold ${p.change >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {p.change >= 0 ? "+" : "−"}
                {fmt(card.currency, Math.abs(p.change))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (card.type === "orders") {
    return (
      <div className={box}>
        <div className={head}>{card.title}</div>
        {card.rows.length === 0 ? (
          <p className="px-4 py-3 text-xs text-neutral-500">{t("Kayıt yok.", "No records.")}</p>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {card.rows.map((o) => (
              <div key={o.receipt_id} className="px-4 py-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {o.buyer} <span className="font-normal text-neutral-400">{o.country && (names.of(o.country) ?? o.country)}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium">${o.total.toFixed(2)}</span>
                </div>
                <div className="text-neutral-500">
                  #{o.receipt_id} · {t("sipariş", "ordered")} {o.date}
                  {o.ship_by && ` · ${t("gönderim", "ship by")} ${o.ship_by}`}
                </div>
                {o.items.map((it, i) => (
                  <div key={i} className="truncate text-neutral-500">
                    {it}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (card.type === "status") {
    return (
      <div className={box}>
        <div className={head}>{card.title}</div>
        <div className="grid grid-cols-2 gap-px bg-neutral-100 dark:bg-neutral-800 sm:grid-cols-4">
          {card.rows.map((r) => (
            <div key={r.label} className="bg-white px-4 py-3 dark:bg-neutral-900">
              <div className="text-[11px] text-neutral-500">{r.label}</div>
              <div className="text-lg font-semibold">{r.value.toLocaleString(locale)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (card.type === "etsy_data_review") {
    return <EtsyDataReviewCard shopId={shopId} listingId={card.listing_id} data={card} />;
  }

  if (card.type === "invoice_review") {
    return <InvoiceReviewCard shopId={shopId} source={card.source} currency={card.currency} candidates={card.candidates} />;
  }

  if (card.type === "listing_draft") {
    return (
      <div className={`${box} border-emerald-300 dark:border-emerald-800`}>
        <div className="flex gap-3 p-3">
          {card.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.image} alt="" className="h-24 w-24 flex-shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs text-neutral-400 dark:bg-neutral-800">{t("resim yok", "no image")}</div>
          )}
          <div className="min-w-0 flex-1 text-xs">
            <div className="mb-0.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{t("YEREL TASLAK · Etsy'ye gönderilmedi", "LOCAL DRAFT · not sent to Etsy")}</div>
            <div className="text-sm font-semibold">{card.title}</div>
            <div className="mt-1 text-neutral-500">
              {card.price[0] === card.price[1] ? `$${card.price[0].toFixed(2)}` : `$${card.price[0].toFixed(2)} – $${card.price[1].toFixed(2)}`}
              {card.price_assumed && <span className="text-amber-600"> {t("(tahmini)", "(estimated)")}</span>} · {card.quantity} {t("adet", "in stock")}
              {card.quantity_assumed && <span className="text-amber-600"> {t("(tahmini)", "(estimated)")}</span>}
              {card.combos > 0 && ` · ${t(`${card.combos} seçenek kombinasyonu`, `${card.combos} variation combinations`)}`} ·{" "}
              {t(`${card.images} resim · ${card.tags.length} etiket`, `${card.images} images · ${card.tags.length} tags`)}
            </div>
            {card.tags.length > 0 && <div className="mt-1 line-clamp-2 text-neutral-400">{card.tags.join(", ")}</div>}
            {card.problems.length > 0 && <div className="mt-1 text-amber-600">{t("Yayın için eksik:", "Missing before publishing:")} {card.problems.join(" ")}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
          <button type="button" onClick={() => setPreview(true)} className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950">
            {t("Önizle", "Preview")}
          </button>
          <Link href={card.edit_url} className="rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C6613F]">
            {t("Düzenle ve yayınla →", "Edit and publish →")}
          </Link>
        </div>
        {preview && <ListingPreviewModal shopId={shopId} listingId={card.listing_id} onClose={() => setPreview(false)} />}
      </div>
    );
  }

  // listing_update
  return (
    <div className={`${box} border-emerald-300 dark:border-emerald-800`}>
      <div className="flex items-center justify-between gap-3 p-3 text-xs">
        <div className="min-w-0">
          <div className="mb-0.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {t("YEREL DEĞİŞİKLİK · Etsy'ye gönderilmedi", "LOCAL CHANGE · not sent to Etsy")}
          </div>
          <div className="truncate text-sm font-semibold">{card.title}</div>
          <div className="text-neutral-500">
            {t("Değişen:", "Changed:")}{" "}
            {card.changes.map((c) => ({ title: t("başlık", "title"), description: t("açıklama", "description"), tags: t("etiketler", "tags"), price: t("fiyat", "price") })[c] ?? c).join(", ")}
          </div>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <button type="button" onClick={() => setPreview(true)} className="rounded-lg border border-emerald-600 px-3 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950">
            {t("Önizle", "Preview")}
          </button>
          <Link href={card.edit_url} className="rounded-lg bg-[#D97757] px-3 py-1.5 font-semibold text-white hover:bg-[#C6613F]">
            {t("Aç ve yayınla →", "Open and publish →")}
          </Link>
        </div>
      </div>
      {preview && <ListingPreviewModal shopId={shopId} listingId={card.listing_id} onClose={() => setPreview(false)} />}
    </div>
  );
}

"use client";

import { useState } from "react";
import { countryName } from "@/lib/countries";
import type { DiscoverOverview } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { Card, compact } from "./Card";
import WorldMap from "./WorldMap";

type Mode = "search" | "customers";
type Row = { code: string; value: number; share: number; topTerm?: string | null };

/** Dünya haritası: "Aramalar" = etiketlerinin ölçülen pazarlardaki Google aramaları (Etsy satışı değil), "Müşterilerin" = mağazanın gerçek siparişlerinin gittiği ülkeler. */
export default function CountryPanel({ countries, customers, onPick }: { countries: DiscoverOverview["countries"]; customers: DiscoverOverview["customers"]; onPick: (term: string) => void }) {
  const { t, locale } = useT();
  const [chosen, setChosen] = useState<Mode | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const searchRows: Row[] = countries.rows.filter((r) => r.volume > 0).map((r) => ({ code: r.market, value: r.volume, share: r.share, topTerm: r.top_term }));
  const customerRows: Row[] = customers.rows.map((r) => ({ code: r.country, value: r.orders, share: r.share }));
  const mode: Mode = chosen ?? (searchRows.length === 0 && customerRows.length > 0 ? "customers" : "search");
  const rows = mode === "search" ? searchRows : customerRows;
  const values = Object.fromEntries(rows.map((r) => [r.code, r.value]));
  const unit = (n: number) => (mode === "search" ? t(`${compact(n, locale)} aylık arama`, `${compact(n, locale)} monthly searches`) : t(`${n.toLocaleString(locale)} sipariş`, `${n.toLocaleString(locale)} orders`));
  const describe = (code: string, value: number) => `${countryName(code, locale)}: ${unit(value)} · %${rows.find((r) => r.code === code)?.share ?? 0}`;
  const measured = countries.rows.map((r) => r.market).join(", ");

  const tab = (key: Mode, label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={mode === key}
      onClick={() => {
        setChosen(key);
        setActive(null);
      }}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
        mode === key ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Card
      title={t("Dünya haritası", "World map")}
      help={t(
        "Aramalar: etiketlerinin her pazardaki aylık Google aramalarının (İngilizce sorgular) toplamı. Etsy satışı ya da Etsy arama hacmi değildir. Yalnızca ölçülen pazarlar renklenir; renksiz ülke 'arama yok' demek değildir. Ölçüm haftalık güncellenir. Müşterilerin: mağazanın son bir yıldaki (iptaller hariç) siparişlerinin gittiği ülkeler.",
        "Searches: the total monthly Google searches (English queries) for your tags in each market. Not Etsy sales or Etsy search volume. Only measured markets are coloured; a grey country does not mean 'no searches'. Measured weekly. Your customers: the countries your orders over the last year (cancellations excluded) were shipped to.",
      )}
      action={
        <div role="group" aria-label={t("Harita görünümü", "Map view")} className="flex gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
          {tab("search", t("Aramalar", "Searches"))}
          {tab("customers", t("Müşterilerin", "Your customers"))}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <p className="mb-1 min-h-[1.25rem] text-xs font-medium text-[#B4553A] dark:text-[#E89A7F]" aria-live="polite">
            {active && values[active] ? describe(active, values[active]) : <span className="font-normal text-neutral-400 dark:text-neutral-500">{t("Bir ülkenin üstüne gel ya da dokun.", "Hover or tap a country.")}</span>}
          </p>
          <WorldMap values={values} active={active} onActive={setActive} describe={describe} label={mode === "search" ? t("Ülkelere göre Google aramaları", "Google searches by country") : t("Müşterilerin ülkeleri", "Your customers' countries")} />
          <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
            {mode === "search"
              ? !countries.enabled
                ? t("Ülke ölçümü kapalı: yalnızca ana pazar görünür.", "Country measurement is off: only the main market is shown.")
                : countries.preparing
                  ? t(`Diğer ülkeler hazırlanıyor, haftalık güncellenir. Şimdilik ölçülen: ${measured}.`, `Other countries are being prepared and update weekly. Measured so far: ${measured}.`)
                  : t(`Google · İngilizce aramalar · ölçülen pazarlar: ${measured}`, `Google · English queries · measured markets: ${measured}`)
              : t(`Son ${customers.days} gün · ${customers.orders.toLocaleString(locale)} sipariş · iptaller hariç`, `Last ${customers.days} days · ${customers.orders.toLocaleString(locale)} orders · cancellations excluded`)}
          </p>
        </div>

        <ul className="max-h-64 space-y-0.5 overflow-auto lg:max-h-[22rem]" aria-label={t("Ülke sıralaması", "Country ranking")}>
          {rows.length === 0 ? (
            <li className="py-4 text-xs text-neutral-400 dark:text-neutral-500">
              {mode === "search"
                ? t("Ülke verisi henüz hazır değil. Etiketlerin ölçülünce burada görünür.", "Country data is not ready yet. It appears once your tags are measured.")
                : t("Son bir yılda sipariş yok.", "No orders in the last year.")}
            </li>
          ) : (
            rows.slice(0, 12).map((r, i) => (
              <li
                key={r.code}
                onPointerEnter={() => setActive(r.code)}
                onPointerLeave={() => setActive(null)}
                className={`rounded-lg px-2 py-1.5 transition ${active === r.code ? "bg-[#D97757]/10" : ""}`}
              >
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="w-4 tabular-nums text-neutral-400 dark:text-neutral-500">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-neutral-800 dark:text-neutral-200">{countryName(r.code, locale)}</span>
                  <span className="tabular-nums text-neutral-500 dark:text-neutral-400">{mode === "search" ? compact(r.value, locale) : r.value.toLocaleString(locale)}</span>
                </div>
                <div className="ml-6 mt-1 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div className="h-full rounded-full bg-[#D97757]" style={{ width: `${Math.max(3, r.share)}%` }} />
                  </div>
                  {r.topTerm && (
                    <button type="button" onClick={() => onPick(r.topTerm as string)} title={t(`En çok aranan: ${r.topTerm}`, `Top search: ${r.topTerm}`)} className="max-w-[55%] truncate text-[11px] text-neutral-400 hover:text-[#B4553A] dark:text-neutral-500 dark:hover:text-[#E89A7F]">
                      {r.topTerm}
                    </button>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </Card>
  );
}

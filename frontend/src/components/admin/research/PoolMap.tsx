"use client";

import { useState } from "react";
import { Badge, Section, useFormat } from "@/components/admin/ui";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import WorldMap from "@/components/ui/WorldMap";
import { countryName } from "@/lib/countries";
import { useT } from "@/lib/i18n-client";
import { EMPTY_KEYWORD_FILTERS, KeywordFilters, PoolMapRegion, PoolMapRow, advancedFilterCount, researchAdmin } from "@/lib/researchApi";
import { useApiData } from "@/lib/useApiData";
import KeywordFilterBar from "./KeywordFilterBar";
import { fmtMoney } from "./shared";

type Metric = "volume" | "keywords" | "coverage" | "fresh" | "spend";

const freshPct = (r: PoolMapRow) => (r.keywords ? Math.round((r.fresh / r.keywords) * 100) : 0);
const metricValue = (r: PoolMapRow, m: Metric): number => (m === "volume" ? r.volume : m === "keywords" ? r.keywords : m === "coverage" ? r.coverage : m === "fresh" ? freshPct(r) : r.spend_month);

function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === key ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Seçilen pazarın ayrıntısı: özet sayılar ve süzgece uyan en çok aranan kelimeler. */
function MarketDetail({ row, filters }: { row: PoolMapRow; filters: KeywordFilters }) {
  const { t, locale } = useT();
  const f = useFormat();
  const top = useApiData(`admin:research:map:top:${row.market}:${JSON.stringify(filters)}`, () => researchAdmin.keywords(filters, { sort: "volume", page: 1, market: row.market }));
  const items = (top.data?.items ?? []).filter((k) => k.search_volume !== null).slice(0, 10);
  const stat = (label: string, value: string) => (
    <div>
      <dt className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</dd>
    </div>
  );
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {countryName(row.market, locale)} <span className="font-normal text-neutral-400 dark:text-neutral-500">({row.market})</span>
        </h3>
        {row.default && <Badge tone="good">{t("ana pazar", "main market")}</Badge>}
        {!row.configured && <Badge tone="muted">{t("haftalık ölçüme dahil değil", "not in the weekly measurement")}</Badge>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <dl className="grid grid-cols-2 gap-3 self-start">
          {stat(t("Ölçülen kelime", "Measured keywords"), f.num(row.keywords))}
          {stat(t("Hacmi gelen", "With volume"), f.num(row.with_volume))}
          {stat(t("Toplam aylık arama", "Total monthly searches"), f.num(row.volume))}
          {stat(t("Ortalama CPC", "Average CPC"), row.avg_cpc === null ? "—" : fmtMoney(row.avg_cpc, locale))}
          {stat(t("Güncel / eski", "Fresh / stale"), `${f.num(row.fresh)} / ${f.num(row.stale)}`)}
          {stat(t("Kapsam", "Coverage"), `%${row.coverage}`)}
          {stat(t("Son ölçüm", "Last measured"), f.date(row.last_measured))}
          {stat(t("Bu ay harcama", "Spend this month"), `${fmtMoney(row.spend_month, locale)} · ${f.num(row.calls_month)} ${t("çağrı", "calls")}`)}
        </dl>
        <div className="min-h-[10rem]">
          <h4 className="mb-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("En çok aranan kelimeler (süzgece uyanlar)", "Most searched keywords (matching the filters)")}</h4>
          {!top.data && !top.error ? (
            <BlockSpinner />
          ) : items.length === 0 ? (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">{t("Bu pazarda süzgece uyan ölçülmüş kelime yok.", "No measured keywords match the filters in this market.")}</p>
          ) : (
            <ul className="max-h-72 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {items.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{k.term}</span>
                  <span className="tabular-nums text-neutral-700 dark:text-neutral-300">{f.num(k.search_volume ?? 0)}</span>
                  <span className="w-14 text-right tabular-nums text-neutral-400 dark:text-neutral-500">{k.cpc === null ? "—" : fmtMoney(k.cpc, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Havuzun ülke haritası (Genel bakışın en üstü): pazar başına ölçülen kelime, toplam Google hacmi, tazelik, kapsam ve bu ayki harcama. Kelime süzgeci Keyword Explorer'daki ile aynıdır. */
export default function PoolMap() {
  const { t, locale } = useT();
  const f = useFormat();
  const [filters, setFilters] = useState<KeywordFilters>(EMPTY_KEYWORD_FILTERS);
  const [region, setRegion] = useState<PoolMapRegion>("");
  const [metric, setMetric] = useState<Metric>("volume");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error } = useApiData(`admin:research:map:${region}:${JSON.stringify(filters)}`, () => researchAdmin.map(filters, region));

  const rows = data?.rows ?? [];
  const values = Object.fromEntries(rows.map((r) => [r.market, metricValue(r, metric)]));
  const show = (n: number) => (metric === "spend" ? fmtMoney(n, locale) : metric === "coverage" || metric === "fresh" ? `%${n}` : f.num(n));
  const unit = metric === "volume" ? t("aylık arama", "monthly searches") : metric === "keywords" ? t("ölçülen kelime", "measured keywords") : metric === "coverage" ? t("kapsam", "coverage") : metric === "fresh" ? t("güncel", "fresh") : t("bu ay harcama", "spend this month");
  const describe = (code: string, value: number) => `${countryName(code, locale)} (${code}): ${show(value)} ${unit}`;
  const shown = hover ?? selected;
  const selectedRow = rows.find((r) => r.market === selected) ?? null;
  const activeFilters = [filters.q, filters.state, filters.status].filter(Boolean).length + advancedFilterCount(filters);
  const measuredMarkets = rows.filter((r) => r.keywords > 0).length;

  return (
    <Section
      title={t("Ülke haritası", "Country map")}
      action={
        <HelpTip align="right">
          {t(
            "Havuzdaki GÜNCEL ölçümlerin pazar (ülke) başına toplamı: kaç kelime ölçülmüş, toplam aylık Google araması (Etsy hacmi değil), tazelik, kapsam (süzgece uyan havuz kelimelerinin kaçı bu pazarda ölçülmüş) ve bu ayki sağlayıcı harcaması. Kelime süzgeci Keyword Explorer'dakiyle aynıdır; harcama süzgeçten etkilenmez. Haritada ülkeye tıklayınca ayrıntısı açılır. Ana pazar dışındaki pazarlar haftalık toplu işle ölçülür; hiç ölçülmemiş pazar gri kalır. Ham sayılar yalnızca yöneticiye görünür.",
            "The sum of the CURRENT measurements in the pool per market (country): how many keywords are measured, total monthly Google searches (not Etsy volume), freshness, coverage (how many of the matching pool keywords are measured in that market) and this month's provider spend. The keyword filter is the same as in Keyword Explorer; spend ignores it. Click a country on the map for details. Markets other than the main one are measured by a weekly bulk job; a market never measured stays grey. Raw numbers are visible to admins only.",
          )}
        </HelpTip>
      }
    >
      {filtersOpen && <KeywordFilterBar filters={filters} onChange={setFilters} forMap />}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((o) => !o)}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t("Kelime süzgeçleri", "Keyword filters")}
          {activeFilters > 0 && <span className="ml-1.5 rounded-full bg-[#D97757] px-1.5 py-0.5 text-[10px] text-white">{activeFilters}</span>}
        </button>
        <Chips
          label={t("Bölge", "Region")}
          value={region}
          onChange={setRegion}
          options={[
            ["", t("Dünya", "World")],
            ["english", t("İngilizce pazarlar", "English-speaking")],
            ["west", t("Batı Avrupa", "Western Europe")],
            ["eu", t("AB", "EU")],
            ["other", t("Diğer", "Other")],
          ]}
        />
        <Chips
          label={t("Haritayı boya", "Colour the map by")}
          value={metric}
          onChange={setMetric}
          options={[
            ["volume", t("Hacim", "Volume")],
            ["keywords", t("Kelime", "Keywords")],
            ["coverage", t("Kapsam", "Coverage")],
            ["fresh", t("Güncel %", "Fresh %")],
            ["spend", t("Harcama", "Spend")],
          ]}
        />
      </div>

      {error && !data ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !data ? (
        <div className="min-h-[16rem]">
          <BlockSpinner />
        </div>
      ) : (
        <>
          <p className="mb-1 min-h-[1.25rem] text-xs font-medium text-[#B4553A] dark:text-[#E89A7F]" aria-live="polite">
            {shown && values[shown] ? describe(shown, values[shown]) : <span className="font-normal text-neutral-400 dark:text-neutral-500">{t("Bir ülkenin üstüne gel; ayrıntı için tıkla.", "Hover a country; click for details.")}</span>}
          </p>
          <WorldMap values={values} active={shown} onActive={setHover} onSelect={(code) => setSelected((cur) => (cur === code ? null : code))} describe={describe} label={t("Havuzun ülke haritası", "Pool country map")} scale={metric === "volume" || metric === "keywords" || metric === "spend" ? "soft" : "sqrt"} />
          <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
            {t(
              `${f.num(data.terms)} kelime süzgece uyuyor · ${measuredMarkets} pazarda ölçüm var · Google, '${data.language}' dili · çok küçük ülkeler haritada görünmez, tabloda yer alır`,
              `${f.num(data.terms)} keywords match · measured in ${measuredMarkets} markets · Google, '${data.language}' language · very small countries are not drawn but appear in the table`,
            )}
          </p>

          <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("Pazar", "Market")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Kelime", "Keywords")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Aylık arama", "Monthly searches")}</th>
                  <th className="px-3 py-2 text-right font-medium">CPC</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Kapsam", "Coverage")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Güncel", "Fresh")}</th>
                  <th className="px-3 py-2 font-medium">{t("Son ölçüm", "Last measured")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Bu ay $", "This month $")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {rows.map((r) => (
                  <tr
                    key={r.market}
                    onClick={() => setSelected((cur) => (cur === r.market ? null : r.market))}
                    onPointerEnter={() => setHover(r.market)}
                    onPointerLeave={() => setHover(null)}
                    className={`cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${selected === r.market ? "bg-[#D97757]/10" : ""} ${r.keywords === 0 ? "text-neutral-400 dark:text-neutral-500" : "text-neutral-700 dark:text-neutral-300"}`}
                  >
                    <td className="px-3 py-1.5 font-medium">
                      {countryName(r.market, locale)} <span className="font-normal text-neutral-400 dark:text-neutral-500">{r.market}</span>
                      {r.default && <span className="ml-1.5 text-[10px] text-[#B4553A] dark:text-[#E89A7F]">{t("ana", "main")}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.keywords ? f.num(r.keywords) : t("ölçülmedi", "not measured")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.keywords ? f.num(r.volume) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.avg_cpc === null ? "—" : fmtMoney(r.avg_cpc, locale)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.keywords ? `%${r.coverage}` : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.keywords ? `%${freshPct(r)}` : "—"}</td>
                    <td className="px-3 py-1.5">{f.date(r.last_measured)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.spend_month ? fmtMoney(r.spend_month, locale) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedRow && <MarketDetail key={selectedRow.market} row={selectedRow} filters={filters} />}
        </>
      )}
    </Section>
  );
}

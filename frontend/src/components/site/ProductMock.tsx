import { Lang } from "@/lib/i18n";

const T = {
  en: {
    month: "This month",
    profit: "Net profit",
    sales: "Sales",
    fees: "Etsy fees",
    costs: "Product costs",
    orders: "Recent orders",
    health: "Needs attention",
    healthRow: "Gets views, but few favorites",
    healthHint: "The first photo may not stand out in search.",
    draft: "Draft ready",
    publish: "Publish",
    item: ["Custom name necklace", "Linen tote bag", "Birth flower print"],
  },
  tr: {
    month: "Bu ay",
    profit: "Net kâr",
    sales: "Satış",
    fees: "Etsy ücretleri",
    costs: "Ürün maliyeti",
    orders: "Son siparişler",
    health: "İlgilenmeli",
    healthRow: "Görüntülenme var, favori az",
    healthHint: "İlk fotoğraf aramada öne çıkmıyor olabilir.",
    draft: "Taslak hazır",
    publish: "Yayınla",
    item: ["İsimli kolye", "Keten çanta", "Doğum çiçeği baskı"],
  },
};

const BARS = [38, 52, 44, 61, 49, 70, 58, 66, 74, 62, 81, 77];

/** Gerçek ekrana benzeyen, sahte veriyle çizilmiş küçük bir panel. Ekran görüntüsü yerine HTML: keskin ve temaya uyumlu. */
export default function ProductMock({ lang }: { lang: Lang }) {
  const t = T[lang];
  const rows = [
    { name: t.item[0], profit: "+ $18.40", pct: "41%" },
    { name: t.item[1], profit: "+ $9.75", pct: "33%" },
    { name: t.item[2], profit: "+ $6.20", pct: "28%" },
  ];
  return (
    <div
      aria-hidden
      className="w-full max-w-[520px] select-none rounded-2xl border border-black/10 bg-white p-5 shadow-[0_30px_60px_-30px_rgba(31,27,22,0.35)] dark:border-white/10 dark:bg-[#171513]"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t.month}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">$2,418.60</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t.profit}</p>
        </div>
        <svg viewBox="0 0 120 44" className="h-11 w-28" role="presentation">
          {BARS.map((h, i) => (
            <rect key={i} x={i * 10} y={44 - h * 0.5} width="6" height={h * 0.5} rx="1.5" className={i === BARS.length - 1 ? "fill-[#D97757]" : "fill-neutral-200 dark:fill-neutral-700"} />
          ))}
        </svg>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-black/5 pt-4 text-xs dark:border-white/10">
        {[
          [t.sales, "$6,940"],
          [t.fees, "− $1,128"],
          [t.costs, "− $3,393"],
        ].map(([k, v]) => (
          <div key={k}>
            <p className="text-neutral-500 dark:text-neutral-400">{k}</p>
            <p className="mt-0.5 font-medium text-neutral-900 dark:text-neutral-100">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-black/5 pt-4 dark:border-white/10">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t.orders}</p>
        <ul className="mt-2 divide-y divide-black/5 text-sm dark:divide-white/10">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center justify-between py-2">
              <span className="text-neutral-800 dark:text-neutral-200">{r.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-neutral-400">{r.pct}</span>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">{r.profit}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-xl bg-[#FBF1EA] p-3.5 dark:bg-[#2A1D15]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#A9502F] dark:text-[#F48771]">{t.health}</p>
            <p className="mt-0.5 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{t.healthRow}</p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{t.healthHint}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs text-neutral-500 sm:inline dark:text-neutral-400">{t.draft}</span>
            <span className="rounded-full bg-[#1F1B16] px-3 py-1.5 text-xs font-medium text-white dark:bg-[#F3EFE9] dark:text-[#1F1B16]">{t.publish}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

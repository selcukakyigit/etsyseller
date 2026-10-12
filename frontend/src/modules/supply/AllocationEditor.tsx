"use client";

import { useEffect, useState } from "react";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import EstimateSettings from "./EstimateSettings";
import TargetsTable, { Draft } from "./TargetsTable";
import { productName, useShopChoice } from "../components/ProductPicker";
import { materialLabel } from "../core/materials";
import { btnDark, btnLink, btnOutline, card, h2, input, muted, rowBorder, warnBox } from "../core/ui";
import { money, qty as fmtQty } from "../core/units";
import { ProductMeasureRow } from "../core/api";
import { JobDetail, MeasureCheck, PlanPreview, PlanTarget, SplitMode, Suggestion, supplyApi } from "./api";
import { errMsg } from "../core/errors";

/** Yeni dağıtımın varsayılan türü: lazer süresi + malzeme tahmini. */
const DEFAULT_MODE: SplitMode = "estimated";

const MODES: { id: SplitMode; tr: string; en: string; hintTr: string; hintEn: string }[] = [
  { id: "price", tr: "Satış fiyatı payına göre", en: "By sale price share", hintTr: "Pay, ürünlerin satış fiyatı oranındadır.", hintEn: "Each share follows the product's sale price." },
  { id: "qty", tr: "Adede göre", en: "By quantity", hintTr: "Tutar, ürünlere adet oranında bölünür.", hintEn: "The amount is split by quantity." },
  { id: "manual", tr: "Elle tutar", en: "Manual amounts", hintTr: "Her ürünün tutarını kendin yazarsın; toplam işin tutarına eşit olmalı.", hintEn: "You enter each product's amount; they must add up to the job amount." },
  { id: "cut_length", tr: "Kesim uzunluğuna göre", en: "By cut length", hintTr: "Pay, ürünün (adet × kesim uzunluğu) oranındadır; malzeme farkına bakmaz. Tek malzemeli plakada yeter.", hintEn: "Each share follows (quantity × cut length); material differences are ignored. Fine for a single-material sheet." },
  { id: "pierce_count", tr: "Delme sayısına göre", en: "By pierce count", hintTr: "Pay, ürünün (adet × delme sayısı) oranındadır.", hintEn: "Each share follows (quantity × pierce count)." },
  {
    id: "paint_area",
    tr: "Boyanan alana göre",
    en: "By painted area",
    hintTr: "Pay, ürünün (adet × yüzey alanı × boyalı yüz sayısı) oranındadır. Yüzey alanı DXF'ten gelir; çift taraf boyanıyorsa ürün tanımında yüz sayısı 2 olmalı. Boya, baskı gibi yüzey işleri için.",
    hintEn: "Each share follows (quantity × surface area × painted sides). The surface comes from the DXF; set the sides to 2 in the product definition when both faces are painted. For surface work such as painting or printing.",
  },
  {
    id: "paint_rate",
    tr: "Boya m² fiyatına göre",
    en: "By paint price per m²",
    hintTr: "Her ürünün payı = adet × yüzey alanı × boyalı yüz sayısı × boya türünün m² fiyatı (boyacının fiyat listesinden). Boya türünü her ürün için bir kez seçersin, sonraki işlerde kendiliğinden gelir. Tutar daha fazlasını kapsıyorsa kalan dağıtılmaz.",
    hintEn: "Each product's share = quantity × surface area × painted sides × the paint type's price per m² (from the painter's price list). Pick the paint type once per product; it is filled in on later jobs. If the amount covers more, the rest is not allocated.",
  },
  {
    id: "estimated",
    tr: "Tahmini maliyete göre",
    en: "By estimated cost",
    hintTr: "Her ürünün tahmini maliyeti = lazer süresindeki kesim payı + malzeme (ebat × fiyat listesi). Gerçek tutar bu tahminlerin oranında bölünür; plakanın seçilmeyen kısmı dağıtılmaz. Karışık malzemeli plakada en doğrusu.",
    hintEn: "Each product's estimated cost = its cut share of the laser time + material (size × price list). The actual amount is split in proportion; the rest of the sheet is not allocated. Best for mixed-material sheets.",
  },
];

/** Ölçüye göre paylaştırma: ürünlerin ölçüsü "Ürünler" sekmesinden gelir. */
const MEASURE_MODES: SplitMode[] = ["cut_length", "pierce_count", "paint_area"];

/** Hedefi yalnızca ürün olabilen türler (genel gider ölçüsüzdür, bu türlerde seçilemez). */
const PRODUCT_ONLY: SplitMode[] = [...MEASURE_MODES, "paint_rate", "estimated"];

/** İşin maliyeti nereye yazılacak: ürünlere (birim maliyet olarak uygulanabilir) ya da genel gidere (Finans'ta gider).
 * Yalnızca çalışma alanı üyesi görür; tedarikçi bu bilgiye hiç erişemez. */
export default function AllocationEditor({ entityId, job, onJob }: { entityId: number; job: JobDetail; onJob: (j: JobDetail) => void }) {
  const { t, locale } = useT();
  const confirmed = job.status === "confirmed";
  const { shops, shopId: activeShop } = useShopChoice(supplyApi, entityId);
  const [mode, setMode] = useState<SplitMode>(job.plan?.mode ?? DEFAULT_MODE);
  const [targets, setTargets] = useState<Draft[]>(() => (job.plan?.targets ?? []).map(toDraft));
  const { data: suggested } = useApiData(`supply-suggest:${entityId}:${job.id}:${job.document_id ?? 0}`, () =>
    job.document_id && !confirmed ? supplyApi.jobs.suggestions(entityId, job.id) : Promise.resolve({ items: [] as Suggestion[] }),
  );
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (confirmed) return;
    supplyApi.jobs.plan(entityId, job.id).then(setPreview).catch(() => setPreview(null));
  }, [entityId, job.id, job.basis, job.plan, confirmed]);

  const saved = JSON.stringify({ mode: job.plan?.mode ?? DEFAULT_MODE, targets: (job.plan?.targets ?? []).map(toDraft) });
  const dirty = JSON.stringify({ mode, targets }) !== saved;

  async function save() {
    setBusy(true);
    try {
      const p = await supplyApi.jobs.setPlan(entityId, job.id, mode, targets.map(({ shop_id, listing_id, variant, qty, amount, item_id }) => ({ shop_id, listing_id, variant, qty, amount: mode === "manual" ? amount ?? 0 : null, item_id: mode === "paint_rate" ? item_id : null })));
      setPreview(p);
      onJob(await supplyApi.jobs.get(entityId, job.id));
      if (p.error) toast.error(p.error);
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
    }
    setBusy(false);
  }

  function add(d: Draft) {
    if (targets.some((x) => x.shop_id === d.shop_id && x.listing_id === d.listing_id && x.variant === d.variant)) return;
    setTargets((ts) => [...ts, d]);
  }

  /** Tür değişince, yeni türde seçilemeyen genel gider hedefleri düşer. */
  function changeMode(next: SplitMode) {
    setMode(next);
    if (PRODUCT_ONLY.includes(next)) setTargets((ts) => ts.filter((x) => x.listing_id !== null));
  }


  if (confirmed) {
    return (
      <section className={card}>
        <h2 className={`${h2} mb-2`}>{t("Maliyet dağıtımı", "Cost split")}</h2>
        <Allocations entityId={entityId} job={job} onJob={onJob} />
      </section>
    );
  }

  return (
    <section className={card}>
      <h2 className={h2}>{t("Maliyet nereye yazılsın?", "Where should the cost go?")}</h2>
      <p className={`${muted} mb-3`}>
        {t(
          "Bir plakadan birden çok ürün çıkıyorsa hepsini seç. Ürüne düşen pay onaydan sonra ürünün birim maliyeti yapılabilir; genel gider Finans'taki giderlere girer.",
          "If several products come out of one sheet, pick them all. After confirming, a product's share can be set as its unit cost; overhead goes into Finance expenses.",
        )}
      </p>
      {!shops ? (
        <BlockSpinner />
      ) : shops.length === 0 ? (
        <p className={warnBox}>{t("Dağıtım için bağlı bir mağaza gerekiyor.", "A connected shop is needed to split costs.")}</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={mode} onChange={(e) => changeMode(e.target.value as SplitMode)} className={input} aria-label={t("Bölüştürme", "Split")}>
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(m.tr, m.en)}
                </option>
              ))}
            </select>
          </div>
          {mode === "estimated" && <EstimateSettings key={job.updated_at} entityId={entityId} job={job} onJob={onJob} />}
          <p className={`${muted} mb-3`}>{t(MODES.find((m) => m.id === mode)?.hintTr ?? "", MODES.find((m) => m.id === mode)?.hintEn ?? "")}</p>
          {targets.length > 0 && (
            <TargetsTable
              targets={targets}
              onChange={setTargets}
              mode={mode}
              shares={!dirty ? preview?.targets : undefined}
              currency={job.currency}
              paintItems={preview?.paint_items ?? null}
              shopNames={shops.length > 1 ? new Map(shops.map((x) => [x.id, x.name])) : null}
            />
          )}

          <RegisteredProducts entityId={entityId} taken={targets} onAdd={(rows) => rows.forEach((r) => add({ shop_id: r.shop_id, listing_id: r.listing_id, variant: r.variant, title: r.title, qty: 1, amount: null, item_id: null }))} />

          {(suggested?.items.length ?? 0) > 0 && (
            <SuggestionList
              items={suggested!.items}
              currency={job.currency}
              taken={targets}
              onAdd={(m) => add({ shop_id: m.shop_id, listing_id: m.listing_id, variant: m.variant, title: m.title, qty: 1, amount: null, item_id: null })}
            />
          )}

          <div className="flex flex-wrap items-start gap-2">
            {!PRODUCT_ONLY.includes(mode) && (
              <button type="button" onClick={() => activeShop && add({ shop_id: activeShop, listing_id: null, variant: "", title: "", qty: 1, amount: null, item_id: null })} className={btnOutline}>
                + {t("Genel gider", "Overhead")}
              </button>
            )}
            {dirty && (
              <button type="button" disabled={busy} onClick={() => void save()} className={btnDark}>
                {t("Dağıtımı kaydet", "Save split")}
              </button>
            )}
          </div>
          {!dirty && preview?.error && <p className={`${warnBox} mt-3`}>{preview.error}</p>}
          {!dirty && preview?.check && <MeasureCheckNote check={preview.check} partial={mode === "estimated"} />}
          {!dirty && preview && !preview.error && preview.targets.length > 0 && (
            <p className={`${muted} mt-3`}>
              {preview.unallocated && preview.unallocated < 0
                ? t(
                    `Hesaplanan paylar işin tutarından ${money(-preview.unallocated, job.currency, locale)} fazla (${money(preview.basis, job.currency, locale)}).`,
                    `The calculated shares exceed the job amount (${money(preview.basis, job.currency, locale)}) by ${money(-preview.unallocated, job.currency, locale)}.`,
                  )
                : preview.unallocated
                ? t(
                    `${money(preview.basis - preview.unallocated, job.currency, locale)} bu ürünlere dağıtılacak; seçilmeyen kısmına düşen ${money(preview.unallocated, job.currency, locale)} dağıtılmaz.`,
                    `${money(preview.basis - preview.unallocated, job.currency, locale)} will be split between these products; ${money(preview.unallocated, job.currency, locale)} for the rest is not allocated.`,
                  )
                : t(`Toplam ${money(preview.basis, job.currency, locale)} dağıtılacak.`, `${money(preview.basis, job.currency, locale)} will be split.`)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Belgedeki satır/notlarla uyuşan ürünler: öneridir, seçilmedikçe hedeflere eklenmez. */
function SuggestionList({ items, currency, taken, onAdd }: { items: Suggestion[]; currency: string; taken: Draft[]; onAdd: (m: Suggestion["matches"][number]) => void }) {
  const { t, locale } = useT();
  return (
    <div className="mb-3 rounded-lg border border-[#D97757]/30 bg-[#D97757]/5 p-3 dark:bg-[#D97757]/10">
      <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t("Belgeden öneriler", "Suggestions from the document")}</div>
      <p className={`${muted} mb-2`}>
        {t(
          "Belgedeki satır ve notlar, Ürünler sekmesindeki ürünlerle karşılaştırıldı (ebat ve ad). Seçmedikçe hiçbir şey eklenmez.",
          "The document's lines and notes were compared with the products in the Products tab (size and name). Nothing is added unless you pick it.",
        )}
      </p>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i}>
            <div className="text-xs text-neutral-600 dark:text-neutral-300">
              “{it.line}”{it.amount !== null && ` · ${money(it.amount, currency, locale)}`}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {it.matches.map((m) => {
                const done = taken.some((x) => x.shop_id === m.shop_id && x.listing_id === m.listing_id && x.variant === m.variant);
                return (
                  <button
                    key={`${m.shop_id}-${m.listing_id}-${m.variant}`}
                    type="button"
                    disabled={done}
                    onClick={() => onAdd(m)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-800 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <span className="truncate">{done ? "✓" : "+"} {productName(m.title, m.variant)}</span>
                    <span className="shrink-0 text-[10px] text-neutral-400">{m.reason === "size" ? t("ebat uyuşuyor", "size matches") : t("ad benziyor", "name similar")}</span>
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ürünler sekmesinde kayıtlı (çizimi yüklenmiş / ölçüsü girilmiş) ürünler: işi yapılmışlar doğrudan listelenir, tıklayınca hedefe
 * eklenir. Çok parçalı üründe parçalar tek satırda toplanır. */
function RegisteredProducts({ entityId, taken, onAdd }: { entityId: number; taken: Draft[]; onAdd: (rows: ProductMeasureRow[]) => void }) {
  const { t, locale } = useT();
  const { data } = useApiData(`supply-registered:${entityId}`, () => supplyApi.measures.list(entityId));
  if (!data) return <BlockSpinner />;
  const products = new Map<string, { row: ProductMeasureRow; parts: ProductMeasureRow[] }>();
  for (const r of data.items) {
    const key = `${r.shop_id}-${r.listing_id}-${r.variant}`;
    products.set(key, { row: r, parts: [...(products.get(key)?.parts ?? []), r] });
  }
  const free = [...products.entries()].filter(([, p]) => !taken.some((x) => x.shop_id === p.row.shop_id && x.listing_id === p.row.listing_id && x.variant === p.row.variant));
  if (free.length === 0) {
    return products.size === 0 ? (
      <p className={`${muted} mb-3`}>{t("Henüz ürün tanımlı değil: Ürünler sekmesinden plaka DXF'i yükleyip parçaları ürünlere ata.", "No products yet: upload the sheet DXF in the Products tab and assign its parts to products.")}</p>
    ) : null;
  }
  return (
    <div className="mb-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t("Çizimi yüklenmiş ürünler", "Products with a drawing")}</div>
        <button type="button" onClick={() => onAdd(free.map(([, p]) => p.row))} className={btnLink}>
          {t("Hepsini ekle", "Add all")}
        </button>
      </div>
      <ul className="max-h-64 divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800">
        {free.map(([key, p]) => {
          const cut = p.parts.reduce((sum, x) => sum + (x.values.cut_length ?? 0) * (x.values.part_qty ?? 1), 0);
          const materials = [...new Set(p.parts.map((x) => materialLabel(x.material, t)).filter(Boolean))].join(", ");
          return (
            <li key={key}>
              <button type="button" onClick={() => onAdd([p.row])} className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                <span className="text-neutral-400">+</span>
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200">{productName(p.row.title, p.row.variant)}</span>
                <span className="shrink-0 text-[11px] text-neutral-400">
                  {cut ? `${fmtQty(cut / 1000, locale)} m` : t("kesim uzunluğu yok", "no cut length")}
                  {p.parts.length > 1 ? ` · ${t(`${p.parts.length} parça`, `${p.parts.length} parts`)}` : p.row.values.width && p.row.values.height ? ` · ${fmtQty(p.row.values.width, locale)}×${fmtQty(p.row.values.height, locale)} mm` : ""}
                  {materials ? ` · ${materials}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Ürün ölçüleri toplamı belgedeki (makine raporu) toplamla karşılaştırılır; büyük fark = eksik/yanlış ürün ya da adet. */
function MeasureCheckNote({ check, partial }: { check: MeasureCheck; partial: boolean }) {
  const { t, locale } = useT();
  const cut = check.measure === "cut_length";
  const show = (v: number) => (cut ? `${fmtQty(v / 1000, locale)} m` : fmtQty(v, locale));
  const what = cut ? t("kesim uzunluğu", "cut length") : t("delme sayısı", "pierce count");
  const diff = `${check.diff_pct > 0 ? "+" : ""}${fmtQty(check.diff_pct, locale)}%`;
  // Tahmini dağıtımda plakanın bir kısmı başka mağaza/işe ait olabilir: ürünlerin toplamı belgeden küçükse sorun değil, büyükse hata.
  const off = partial ? check.diff_pct > 5 : Math.abs(check.diff_pct) > 5;
  return (
    <p className={off ? `${warnBox} mt-3` : `${muted} mt-3`}>
      {t(
        `Ürünlerin toplam ${what}: ${show(check.actual)}; belgedeki: ${show(check.expected)} (${diff}).`,
        `Products' total ${what}: ${show(check.actual)}; on the document: ${show(check.expected)} (${diff}).`,
      )}
      {off && " " + (partial ? t("Ürünler plakadan büyük: yanlış ürün ya da adet olabilir.", "Products exceed the plate: a product or quantity may be wrong.") : t("Fark büyük: eksik ya da yanlış ürün/adet olabilir.", "Large gap: a product or quantity may be missing or wrong."))}
      {partial && !off && check.diff_pct < -5 && " " + t("Plakanın kalanı bu ürünlere yüklenmez.", "The rest of the plate is not charged to these products.")}
    </p>
  );
}

function toDraft(p: PlanTarget): Draft {
  return { shop_id: p.shop_id, listing_id: p.listing_id, variant: p.variant ?? "", title: p.title, qty: p.qty, amount: p.amount, item_id: p.item_id ?? null };
}

function Allocations({ entityId, job, onJob }: { entityId: number; job: JobDetail; onJob: (j: JobDetail) => void }) {
  const { t, locale } = useT();
  const [busy, setBusy] = useState<number | null>(null);
  const list = job.allocations ?? [];
  if (list.length === 0) return <p className={muted}>{t("Dağıtım yok.", "No allocations.")}</p>;
  return (
    <ul>
      {list.map((a) => (
        <li key={a.id} className={`${rowBorder} flex flex-wrap items-center justify-between gap-2 py-2 last:border-0`}>
          <div className="min-w-0 text-sm">
            <div className="line-clamp-1 font-medium text-neutral-900 dark:text-neutral-100">{a.listing_id ? productName(a.title, a.variant) : t("Genel gider", "Overhead")}</div>
            <div className={muted}>
              {money(a.amount, job.currency, locale)}
              {a.report_ccy !== job.currency && ` ≈ ${money(a.amount_report, a.report_ccy, locale)}`}
              {a.listing_id && a.qty > 1 && ` · ${a.qty} ${t("adet", "units")} → ${money(a.amount_report / a.qty, a.report_ccy, locale)} / ${t("adet", "unit")}`}
              {!a.listing_id && ` · ${t("Finans giderlerinde", "in Finance expenses")}`}
            </div>
          </div>
          {a.listing_id &&
            (a.applied_at ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400">✓ {t("ürün maliyetine yazıldı", "set as product cost")}</span>
            ) : (
              <button
                type="button"
                disabled={busy === a.id}
                onClick={async () => {
                  setBusy(a.id);
                  try {
                    const r = await supplyApi.applyAllocation(entityId, a.id);
                    toast.success(t(`Birim maliyet ${money(r.unit_cost, r.currency, locale)} yapıldı`, `Unit cost set to ${money(r.unit_cost, r.currency, locale)}`));
                    onJob(await supplyApi.jobs.get(entityId, job.id));
                  } catch (e) {
                    toast.error(errMsg(e, t("İşlem başarısız", "Action failed")));
                  }
                  setBusy(null);
                }}
                className={btnLink}
              >
                {t("Ürünün birim maliyeti yap", "Set as product unit cost")}
              </button>
            ))}
        </li>
      ))}
    </ul>
  );
}

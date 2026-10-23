"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import EstimateSettings from "./EstimateSettings";
import TargetsTable, { Draft } from "./TargetsTable";
import PartySelect from "../components/PartySelect";
import SubTabs from "../components/SubTabs";
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
  const [picking, setPicking] = useState(false);
  const [remainderParty, setRemainderParty] = useState<number | null>(job.plan?.remainder_party_id ?? null);
  const { data: suggested } = useApiData(`supply-suggest:${entityId}:${job.id}:${job.documents.length}`, () =>
    job.documents.length > 0 && !confirmed ? supplyApi.jobs.suggestions(entityId, job.id) : Promise.resolve({ items: [] as Suggestion[] }),
  );
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (confirmed) return;
    supplyApi.jobs.plan(entityId, job.id).then(setPreview).catch(() => setPreview(null));
  }, [entityId, job.id, job.basis, job.plan, confirmed]);

  const saved = JSON.stringify({ mode: job.plan?.mode ?? DEFAULT_MODE, targets: (job.plan?.targets ?? []).map(toDraft), remainderParty: job.plan?.remainder_party_id ?? null });
  const dirty = JSON.stringify({ mode, targets, remainderParty }) !== saved;

  async function save() {
    setBusy(true);
    try {
      const p = await supplyApi.jobs.setPlan(
        entityId,
        job.id,
        mode,
        targets.map(({ shop_id, party_id, listing_id, variant, qty, amount, item_id }) => ({ shop_id, party_id, listing_id, variant, qty, amount: mode === "manual" ? amount ?? 0 : null, item_id: mode === "paint_rate" ? item_id : null })),
        PRODUCT_ONLY.includes(mode) ? remainderParty : null,
      );
      setPreview(p);
      onJob(await supplyApi.jobs.get(entityId, job.id));
      if (p.error) toast.error(p.error);
    } catch (e) {
      toast.error(errMsg(e, t("Kaydedilemedi", "Could not save")));
    }
    setBusy(false);
  }

  function add(d: Draft) {
    if (targets.some((x) => x.shop_id === d.shop_id && x.party_id === d.party_id && x.listing_id === d.listing_id && x.variant === d.variant)) return;
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
      <div className="mb-3 flex items-center gap-2">
        <h2 className={h2}>{t("Maliyet nereye yazılsın?", "Where should the cost go?")}</h2>
        <HelpTip>
          {t(
            "Bir plakadan birden çok ürün çıkıyorsa hepsini seç. Ürüne düşen pay onaydan sonra ürünün birim maliyeti yapılabilir; genel gider Finans'taki giderlere girer.",
            "If several products come out of one sheet, pick them all. After confirming, a product's share can be set as its unit cost; overhead goes into Finance expenses.",
          )}
        </HelpTip>
      </div>
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
            <HelpTip>{t(MODES.find((m) => m.id === mode)?.hintTr ?? "", MODES.find((m) => m.id === mode)?.hintEn ?? "")}</HelpTip>
          </div>
          {mode === "estimated" && <EstimateSettings key={job.updated_at} entityId={entityId} job={job} onJob={onJob} />}
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


          {(suggested?.items.length ?? 0) > 0 && (
            <SuggestionList
              items={suggested!.items}
              currency={job.currency}
              taken={targets}
              onAdd={(m) => add({ shop_id: m.shop_id, party_id: null, listing_id: m.listing_id, variant: m.variant, title: m.title, qty: 1, amount: null, item_id: null })}
            />
          )}

          <div className="flex flex-wrap items-start gap-2">
            <button type="button" onClick={() => setPicking(true)} className={btnOutline}>
              + {t("Ürün ekle", "Add products")}
            </button>
            {!PRODUCT_ONLY.includes(mode) && (
              <button type="button" onClick={() => activeShop && add({ shop_id: activeShop, party_id: null, listing_id: null, variant: "", title: "", qty: 1, amount: null, item_id: null })} className={btnOutline}>
                + {t("Genel gider", "Overhead")}
              </button>
            )}
            {!PRODUCT_ONLY.includes(mode) && (
              <PartySelect
                api={supplyApi}
                entityId={entityId}
                value={null}
                onChange={(p) => p && add({ shop_id: 0, party_id: p.id, listing_id: null, variant: "", title: p.name, qty: 1, amount: null, item_id: null })}
                placeholder={`+ ${t("Dış pay", "External share")}`}
                ariaLabel={t("Dış pay ekle", "Add external share")}
              />
            )}
            {dirty && (
              <button type="button" disabled={busy} onClick={() => void save()} className={btnDark}>
                {t("Dağıtımı kaydet", "Save split")}
              </button>
            )}
          </div>
          {PRODUCT_ONLY.includes(mode) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={muted}>{t("Dağıtılmayan kalan şuna yazılsın:", "Write the unallocated rest to:")}</span>
              <PartySelect
                api={supplyApi}
                entityId={entityId}
                value={remainderParty}
                onChange={(p) => setRemainderParty(p?.id ?? null)}
                placeholder={t("Hiçbiri (dağıtılmaz)", "None (not allocated)")}
                ariaLabel={t("Kalanın yazılacağı dış pay", "External share for the rest")}
              />
            </div>
          )}
          {!dirty && preview?.error && <p className={`${warnBox} mt-3`}>{preview.error}</p>}
          {!dirty && preview?.check && <MeasureCheckNote check={preview.check} partial={mode === "estimated"} />}
          {!dirty && preview && !preview.error && preview.plate_known === false && (
            <p className={`${warnBox} mt-3`}>
              {t(
                "Raporda plakanın toplam kesim uzunluğu yok: seçtiğin ürünler plakanın tamamı sayılıyor ve işin tutarının hepsi onlara bölünüyor. Plakada başka parça varsa raporu yükle.",
                "The report has no total cut length for the plate: the products you chose count as the whole plate and the entire job amount is split between them. If the plate has other parts, upload the report.",
              )}
            </p>
          )}
          {!dirty && preview && !preview.error && preview.laser_by && (
            <p className={`${muted} mt-3`}>
              {preview.laser_by === "time"
                ? t("Lazer payı makine süresine göre: kesim süresi kesim uzunluğuna, delme süresi delme sayısına bölünür.", "Laser share is by machine time: cutting time is split by cut length, piercing time by pierce count.")
                : t("Lazer payı yalnızca kesim uzunluğuna göre (raporda kesim ve delme süreleri ayrı yok).", "Laser share is by cut length only (the report has no separate cutting and piercing times).")}
            </p>
          )}
          {!dirty && preview && !preview.error && preview.targets.length > 0 && (
            <p className={`${muted} mt-3`}>
              {preview.unallocated && preview.unallocated < 0
                ? t(
                    `Hesaplanan paylar işin tutarından ${money(-preview.unallocated, job.currency, locale)} fazla (${money(preview.basis, job.currency, locale)}).`,
                    `The calculated shares exceed the job amount (${money(preview.basis, job.currency, locale)}) by ${money(-preview.unallocated, job.currency, locale)}.`,
                  )
                : preview.unallocated && preview.remainder
                ? t(
                    `${money(preview.basis - preview.unallocated, job.currency, locale)} bu ürünlere dağıtılacak; kalan ${money(preview.remainder.amount, job.currency, locale)} seçilen dış paya yazılacak (maliyete girmez).`,
                    `${money(preview.basis - preview.unallocated, job.currency, locale)} will be split between these products; the remaining ${money(preview.remainder.amount, job.currency, locale)} goes to the chosen external share (not booked as cost).`,
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
      {picking && (
        <Modal
          title={t("Çizimi yüklenmiş ürünler", "Products with a drawing")}
          widthClass="max-w-2xl"
          onClose={() => setPicking(false)}
          footer={
            <button type="button" onClick={() => setPicking(false)} className={btnLink}>
              {t("Kapat", "Close")}
            </button>
          }
        >
          <RegisteredProducts
            entityId={entityId}
            taken={targets}
            onAdd={(rows) => rows.forEach((r) => add({ shop_id: r.shop_id, party_id: null, listing_id: r.listing_id, variant: r.variant, title: r.title, qty: 1, amount: null, item_id: null }))}
            onRemove={(r) => setTargets((ts) => ts.filter((x) => !(x.shop_id === r.shop_id && x.listing_id === r.listing_id && x.variant === r.variant)))}
          />
        </Modal>
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
function RegisteredProducts({ entityId, taken, onAdd, onRemove }: { entityId: number; taken: Draft[]; onAdd: (rows: ProductMeasureRow[]) => void; onRemove: (row: ProductMeasureRow) => void }) {
  const { t, locale } = useT();
  const { data } = useApiData(`supply-registered:${entityId}`, () => supplyApi.measures.list(entityId));
  const [view, setView] = useState<"new" | "done">("new");
  if (!data) return <BlockSpinner />;
  const products = new Map<string, { row: ProductMeasureRow; parts: ProductMeasureRow[] }>();
  for (const r of data.items) {
    const key = `${r.shop_id}-${r.listing_id}-${r.variant}`;
    products.set(key, { row: r, parts: [...(products.get(key)?.parts ?? []), r] });
  }
  const isTaken = (p: { row: ProductMeasureRow }) => taken.some((x) => x.shop_id === p.row.shop_id && x.listing_id === p.row.listing_id && x.variant === p.row.variant);
  const fresh = [...products.entries()].filter(([, p]) => !isTaken(p));
  const added = [...products.entries()].filter(([, p]) => isTaken(p));
  const shown = view === "new" ? fresh : added;
  return (
    <div>
      <SubTabs
        tabs={[
          { id: "new", label: t("Yeni", "New"), count: fresh.length },
          { id: "done", label: t("İşlenmiş", "Processed"), count: added.length },
        ]}
        value={view}
        onChange={setView}
      />
      {shown.length === 0 ? (
        <p className={muted}>
          {products.size === 0
            ? t("Henüz ürün tanımlı değil: Ürünler sekmesinden plaka DXF'i yükleyip parçaları ürünlere ata.", "No products yet: upload the sheet DXF in the Products tab and assign its parts to products.")
            : view === "new"
              ? t("Tanımlı bütün ürünler bu işe eklendi.", "All defined products are already added to this job.")
              : t("Bu işe henüz ürün eklenmedi.", "No products added to this job yet.")}
        </p>
      ) : (
        <>
          {view === "new" && (
            <div className="mb-2 flex items-center justify-end gap-2">
              <button type="button" onClick={() => onAdd(fresh.map(([, p]) => p.row))} className={btnLink}>
                {t("Hepsini ekle", "Add all")}
              </button>
            </div>
          )}
          <ul className="max-h-[60vh] divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800">
            {shown.map(([key, p]) => {
              const cut = p.parts.reduce((sum, x) => sum + (x.values.cut_length ?? 0) * (x.values.part_qty ?? 1), 0);
              const materials = [...new Set(p.parts.map((x) => materialLabel(x.material, t)).filter(Boolean))].join(", ");
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => (view === "new" ? onAdd([p.row]) : onRemove(p.row))}
                    className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                    title={view === "done" ? t("Bu işten çıkar", "Remove from this job") : undefined}
                  >
                    <span className={view === "new" ? "text-neutral-400" : "text-emerald-600 dark:text-emerald-400"}>{view === "new" ? "+" : "✓"}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200">{productName(p.row.title, p.row.variant)}</span>
                    <span className="shrink-0 text-[11px] text-neutral-400">
                      {cut ? `${fmtQty(cut / 1000, locale)} m` : t("kesim uzunluğu yok", "no cut length")}
                      {p.parts.length > 1 ? ` · ${t(`${p.parts.length} parça`, `${p.parts.length} parts`)}` : p.row.values.width && p.row.values.height ? ` · ${fmtQty(p.row.values.width, locale)}×${fmtQty(p.row.values.height, locale)} mm` : ""}
                      {materials ? ` · ${materials}` : ""}
                    </span>
                    {view === "done" && <span className="shrink-0 text-xs text-red-600 dark:text-red-400">{t("çıkar", "remove")}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
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
  return { shop_id: p.shop_id ?? 0, party_id: p.party_id ?? null, listing_id: p.listing_id, variant: p.variant ?? "", title: p.title, qty: p.qty, amount: p.amount, item_id: p.item_id ?? null };
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
            <div className="line-clamp-1 font-medium text-neutral-900 dark:text-neutral-100">{a.party_id ? a.title : a.listing_id ? productName(a.title, a.variant) : t("Genel gider", "Overhead")}</div>
            <div className={muted}>
              {money(a.amount, job.currency, locale)}
              {a.report_ccy !== job.currency && ` ≈ ${money(a.amount_report, a.report_ccy, locale)}`}
              {a.listing_id && a.qty > 1 && ` · ${a.qty} ${t("adet", "units")} → ${money(a.amount_report / a.qty, a.report_ccy, locale)} / ${t("adet", "unit")}`}
              {a.party_id ? ` · ${t("dış pay: maliyete yazılmaz", "external share: not booked as cost")}` : !a.listing_id && ` · ${t("Finans giderlerinde", "in Finance expenses")}`}
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

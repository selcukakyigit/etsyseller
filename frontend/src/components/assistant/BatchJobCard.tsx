"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BatchEdit, BatchSpec, BatchState, ChatCard } from "@/lib/api";
import { batchApi } from "@/lib/batchApi";
import DecimalInput from "@/components/ui/NumberInputs";
import HelpTip from "@/components/ui/HelpTip";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";

type Batch = Extract<ChatCard, { type: "batch_job" }>;
type Row = BatchState["items"][number];

const POLL_MS = 2500;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const field =
  "w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const warn = "border-amber-400 dark:border-amber-600";

/** Ürün resminin küçüğü (yüklenen sohbet resmi). */
function Thumb({ shopId, imageId }: { shopId: number; imageId: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={batchApi.imageSrc(shopId, imageId)} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 object-cover dark:border-neutral-800" />
  );
}

/** Ağırlık kutusu: yalnızca rakam, boş = girilmemiş; "tahmini" rozeti kullanıcı değiştirene dek durur. */
function WeightField({ spec, onChange }: { spec: Partial<BatchSpec>; onChange: (patch: Partial<BatchSpec>) => void }) {
  const { t } = useT();
  const [text, setText] = useState<string | null>(null);
  const value = spec.weight ?? null;
  const shown = text !== null && (text === "" ? null : Number(text.replace(",", "."))) === value ? text : value === null ? "" : String(value);
  return (
    <div>
      <div className="flex gap-1">
        <DecimalInput
          value={shown}
          onValue={(v) => {
            setText(v);
            const n = v === "" ? null : Number(v.replace(",", "."));
            onChange({ weight: n === null || Number.isNaN(n) ? null : n });
          }}
          onBlur={() => setText(null)}
          className={field}
        />
        <select value={spec.weight_unit ?? "oz"} onChange={(e) => onChange({ weight_unit: e.target.value as BatchSpec["weight_unit"] })} className={`${field} !w-16`} aria-label={t("Ağırlık birimi", "Weight unit")}>
          {["oz", "lb", "g", "kg"].map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
      {spec.weight_estimated && value !== null && <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">{t("tahmini", "estimated")}</p>}
    </div>
  );
}

/** Ön kontrol satırı: ürünün çözümlenen bilgileri; boş ölçü/kapasite ve malzeme taslakta yazılmaz (uydurulmaz). */
function ReviewRow({ shopId, item, spec, onChange }: { shopId: number; item: Row; spec: Partial<BatchSpec>; onChange: (patch: Partial<BatchSpec>) => void }) {
  const { t } = useT();
  const unsure = (k: string) => (spec.unsure ?? []).includes(k);
  const options = spec.categories ?? [];
  return (
    <li className="flex gap-3 px-4 py-3 text-xs">
      <Thumb shopId={shopId} imageId={item.image_id} />
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-0.5 block text-[10px] text-neutral-500 dark:text-neutral-400">
            {item.index}. {t("Ürün adı", "Product name")}
          </span>
          <input value={spec.name ?? ""} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} className={field} />
        </label>
        {item.files.length > 0 && (
          <p className="truncate text-[11px] text-neutral-600 sm:col-span-2 dark:text-neutral-300" title={item.files.join(", ")}>
            📎 {item.files.join(", ")}
          </p>
        )}
        {spec.digital && item.files.length === 0 && (
          <p className="text-[11px] text-amber-700 sm:col-span-2 dark:text-amber-400">
            {t("Dijital ürün ama indirilebilir dosya yok: taslak 'dosya eksik' kalır. Dosyayı sohbete yükleyip hangi ürüne ait olduğunu yaz.", "Digital product but no downloadable file: the draft stays 'file missing'. Upload the file in the chat and say which product it belongs to.")}
          </p>
        )}
        {!spec.digital && item.files.length > 0 && (
          <p className="text-[11px] text-amber-700 sm:col-span-2 dark:text-amber-400">{t("Fiziksel seçili: bu dosyalar kullanılmaz.", "Physical is selected: these files will not be used.")}</p>
        )}
        <label>
          <span className="mb-0.5 block text-[10px] text-neutral-500 dark:text-neutral-400">{t("Tür", "Type")}</span>
          <select value={spec.digital ? "digital" : "physical"} onChange={(e) => onChange({ digital: e.target.value === "digital" })} className={field}>
            <option value="physical">{t("Fiziksel", "Physical")}</option>
            <option value="digital">{t("Dijital (dosya gerekir)", "Digital (needs a file)")}</option>
          </select>
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] text-neutral-500 dark:text-neutral-400">{t("Ölçü / kapasite", "Size / capacity")}</span>
          <input
            value={spec.size ?? ""}
            maxLength={80}
            placeholder={t("bilmiyorsan boş bırak", "leave empty if unknown")}
            onChange={(e) => onChange({ size: e.target.value })}
            className={`${field} ${!spec.size && unsure("size") ? warn : ""}`}
          />
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] text-neutral-500 dark:text-neutral-400">{t("Malzeme", "Material")}</span>
          <input value={spec.material ?? ""} maxLength={80} placeholder={t("bilmiyorsan boş bırak", "leave empty if unknown")} onChange={(e) => onChange({ material: e.target.value })} className={`${field} ${!spec.material && unsure("material") ? warn : ""}`} />
        </label>
        <div>
          <span className="mb-0.5 block text-[10px] text-neutral-500 dark:text-neutral-400">{t("Ağırlık (paketli)", "Weight (packed)")}</span>
          <WeightField spec={spec} onChange={onChange} />
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300">
            <input type="checkbox" checked={!!spec.personalizable} onChange={(e) => onChange({ personalizable: e.target.checked })} />
            {t("Kişiselleştirilebilir", "Personalizable")}
          </label>
          {spec.personalizable && (
            <input
              value={spec.personalization_detail ?? ""}
              maxLength={200}
              placeholder={t("Türü? (ör. isim gravürü, en çok 20 karakter); boşsa yalnızca metin girişi yazılır", "What kind? (e.g. name engraving, up to 20 characters); if empty only a text input is written")}
              onChange={(e) => onChange({ personalization_detail: e.target.value })}
              className={`${field} mt-1 ${!spec.personalization_detail && unsure("personalization_detail") ? warn : ""}`}
            />
          )}
        </div>
        <label className="sm:col-span-2">
          <span className="mb-0.5 block text-[10px] text-neutral-500 dark:text-neutral-400">{t("Kategori (rakiplerin dağılımı)", "Category (competitors' share)")}</span>
          <select value={spec.category_id ?? ""} onChange={(e) => onChange({ category_id: e.target.value === "" ? null : Number(e.target.value) })} className={field}>
            <option value="">{t("Asistan seçsin", "Let the assistant choose")}</option>
            {options.map((c) => (
              <option key={c.taxonomy_id} value={c.taxonomy_id}>
                {`${clip(c.path.split(" > ").slice(-2).join(" > "), 60)} · %${Math.round(c.share * 100)}`}
              </option>
            ))}
          </select>
        </label>
        {spec.error && <p className="text-red-600 sm:col-span-2 dark:text-red-400">{spec.error}</p>}
      </div>
    </li>
  );
}

/** Birden çok ürünün resminden toplu taslak oluşturma: 1) çözümleme, 2) düzenlenebilir ön kontrol (onay), 3) ürün ürün oluşturma (durdur), bitince her taslağa bağlantı ve eksikler. Taslaklar yereldir, Etsy'ye gitmez. */
export default function BatchJobCard({ card, shopId }: { card: Batch; shopId: number }) {
  const { t } = useT();
  const [state, setState] = useState<BatchState>(card);
  const [edits, setEdits] = useState<Record<number, Partial<BatchSpec>>>({});
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = state.status === "analyzing" || state.status === "running";

  useEffect(() => {
    if (!live || gone) return;
    let stopped = false;
    const tick = () =>
      batchApi.job(shopId, card.job_id).then(
        (s) => !stopped && setState(s),
        () => !stopped && setGone(true), // sunucu yeniden başlamış ya da iş süresi dolmuş
      );
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [live, gone, shopId, card.job_id]);

  async function act(action: "start" | "stop") {
    setBusy(true);
    try {
      if (action === "stop") setState(await batchApi.job(shopId, card.job_id, "stop"));
      else setState(await batchApi.start(shopId, card.job_id, Object.entries(edits).map(([index, patch]) => ({ index: Number(index), ...patch }) as BatchEdit)));
    } catch {
      setGone(true);
    } finally {
      setBusy(false);
    }
  }

  const finished = state.done + state.failed + state.skipped;
  const progress = state.status === "analyzing" ? state.analyzed : finished;
  const pct = state.total ? Math.round((progress / state.total) * 100) : 0;
  const stateLabel = {
    queued: t("Sırada", "Queued"),
    running: t("Hazırlanıyor", "Working"),
    done: t("Hazır", "Ready"),
    failed: t("Olmadı", "Failed"),
    skipped: t("Atlandı", "Skipped"),
  } as const;
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {state.status === "review" ? t("Ön kontrol: ürün bilgileri", "Review: product details") : t("Toplu taslak oluşturma", "Batch drafts")}
        <HelpTip>
          {t(
            "Ürün bilgileri resimden ve söylediklerinden çıkarılır. Boş bıraktığın ölçü/kapasite ve malzeme taslakta hiç yazılmaz (uydurulmaz). Ağırlık ve kategori tahmindir, değiştirebilirsin. Taslaklar yereldir, Etsy'ye hiçbiri gitmez; yayın ayrı ve onaylıdır. Resim ya da video üretilmez. Fiyatı söylenmeyen ürünlerde 'Fiyat gir' eksiği kalır.",
            "Product details are taken from the images and what you said. Size/capacity and material you leave empty are not written to the draft at all (nothing is invented). Weight and category are estimates; you can change them. Drafts are local and none goes to Etsy; publishing is separate and confirmed. No images or videos are generated. Products without a price keep a 'Set a price' gap.",
          )}
        </HelpTip>
        <span className="ml-auto text-[11px] text-neutral-500">
          {progress}/{state.total}
        </span>
      </div>

      {live && (
        <div className="px-4 pt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div className="h-full bg-[#D97757] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {state.status === "review" ? (
        <ul className="max-h-[28rem] divide-y divide-neutral-100 overflow-auto dark:divide-neutral-800">
          {state.items.map((i) => (
            <ReviewRow key={i.index} shopId={shopId} item={i} spec={{ ...i.spec, ...edits[i.index] }} onChange={(patch) => setEdits((e) => ({ ...e, [i.index]: { ...e[i.index], ...patch } }))} />
          ))}
        </ul>
      ) : (
        <ul className="max-h-80 divide-y divide-neutral-100 overflow-auto dark:divide-neutral-800">
          {state.items.map((i) => (
            <li key={i.index} className="flex items-start gap-3 px-4 py-2.5 text-xs">
              <Thumb shopId={shopId} imageId={i.image_id} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-neutral-400 dark:text-neutral-500">{i.index}.</span>
                  <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                    {i.title ? clip(i.title, 90) : i.spec.name ? clip(i.spec.name, 90) : t(`${i.images} resim`, `${i.images} image(s)`)}
                  </span>
                  {i.files.length > 0 && <span className="text-[11px] text-neutral-500 dark:text-neutral-400">📎 {i.files.length}</span>}
                  {i.listing_id && (
                    <Link href={`/listings/${i.listing_id}/edit`} className="text-[#D97757] hover:underline">
                      {t("Aç", "Open")}
                    </Link>
                  )}
                </div>
                {i.state === "done" && i.missing.length > 0 && <p className="mt-0.5 text-amber-700 dark:text-amber-400">{i.missing.join(" · ")}</p>}
                {i.state === "done" && i.estimated.length > 0 && (
                  <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">{t("Tahmini değer var (kontrol et): ", "Estimated value (please check): ")}{i.estimated.map((k) => (k === "weight" ? t("ağırlık", "weight") : k)).join(", ")}</p>
                )}
                {i.state === "done" && i.warnings.length > 0 && <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">{clip(i.warnings.join(" · "), 160)}</p>}
                {i.state === "failed" && <p className="mt-0.5 text-red-600 dark:text-red-400">{i.error}</p>}
              </div>
              <span
                className={`flex shrink-0 items-center gap-1 ${
                  i.state === "done" ? "text-green-700 dark:text-green-400" : i.state === "failed" ? "text-red-600 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                {(i.state === "running" || (state.status === "analyzing" && !i.analyzed)) && <Spinner size={11} />}
                {state.status === "analyzing" ? (i.analyzed ? t("Çözümlendi", "Analysed") : t("Çözümleniyor", "Analysing")) : stateLabel[i.state]}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <span className="mr-auto text-xs text-neutral-600 dark:text-neutral-300">
          {gone
            ? t("İş bulunamadı; o ana dek oluşan taslaklar yerelde.", "Job not found; drafts made so far are local.")
            : state.status === "analyzing"
              ? t(`Ürünler çözümleniyor: ${state.analyzed}/${state.total}`, `Analysing products: ${state.analyzed}/${state.total}`)
              : state.status === "review"
                ? t("Bilgileri kontrol et, sonra taslakları oluştur.", "Check the details, then create the drafts.")
                : state.status === "running"
                  ? t(`${state.done} hazır, ${state.failed} olmadı · sürüyor`, `${state.done} ready, ${state.failed} failed · running`)
                  : state.status === "stopped"
                    ? t(`Durduruldu: ${state.done} hazır, ${state.skipped} atlandı`, `Stopped: ${state.done} ready, ${state.skipped} skipped`)
                    : t(`Tamamlandı: ${state.done} hazır${state.failed ? `, ${state.failed} olmadı` : ""}`, `Done: ${state.done} ready${state.failed ? `, ${state.failed} failed` : ""}`)}
        </span>
        {!gone && state.status === "review" && (
          <>
            <button type="button" disabled={busy} onClick={() => void act("stop")} className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800`}>
              {t("Vazgeç", "Cancel")}
            </button>
            <button type="button" disabled={busy} onClick={() => void act("start")} className={`${btn} bg-[#D97757] text-white hover:bg-[#C6613F]`}>
              {t("Taslakları oluştur", "Create drafts")}
            </button>
          </>
        )}
        {!gone && live && (
          <button type="button" disabled={busy} onClick={() => void act("stop")} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950`}>
            {t("Durdur", "Stop")}
          </button>
        )}
      </div>
    </div>
  );
}

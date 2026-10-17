"use client";

import { useEffect, useState } from "react";
import { api, ChangeResult, ListingChange, ListingDiagnosis } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { DIMS, dimDot } from "./ContentLevelCard";
import { FOCUS_KEYS, FocusKey, focusLabel } from "./NextStepCard";
import { fieldsText, metricText, sourceText, VERDICT_STYLE, verdictKey, verdictLabel } from "./changeLabels";

type Measured = Extract<ChangeResult, { status: "measured" }>;

const FIRST_READING_DAYS = 7; // backend impact.MIN_WINDOW: ilk ölçüm
const FINAL_DAYS = 30; // backend impact.MAX_WINDOW: sonuç kesinleşir

const signed = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v}%`);

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-400 dark:text-neutral-500">—</span>;
  const cls = value > 0 ? "text-emerald-600 dark:text-emerald-400" : value < 0 ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-300";
  return <span className={cls}>{value > 0 ? "+" : ""}{value}%</span>;
}

/** Ölçüm ayrıntısı: önce/sonra sayıları, kontrol grubunun aynı dönemdeki değişimi ve net etki; takip edilen aramalardaki sıra. */
function ResultDetail({ r }: { r: Measured }) {
  const { t } = useT();
  const rows = (["views", "favorites", "units"] as const).map((m) => ({ m, b: r.before[m], a: r.after[m], net: r.net[m] }));
  const pos = (p: number | null) => (p === null ? t("ilk 200'de yok", "not in top 200") : `#${Math.round(p)}`);
  return (
    <div className="mt-2 space-y-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] text-neutral-400 dark:text-neutral-500">
            <th className="py-1 font-normal" />
            <th className="py-1 font-normal">{t(`Önceki ${r.window_days} gün`, `${r.window_days} days before`)}</th>
            <th className="py-1 font-normal">{t(`Sonraki ${r.window_days} gün`, `${r.window_days} days after`)}</th>
            <th className="py-1 font-normal">{t("Kontrole göre", "Vs. control")}</th>
          </tr>
        </thead>
        <tbody className="text-neutral-700 dark:text-neutral-300">
          {rows.map(({ m, b, a, net }) => (
            <tr key={m} className={m === r.metric ? "font-semibold text-neutral-900 dark:text-neutral-100" : ""}>
              <td className="py-0.5 capitalize">{metricText(t, m)}</td>
              <td className="py-0.5">{b}</td>
              <td className="py-0.5">{a}</td>
              <td className="py-0.5"><Pct value={net} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
        {r.control.kind === "category"
          ? t(
              `Kontrol grubu: aynı kategoride, bu dönemde hiç değiştirilmemiş ${r.control.listings} listing. Onların görüntülenmesi aynı dönemde ${signed(r.control.views_pct)}.`,
              `Control group: ${r.control.listings} listings in the same category that were not changed in this period. Their views changed ${signed(r.control.views_pct)} over the same period.`,
            )
          : t(
              `Kontrol grubu: mağazada bu dönemde hiç değiştirilmemiş ${r.control.listings} listing (aynı kategoride yeterli listing yok). Onların görüntülenmesi aynı dönemde ${signed(r.control.views_pct)}.`,
              `Control group: ${r.control.listings} listings in the shop that were not changed in this period (not enough in the same category). Their views changed ${signed(r.control.views_pct)} over the same period.`,
            )}{" "}
        {t(
          `"Kontrole göre" sütunu mevsim ve mağaza geneli etkiyi çıkarır; karar kalın satıra göre verildi.`,
          `The "vs. control" column removes seasonal and shop-wide effects; the verdict is based on the bold row.`,
        )}{" "}
        {r.verdict === "unclear"
          ? t(
              "Fark büyük görünüyor ama bu kadar veriyle tesadüften ayırt edilemiyor; ölçüm devam ettikçe netleşebilir.",
              "The difference looks large, but with this much data it cannot be told apart from chance; it may become clear as measuring continues.",
            )
          : r.confidence
            ? t(
                `Bu farkın tesadüf olma ihtimali ${r.confidence === "high" ? "%1'in" : "%5'in"} altında.`,
                `The chance that this difference is random is below ${r.confidence === "high" ? "1%" : "5%"}.`,
              )
            : ""}
      </p>
      {r.ranks.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{t("Takip edilen aramalarda sıra", "Rank in tracked searches")}</p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
            {r.ranks.map((k) => {
              const better = k.after !== null && (k.before === null || k.after < k.before);
              const worse = k.before !== null && (k.after === null || k.after > k.before);
              return (
                <li key={k.keyword}>
                  {k.keyword}: {pos(k.before)} →{" "}
                  <b className={better ? "text-emerald-600 dark:text-emerald-400" : worse ? "text-red-600 dark:text-red-400" : ""}>{pos(k.after)}</b>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

type StageState = "done" | "active" | "pending";

function Stage({ n, title, state, last = false, children }: { n: number; title: string; state: StageState; last?: boolean; children: React.ReactNode }) {
  const dot =
    state === "done"
      ? "bg-emerald-500 text-white"
      : state === "active"
        ? "bg-[#D97757] text-white"
        : "bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300";
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${dot}`}>{state === "done" ? "✓" : n}</span>
        {!last && <span className="mt-1 w-px flex-1 bg-neutral-200 dark:bg-neutral-700" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"}`}>
        <p className={`text-xs font-semibold ${state === "pending" ? "text-neutral-400 dark:text-neutral-500" : "text-neutral-900 dark:text-neutral-100"}`}>{title}</p>
        <div className="mt-0.5 space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">{children}</div>
      </div>
    </li>
  );
}

/** Bir güncellemenin yolculuğu: Güncelleme → Bekleme → Değerlendirme (→ Sıradaki adım, yalnızca son güncellemede). */
export default function ChangeJourney({ ch, shopId, listingId, latest }: { ch: ListingChange; shopId: number; listingId: number; latest: boolean }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [d, setD] = useCached<ListingDiagnosis>(`diagnosis:${shopId}:${listingId}`);
  useEffect(() => {
    if (!latest || d) return;
    let cancelled = false;
    api.insights.diagnosis(shopId, listingId).then((r) => !cancelled && setD(r), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [latest, d, shopId, listingId, setD]);

  const r = ch.result;
  const det = ch.details;
  const key = verdictKey(r);
  const measured = r?.status === "measured" ? r : null;
  const waiting = !r || r.status === "waiting";
  const elapsed = r?.status === "waiting" ? r.days : measured ? measured.window_days : 0;
  const final = !!measured?.final;
  const why =
    ch.focus && (FOCUS_KEYS as string[]).includes(ch.focus)
      ? t(`Teşhis: ${focusLabel(t, ch.focus as FocusKey).toLowerCase()} adımı`, `Diagnosis: ${focusLabel(t, ch.focus as FocusKey).toLowerCase()} step`)
      : null;
  const contentDims = det.content ? DIMS.filter((k) => det.content!.before[k] && det.content!.after[k]) : [];
  const contentChanged = !!det.content && contentDims.some((k) => det.content!.before[k] !== det.content!.after[k]);

  const evaluation = (m: Measured) => {
    const metric = m.metric;
    const ctl = m.control[`${metric}_pct` as "views_pct" | "favorites_pct" | "units_pct"];
    return t(
      `${metricText(t, metric)}: önceki ${m.window_days} gün ${m.before[metric]} → sonraki ${m.window_days} gün ${m.after[metric]}. Benzer listing'ler aynı dönemde ${signed(ctl)}; bu yüzden net etki ${signed(m.net[metric])}.`,
      `${metricText(t, metric)}: ${m.before[metric]} in the ${m.window_days} days before → ${m.after[metric]} in the ${m.window_days} days after. Similar listings changed ${signed(ctl)} over the same period, so the net effect is ${signed(m.net[metric])}.`,
    );
  };

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {new Date(ch.published_at).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
        </span>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">{fieldsText(t, ch.fields)}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[key]}`}>{verdictLabel(t, r)}</span>
      </div>

      <ol>
        <Stage n={1} title={t("Güncelleme", "Update")} state="done">
          <p>
            {sourceText(t, ch.source)}
            {why && ` · ${why}`}
          </p>
          {det.title_before !== undefined && det.title_after !== undefined && (
            <p className="truncate">
              <span className="text-neutral-400 line-through dark:text-neutral-500">{det.title_before}</span> → {det.title_after}
            </p>
          )}
          {(det.tags_added?.length || det.tags_removed?.length) ? (
            <p>
              {det.tags_added?.length ? <span className="text-emerald-700 dark:text-emerald-400">+ {det.tags_added.join(", ")}</span> : null}
              {det.tags_added?.length && det.tags_removed?.length ? " · " : null}
              {det.tags_removed?.length ? <span className="text-red-700 dark:text-red-400">− {det.tags_removed.join(", ")}</span> : null}
            </p>
          ) : null}
          {det.price_before !== undefined && <p>{t("Fiyat", "Price")}: {det.price_before ?? "—"} → {det.price_after ?? "—"}</p>}
          {det.images_before !== undefined && (
            <p>
              {t("Fotoğraf", "Photos")}: {det.images_before} → {det.images_after}
              {det.thumbnail_changed && ` · ${t("kapak fotoğrafı değişti", "main photo changed")}`}
            </p>
          )}
          {contentChanged && (
            <p className="flex flex-wrap items-center gap-x-3">
              <span>{t("İçerik seviyesi", "Content level")}:</span>
              {contentDims.map((k) => (
                <span key={k} className="flex items-center gap-1">
                  {k.toUpperCase()}
                  <span className={`h-2 w-2 rounded-full ${dimDot(k, det.content!.before[k]!)}`} />→<span className={`h-2 w-2 rounded-full ${dimDot(k, det.content!.after[k]!)}`} />
                </span>
              ))}
            </p>
          )}
        </Stage>

        <Stage n={2} title={t("Bekleme", "Waiting")} state={waiting ? "active" : "done"}>
          {r?.status === "no_baseline" ? (
            <p>{t("Yayından önce yeterli kayıt yok; önce/sonra kıyaslaması yapılamıyor.", "There is not enough data from before the update to compare against.")}</p>
          ) : r?.status === "interrupted" ? (
            <p>{t("Sonraki değişiklik ölçüm penceresini kesti; iki değişikliğin etkisi karışmasın diye bu güncelleme ölçülmüyor.", "The next change cut the measuring window short, so this update is not measured to keep the effects apart.")}</p>
          ) : (
            <>
              <p>
                {waiting
                  ? t(
                      `Gün ${elapsed}: ilk ölçüm ${FIRST_READING_DAYS}. günde, kesin sonuç ${FINAL_DAYS}. günde. Bu sürede başka değişiklik yapma, sonucu karıştırır.`,
                      `Day ${elapsed}: first reading on day ${FIRST_READING_DAYS}, final result on day ${FINAL_DAYS}. Avoid other changes meanwhile; they would blur the result.`,
                    )
                  : final
                    ? t("Ölçüm penceresi doldu.", "The measuring window is complete.")
                    : t(`Gün ${elapsed} / ${FINAL_DAYS}: ön sonuç hazır, ölçüm sürüyor.`, `Day ${elapsed} / ${FINAL_DAYS}: preliminary result ready, still measuring.`)}
              </p>
              {!final && (
                <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div className="h-full bg-[#D97757]" style={{ width: `${Math.min(100, (elapsed / FINAL_DAYS) * 100)}%` }} />
                  <span className="absolute top-0 h-full w-px bg-neutral-400 dark:bg-neutral-500" style={{ left: `${(FIRST_READING_DAYS / FINAL_DAYS) * 100}%` }} />
                </div>
              )}
            </>
          )}
        </Stage>

        <Stage n={3} title={t("Değerlendirme", "Evaluation")} state={waiting ? "pending" : final || r?.status !== "measured" ? "done" : "active"} last={!latest}>
          {measured && measured.verdict !== "low_data" ? (
            <>
              <p>{evaluation(measured)}</p>
              <button type="button" onClick={() => setOpen((v) => !v)} className="font-medium text-[#B4553A] hover:underline dark:text-[#E89A7F]">
                {open ? t("Ayrıntıyı gizle", "Hide details") : t("Nasıl ölçüldü?", "How was it measured?")}
              </button>
              {open && <ResultDetail r={measured} />}
            </>
          ) : measured ? (
            <p>
              {t(
                `Önce ve sonra toplam ${measured.before.views + measured.after.views} görüntülenme var; güvenilir bir karar için çok az.`,
                `Only ${measured.before.views + measured.after.views} views before and after combined; too few for a reliable verdict.`,
              )}
            </p>
          ) : waiting ? (
            <p>{t("Ölçüm başlayınca burada: önce/sonra sayıları, benzer listing'lerle karşılaştırma ve güven seviyesi.", "Once measuring starts: before/after numbers, comparison with similar listings and confidence.")}</p>
          ) : (
            <p>—</p>
          )}
        </Stage>

        {latest && (
          <Stage n={4} title={t("Sıradaki adım", "Next step")} state={d?.next_step ? "active" : "pending"} last>
            <p>{d?.next_step ? d.next_step.text : t("Yükleniyor…", "Loading…")}</p>
          </Stage>
        )}
      </ol>
    </li>
  );
}

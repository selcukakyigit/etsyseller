"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Section, errorText, inputClass, useFormat } from "@/components/admin/ui";
import { Modal, btnGhost } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { ResearchKeyword, researchAdmin } from "@/lib/researchApi";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import { StateBadge, fmtMoney, useRefusedText } from "./shared";

/** Havuzdaki kelimeler: arama, durum süzgeci, ölçüm geçmişi. Ham hacim sayıları yalnızca burada (yönetici) görünür. */
export default function KeywordExplorer() {
  const { t } = useT();
  const f = useFormat();
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, error, reload } = useApiData(`admin:research:keywords:${q}:${state}:${page}`, () => researchAdmin.keywords({ q, state, page }));

  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  return (
    <Section
      title={t("Keyword Explorer", "Keyword Explorer")}
      action={
        <div className="flex items-center gap-2">
          <HelpTip align="right">
            {t(
              "Sayılar GOOGLE verisidir (Etsy arama hacmi değil). Kullanıcılara ham sayı gösterilmez; yalnızca öneriyi etkiler. 'Yenilenmeli': ölçümün süresi doldu, kelime kullanılıyorsa gece otomatik yenilenir.",
              "Numbers are GOOGLE data (not Etsy search volume). Users never see raw numbers; they only influence suggestions. 'Stale': the measurement expired; used keywords refresh automatically overnight.",
            )}
          </HelpTip>
          <Button tone="primary" onClick={() => setAdding(true)}>
            {t("Kelime ekle / yenile", "Add / refresh keywords")}
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={t("Kelime ara…", "Search keywords…")}
          className={`${inputClass} sm:max-w-xs`}
        />
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          className={`${inputClass} sm:w-48`}
          aria-label={t("Veri durumu", "Data state")}
        >
          <option value="">{t("Tüm durumlar", "All states")}</option>
          <option value="fresh">{t("Güncel", "Fresh")}</option>
          <option value="stale">{t("Yenilenmeli", "Stale")}</option>
          <option value="missing">{t("Metrik yok", "No metrics")}</option>
        </select>
      </div>

      {error && !data ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !data ? (
        <BlockSpinner />
      ) : data.items.length === 0 ? (
        <EmptyState>{t("Kelime bulunamadı.", "No keywords found.")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="py-2 pr-3 font-medium">{t("Kelime", "Keyword")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("Aylık arama", "Monthly searches")}</th>
                <th className="py-2 pr-3 text-right font-medium">CPC</th>
                <th className="py-2 pr-3 font-medium">{t("Durum", "State")}</th>
                <th className="py-2 font-medium">{t("Ölçüm", "Measured")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.items.map((k) => (
                <KeywordRow key={k.id} k={k} onOpen={() => setOpenId(k.id)} date={f.date(k.measured_at)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > data.per_page && (
        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>{t(`${f.num(data.total)} kelime`, `${f.num(data.total)} keywords`)}</span>
          <div className="flex items-center gap-2">
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ←
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
              →
            </Button>
          </div>
        </div>
      )}

      {openId !== null && <KeywordDetailModal id={openId} onClose={() => setOpenId(null)} />}
      {adding && (
        <AddModal
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </Section>
  );
}

function KeywordRow({ k, onOpen, date }: { k: ResearchKeyword; onOpen: () => void; date: string }) {
  const { locale } = useT();
  return (
    <tr onClick={onOpen} className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
      <td className="max-w-[16rem] truncate py-2 pr-3 font-medium text-neutral-900 dark:text-neutral-100">{k.term}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{k.search_volume === null ? "—" : k.search_volume.toLocaleString(locale)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{k.cpc === null ? "—" : fmtMoney(k.cpc, locale)}</td>
      <td className="py-2 pr-3">
        <StateBadge state={k.state} />
      </td>
      <td className="py-2 text-neutral-500 dark:text-neutral-400">{date}</td>
    </tr>
  );
}

function KeywordDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, locale } = useT();
  const f = useFormat();
  const { data, error } = useApiData(`admin:research:keyword:${id}`, () => researchAdmin.keyword(id));

  return (
    <Modal title={data?.keyword.term ?? t("Kelime", "Keyword")} widthClass="max-w-2xl" onClose={onClose} closeButton>
      <div className="min-h-[24rem] space-y-5">
        {error && !data ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : !data ? (
          <BlockSpinner />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <StateBadge state={data.keyword.state} />
              <span>{t("İlk kaynak", "First source")}: {data.keyword.first_source || "—"}</span>
              <span>· {t("Keşif", "Discovered")}: {f.date(data.keyword.created_at)}</span>
              {data.keyword.intent && <Badge tone="muted">{data.keyword.intent}</Badge>}
            </div>

            <div>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                {t("Öneri sinyalleri", "Suggestion signals")}
                <HelpTip>
                  {t(
                    "Yalnızca sayılar; mağaza kimliği tutulmaz. 'Önerildi': son günlerde kaç farklı mağazaya önerildi (kalabalık). 'Uygulandı': kaç mağaza yapay zekâ önerisiyle ekledi. Sonuçlar, kontrol gruplu önce/sonra ölçümünün kesinleşmiş hâlidir; aynı değişiklikteki diğer etiketlerle birlikte ölçülür, tek ifadenin etkisi değildir ve nedensellik kanıtlamaz.",
                    "Counts only; no shop ids are kept. 'Suggested': how many different shops it was suggested to recently (crowding). 'Applied': how many shops added it from an AI suggestion. Results are the final control-group before/after measurements; they cover the whole change with its other tags, are not the effect of one phrase, and do not prove causation.",
                  )}
                </HelpTip>
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {(
                  [
                    [t("Önerildi", "Suggested"), data.signals.suggested_shops],
                    [t("Uygulandı", "Applied"), data.signals.applied],
                    [t("Ölçüldü", "Measured"), data.signals.measured],
                    [t("İyi / kötü", "Better / worse"), `${data.signals.better} / ${data.signals.worse}`],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
                    <p className="text-neutral-500 dark:text-neutral-400">{label}</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("Ölçüm geçmişi", "Measurement history")}</h3>
              <ul className="max-h-48 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {data.history.length === 0 && <li className="p-3 text-sm text-neutral-400">{t("Ölçüm yok.", "No measurements.")}</li>}
                {data.history.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="tabular-nums text-neutral-900 dark:text-neutral-100">
                      {m.search_volume === null ? "—" : m.search_volume.toLocaleString(locale)} · {m.market} · {m.source}
                    </span>
                    <span className="text-neutral-500 dark:text-neutral-400">{f.dateTime(m.measured_at)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("İlişkili kelimeler", "Related keywords")}</h3>
              <ul className="max-h-48 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {data.related.length === 0 && data.seeds.length === 0 && <li className="p-3 text-sm text-neutral-400">{t("İlişki yok.", "No relations.")}</li>}
                {data.seeds.map((s) => (
                  <li key={`s-${s}`} className="px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
                    ↑ {s}
                  </li>
                ))}
                {data.related.map((r) => (
                  <li key={r.term} className="flex items-center justify-between px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
                    <span>{r.term}</span>
                    <span className="tabular-nums text-neutral-500 dark:text-neutral-400">{r.search_volume === null ? "—" : r.search_volume.toLocaleString(locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function AddModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const refusedText = useRefusedText();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const terms = text.split("\n").map((s) => s.trim()).filter(Boolean);

  async function submit() {
    setBusy(true);
    try {
      const r = await researchAdmin.refresh(terms);
      const refused = refusedText(r.refused);
      if (refused) toast.error(refused);
      else toast.success(t(`${r.pending} kelime kuyruğa alındı.`, `${r.pending} keywords queued.`));
      if (r.pending > 0) onDone();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("Kelime ekle / yenile", "Add / refresh keywords")}
      widthClass="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <Button tone="primary" busy={busy} disabled={terms.length === 0 || terms.length > 1000} onClick={() => void submit()}>
            {t(`Kuyruğa al (${terms.length})`, `Queue (${terms.length})`)}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={t("Her satıra bir kelime (en fazla 1000)", "One keyword per line (max 1000)")}
          className={`${inputClass} h-64 resize-none`}
        />
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {t("Süresi dolmamış olsa da seçili kelimeler yeniden ölçülür. Tüm kelimeler tek istekte gider.", "Selected keywords are re-measured even if not expired. All go in a single request.")}
        </p>
      </div>
    </Modal>
  );
}

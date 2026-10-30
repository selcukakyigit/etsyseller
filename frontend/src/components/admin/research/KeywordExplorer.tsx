"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Section, errorText, useFormat } from "@/components/admin/ui";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n-client";
import { EMPTY_KEYWORD_FILTERS, KeywordFilters, KeywordSort, ResearchKeyword, researchAdmin } from "@/lib/researchApi";
import { toast } from "@/lib/toast";
import { useApiData } from "@/lib/useApiData";
import AddKeywordsModal from "./AddKeywordsModal";
import BulkBar from "./BulkBar";
import KeywordDetailModal from "./KeywordDetailModal";
import KeywordFilterBar from "./KeywordFilterBar";
import { StateBadge, StatusBadges, fmtMoney } from "./shared";

/** Havuzdaki kelimeler: süzgeç, sıralama, toplu işlem, dışa aktarma, ölçüm geçmişi. Ham hacim sayıları yalnızca burada (yönetici) görünür. */
export default function KeywordExplorer() {
  const { t } = useT();
  const f = useFormat();
  const [filters, setFilters] = useState<KeywordFilters>(EMPTY_KEYWORD_FILTERS);
  const [sort, setSort] = useState<KeywordSort>("new");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { data, error, reload } = useApiData(`admin:research:keywords:${JSON.stringify(filters)}:${sort}:${page}`, () => researchAdmin.keywords(filters, { sort, page }));

  // Süzgeç, sıralama ya da sayfa değişince seçim sıfırlanır: görünmeyen kelimeye işlem uygulanmasın.
  const changeFilters = (next: KeywordFilters) => {
    setFilters(next);
    setPage(1);
    setSelected(new Set());
  };
  const goPage = (p: number) => {
    setPage(p);
    setSelected(new Set());
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  const allChecked = !!data && data.items.length > 0 && data.items.every((k) => selected.has(k.id));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await researchAdmin.exportCsv(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `keywords-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Section
      title={t("Keyword Explorer", "Keyword Explorer")}
      action={
        <div className="flex items-center gap-2">
          <HelpTip align="right">
            {t(
              "Sayılar GOOGLE verisidir (Etsy arama hacmi değil). Kullanıcılara ham sayı gösterilmez; yalnızca öneriyi etkiler. 'Yenilenmeli': ölçümün süresi doldu, kelime kullanılıyorsa haftalık otomatik işte yenilenir. Sabitli kelime kullanılmasa da yenilenir; arşivli yenilenmez; engelli hiç ölçülmez ve Keşfet/asistan önerilerinde görünmez. Toplu işlemde seçim yoksa işlem süzgece uyan kelimelere (en çok 1000) uygulanır.",
              "Numbers are GOOGLE data (not Etsy search volume). Users never see raw numbers; they only influence suggestions. 'Stale': the measurement expired; used keywords refresh in the weekly automatic job. A pinned keyword refreshes even when unused; archived ones do not refresh; blocked ones are never measured and vanish from Discover/assistant suggestions. With no selection, a bulk action applies to the keywords matching the filters (max 1000).",
            )}
          </HelpTip>
          <Button busy={exporting} onClick={() => void exportCsv()}>
            {t("CSV indir", "Download CSV")}
          </Button>
          <Button tone="primary" onClick={() => setAdding(true)}>
            {t("Kelime ekle / yenile", "Add / refresh keywords")}
          </Button>
        </div>
      }
    >
      <KeywordFilterBar
        filters={filters}
        onChange={changeFilters}
        sort={sort}
        onSort={(s) => {
          setSort(s);
          goPage(1);
        }}
      />

      {data && data.total > 0 && (
        <BulkBar
          selected={[...selected]}
          filters={filters}
          matching={data.total}
          capped={!!data.capped}
          onDone={() => {
            setSelected(new Set());
            reload();
          }}
        />
      )}

      {error && !data ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !data ? (
        <BlockSpinner />
      ) : data.items.length === 0 ? (
        <EmptyState>{t("Kelime bulunamadı.", "No keywords found.")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="w-8 py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => setSelected(e.target.checked ? new Set(data.items.map((k) => k.id)) : new Set())}
                    aria-label={t("Sayfadakilerin hepsini seç", "Select everything on this page")}
                  />
                </th>
                <th className="py-2 pr-3 font-medium">{t("Kelime", "Keyword")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("Aylık arama", "Monthly searches")}</th>
                <th className="py-2 pr-3 text-right font-medium">CPC</th>
                <th className="py-2 pr-3 text-right font-medium">{t("Zorluk", "Difficulty")}</th>
                <th className="py-2 pr-3 font-medium">{t("Durum", "State")}</th>
                <th className="py-2 font-medium">{t("Ölçüm / bitiş", "Measured / expires")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.items.map((k) => (
                <KeywordRow key={k.id} k={k} checked={selected.has(k.id)} onToggle={() => toggle(k.id)} onOpen={() => setOpenId(k.id)} measured={f.date(k.measured_at)} expires={k.expires_at ? f.date(k.expires_at) : ""} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > data.per_page && (
        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>{t(`${f.num(data.total)}${data.capped ? "+" : ""} kelime`, `${f.num(data.total)}${data.capped ? "+" : ""} keywords`)}</span>
          <div className="flex items-center gap-2">
            <Button disabled={page <= 1} onClick={() => goPage(page - 1)}>
              ←
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button disabled={page >= pages} onClick={() => goPage(page + 1)}>
              →
            </Button>
          </div>
        </div>
      )}

      {openId !== null && <KeywordDetailModal id={openId} onClose={() => setOpenId(null)} />}
      {adding && (
        <AddKeywordsModal
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

function KeywordRow({ k, checked, onToggle, onOpen, measured, expires }: { k: ResearchKeyword; checked: boolean; onToggle: () => void; onOpen: () => void; measured: string; expires: string }) {
  const { t, locale } = useT();
  return (
    <tr onClick={onOpen} className={`cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${k.status === "blocked" ? "opacity-60" : ""}`}>
      <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={t(`${k.term} seç`, `Select ${k.term}`)} />
      </td>
      <td className="max-w-[16rem] py-2 pr-3 font-medium text-neutral-900 dark:text-neutral-100">
        <span className="truncate">{k.term}</span>
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          <StatusBadges status={k.status} pinned={k.pinned} />
          {k.etsy_shops > 0 && <Badge tone="muted">{t(`Etsy · ${k.etsy_shops} mağaza`, `Etsy · ${k.etsy_shops} shops`)}</Badge>}
        </span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{k.search_volume === null ? "—" : k.search_volume.toLocaleString(locale)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{k.cpc === null ? "—" : fmtMoney(k.cpc, locale)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{k.difficulty === null ? "—" : k.difficulty}</td>
      <td className="py-2 pr-3">
        <StateBadge state={k.state} reason={k.reason} detail={k.reason_detail} />
      </td>
      <td className="py-2 text-neutral-500 dark:text-neutral-400">
        {measured}
        {expires && <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">→ {expires}</span>}
      </td>
    </tr>
  );
}

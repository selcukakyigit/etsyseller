"use client";

import { useState } from "react";
import { api, KeywordPoolItem } from "@/lib/api";
import { scoreFill, scorePercent, scoreTitle } from "@/lib/keywordScore";
import { cleanTag, useEtsyRules } from "@/lib/etsyRules";
import { tNow as t } from "@/lib/i18n";

const FALLBACK_MAX_TAGS = 13; // kurallar (backend etsy_rules) yüklenene kadar

function scoreLabel(item: KeywordPoolItem): string {
  if (item.source === "own") return `${item.units ?? 0} ${t("satış", "sales")}`;
  if (item.source === "etsy") return t(`${item.etsy_orders ?? 0} sip.`, `${item.etsy_orders ?? 0} orders`);
  if (item.source === "research") return item.etsy_searches ? `E:${item.etsy_searches >= 1000 ? `${(item.etsy_searches / 1000).toFixed(1)}k` : item.etsy_searches}` : "";
  if (item.etsy_results != null) return `${item.etsy_results >= 1000 ? `${Math.round(item.etsy_results / 1000)}k` : item.etsy_results} ${t("sonuç", "results")}`;
  return `%${item.sample_size > 0 ? Math.round((item.score / item.sample_size) * 100) : 0}`;
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

/** StringListEditor'ün etikete özel hâli: mevcut etiketlerin yanında kelime havuzundaki zorluk/skoru
 * (istenirse) gösterir, havuzdan bir etikete tıklayınca elle yazmadan direkt listeye ekler. */
export default function TagsEditor({
  shopId,
  listingId,
  tags,
  onChange,
}: {
  shopId: number;
  listingId: number;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [pool, setPool] = useState<KeywordPoolItem[] | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rules = useEtsyRules();
  const [note, setNote] = useState<string | null>(null);
  const maxTags = rules?.tag.max_count ?? FALLBACK_MAX_TAGS;
  const atLimit = tags.length >= maxTags;

  async function togglePool() {
    if (poolOpen) {
      setPoolOpen(false);
      return;
    }
    setPoolOpen(true);
    if (pool || loading) return; // önbellekte var, tekrar yüklemeye gerek yok
    setLoading(true);
    setError(null);
    try {
      const r = await api.listings.keywordPool(shopId, listingId);
      setPool(r.keywords);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Havuz yüklenemedi", "Could not load the pool"));
    } finally {
      setLoading(false);
    }
  }

  const shownPool = poolOpen ? pool : null;
  const byTag = new Map((shownPool ?? []).map((k) => [k.tag.toLowerCase(), k]));

  function add(tag: string) {
    const raw = tag.trim();
    const clean = rules ? cleanTag(raw, rules) : raw; // Etsy'nin kabul etmediği karakterler girişte çıkar
    if (!clean || atLimit) return;
    if (rules && clean.length > rules.tag.max_len) {
      setNote(t(`«${clean}» ${rules.tag.max_len} karakteri aşıyor; kısalt.`, `«${clean}» is longer than ${rules.tag.max_len} characters; shorten it.`));
      return;
    }
    if (tags.some((x) => x.toLowerCase() === clean.toLowerCase())) return;
    setNote(clean !== raw ? t(`Etsy'nin kabul etmediği karakterler çıkarıldı: «${clean}»`, `Characters Etsy does not accept were removed: «${clean}»`) : null);
    onChange([...tags, clean]);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t("Etiketler", "Tags")} ({tags.length}/{maxTags})
        </label>
        <button
          type="button"
          onClick={() => void togglePool()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#D97757] px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#d9550f] disabled:opacity-60"
        >
          {loading && <Spinner />}
          {loading ? t("Yükleniyor…", "Loading…") : poolOpen ? t("Havuzu gizle", "Hide pool") : `🔑 ${t("Kelime havuzunu göster", "Show keyword pool")}`}
        </button>
      </div>
      {error && <p className="mb-1 text-xs text-red-600">{error}</p>}

      <div className="mb-2 flex flex-wrap gap-1.5">
        {tags.map((v, i) => {
          const item = byTag.get(v.toLowerCase());
          const fill = item ? scoreFill(item) : null;
          const pct = item ? scorePercent(item) : null;
          return (
            <span
              key={`${v}-${i}`}
              title={
                item
                  ? item.source === "own"
                    ? t(`Bu etiketi taşıyan benzer listing'lerin son 180 günde toplam ${item.units ?? 0} satışı var.`, `Similar listings with this tag sold ${item.units ?? 0} units in the last 180 days.`)
                    : t(
                        `İlk ${item.sample_size} rakip listing'in ${item.score} tanesi bu etiketi kullanıyor (yüksek = kalabalık/rekabetçi).`,
                        `${item.score} of the top ${item.sample_size} competitor listings use this tag (high = crowded/competitive).`,
                      )
                  : undefined
              }
              style={fill && pct !== null ? { background: `linear-gradient(to right, ${fill} ${pct}%, transparent ${pct}%)` } : undefined}
              className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {v}
              {item && <span className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400">{scoreLabel(item)}</span>}
              <button
                type="button"
                onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      {!atLimit && (
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
                setDraft("");
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900"
            placeholder={t("Ekle ve Enter'a bas…", "Type and press Enter…")}
          />
          <button
            type="button"
            onClick={() => {
              add(draft);
              setDraft("");
            }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-100 transition dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t("Ekle", "Add")}
          </button>
        </div>
      )}
      {note && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{note}</p>}

      {shownPool && (
        <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <p className="mb-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
            {t(
              "Havuzdan seç — tıklayınca doğrudan yukarıya eklenir (kendi etiketlerin zaten yukarıda görünüyor, burada yalnızca yeni/rakip fikirler var):",
              "Pick from the pool — clicking adds it above (your own tags are already shown above; only new/competitor ideas are here):",
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {shownPool
              // Kendi etiketlerin zaten üst listede görünüyor; burada yalnızca rakip (yeni/farklı) fikirleri göster —
              // aksi halde slot'ların yarısı zaten bildiğin kendi etiketlerinle dolup çeşitlilik azalıyordu.
              .filter((k) => k.source === "competitor" && !tags.some((tag) => tag.toLowerCase() === k.tag.toLowerCase()))
              .map((k) => {
                const fill = scoreFill(k);
                const pct = scorePercent(k);
                return (
                  <button
                    key={k.tag}
                    type="button"
                    onClick={() => add(k.tag)}
                    disabled={atLimit}
                    title={`${scoreTitle(k, t)} · ${t(`İlk ${k.sample_size} rakip listing'in ${k.score} tanesi kullanıyor`, `Used by ${k.score} of the top ${k.sample_size} competitor listings`)}`}
                    style={{ background: `linear-gradient(to right, ${fill} ${pct}%, transparent ${pct}%)` }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:border-[#D97757] disabled:opacity-40 dark:border-neutral-800 dark:text-neutral-300"
                  >
                    {k.tag}
                    <span className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400">{scoreLabel(k)}</span>
                    <span className="text-neutral-400">+</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

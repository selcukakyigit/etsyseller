"use client";

import { useEffect, useRef } from "react";
import HelpTip from "@/components/ui/HelpTip";
import { BlockSpinner } from "@/components/ui/Spinner";
import { discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import CountryPanel from "./home/CountryPanel";
import Movers from "./home/Movers";
import Opportunities from "./home/Opportunities";
import PulseCards from "./home/PulseCards";
import SeasonCalendar from "./home/SeasonCalendar";

const POLL_MS = 5000;
const POLL_MAX = 12; // mevsimsellikler hazırlanırken en çok ~1 dakika yoklar

function Section({ title, help, action, children }: { title: string; help?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{title}</h2>
        {help && <HelpTip>{help}</HelpTip>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

const chip =
  "rounded-full border border-neutral-200 px-3 py-1 text-sm text-neutral-700 transition hover:border-[#D97757] hover:text-[#B4553A] dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-[#E89A7F]";

/** Arama yapılmadan önceki Keşfet ekranı: son aramalar, özet kartlar, dünya haritası (kim arıyor, müşterilerin nereden), sezon takvimi, yükselenler, fırsat kelimeler,
 * mağazanın kendi etiketleri ve koleksiyonlar. Herkese aynı "en çok aranan" listesi gösterilmez: her mağazanın girişi kendi etiketlerinden ve siparişlerinden gelir. */
export default function DiscoverHome({
  shopId,
  recent,
  onClearRecent,
  onPick,
  onOpenSaved,
}: {
  shopId: number;
  recent: string[];
  onClearRecent: () => void;
  onPick: (term: string) => void;
  onOpenSaved?: () => void;
}) {
  const { t, locale } = useT();
  const { data, error, reload } = useApiData(`discover:home:${shopId}`, () => discoverApi.home(shopId));
  const overview = useApiData(`discover:overview:${shopId}`, () => discoverApi.overview(shopId));
  const reloadOverview = overview.reload;
  const attempts = useRef(0);
  const wasPreparing = useRef(false);

  // Etiketlerin mevsimselliği hazırlanırken ekran kendiliğinden birkaç kez yeniden sorar.
  useEffect(() => {
    if (!data?.preparing || attempts.current >= POLL_MAX) return;
    const timer = setTimeout(() => {
      attempts.current += 1;
      reload();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [data, reload]);

  // Sezonlar hazır olunca takvim de tazelensin.
  useEffect(() => {
    if (data?.preparing) wasPreparing.current = true;
    else if (data && wasPreparing.current) {
      wasPreparing.current = false;
      reloadOverview();
    }
  }, [data, reloadOverview]);

  const hint = (
    <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
      {t("Bir kelime yaz; ilgili aramaları, aylık arama sayısını, trendi, CPC'yi ve alıcı niyetini göster.", "Type a keyword to see related searches, monthly searches, trend, CPC and buyer intent.")}
    </p>
  );

  if (!data && !error) return recent.length === 0 ? <BlockSpinner /> : null;
  const tags = data?.tags ?? [];
  const collections = data?.collections ?? [];
  if (recent.length === 0 && tags.length === 0 && collections.length === 0) return hint;
  const ov = overview.data;

  return (
    <div className="space-y-6 py-2">
      {recent.length > 0 && (
        <Section
          title={t("Son aramaların", "Recent searches")}
          action={
            <button type="button" onClick={onClearRecent} className="text-xs text-neutral-400 underline hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300">
              {t("Temizle", "Clear")}
            </button>
          }
        >
          <div className="flex flex-wrap gap-2">
            {recent.map((q) => (
              <button key={q} type="button" onClick={() => onPick(q)} className={chip}>
                {q}
              </button>
            ))}
          </div>
        </Section>
      )}

      {ov ? (
        <div className="space-y-4">
          <PulseCards overview={ov} onPick={onPick} />
          <CountryPanel countries={ov.countries} customers={ov.customers} onPick={onPick} />
          <SeasonCalendar rows={ov.calendar} preparing={!!data?.preparing} onPick={onPick} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Movers movers={ov.movers} onPick={onPick} />
            <Opportunities items={ov.opportunities} onPick={onPick} />
          </div>
        </div>
      ) : overview.error ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">{t("Pano şu an yüklenemedi.", "The dashboard could not be loaded right now.")}</p>
      ) : (
        <div className="min-h-[12rem]">
          <BlockSpinner />
        </div>
      )}

      {tags.length > 0 && (
        <Section
          title={t("Mağazandan başla", "Start from your shop")}
          help={t("Listing'lerinde en sık kullandığın etiketler. Birine tıkla, o kelimeyi araştır. Yanındaki sayı Google'daki aylık aramadır (Etsy hacmi değil).", "The tags you use most across your listings. Click one to research it. The number next to it is monthly Google searches (not Etsy volume).")}
        >
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button key={tag.term} type="button" onClick={() => onPick(tag.term)} className={chip}>
                {tag.term}
                {tag.volume !== null && <span className="ml-1.5 text-xs text-neutral-400 dark:text-neutral-500">{tag.volume.toLocaleString(locale)}</span>}
              </button>
            ))}
          </div>
        </Section>
      )}

      {collections.length > 0 && onOpenSaved && (
        <Section title={t("Koleksiyonların", "Your collections")}>
          <div className="flex flex-wrap gap-2">
            {collections.map((c) => (
              <button key={c.name} type="button" onClick={onOpenSaved} className={chip}>
                {c.name === "" ? t("Genel", "General") : c.name} <span className="text-xs text-neutral-400 dark:text-neutral-500">{c.count}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

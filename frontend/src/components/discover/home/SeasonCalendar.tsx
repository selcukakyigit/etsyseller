"use client";

import type { CalendarRow } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { monthNames } from "../SeasonChart";
import { Card } from "./Card";

/** Sezon takvimi: sezonluk etiketlerin 12 aylık ilgisi (Google Trends, 5 yıl ortalaması), koyu = yoğun. Şimdiki ay çerçeveli, zirve aylar kalın çizgili. */
export default function SeasonCalendar({ rows, preparing, onPick }: { rows: CalendarRow[]; preparing: boolean; onPick: (term: string) => void }) {
  const { t, locale } = useT();
  const names = monthNames(locale);
  const now = new Date().getMonth();
  return (
    <Card
      title={t("Sezon takvimi", "Season calendar")}
      help={t(
        "Mağazandaki sık etiketlerden mevsimsel olanların yıl içindeki ilgisi (Google Trends, son 5 yılın ortalaması). Koyu kutu = o ay ilgi yüksek; çerçeveli kutu = zirve. Alıcılar zirveden 1-2 ay önce aramaya başladığı için listing'i şimdiden hazırla. Çok az aranan etiketlerin mevsimselliği hesaplanmaz.",
        "How the seasonal ones among your common tags rise and fall over the year (Google Trends, 5-year average). A darker box = higher interest that month; an outlined box = the peak. Shoppers start searching 1-2 months before the peak, so get the listing ready early. Seasonality is not computed for tags that are searched very rarely.",
      )}
    >
      {rows.length === 0 ? (
        <p className="py-3 text-xs text-neutral-400 dark:text-neutral-500">
          {preparing ? t("Etiketlerinin sezonları hesaplanıyor…", "Working out the seasons of your tags…") : t("Sezonluk etiket bulunamadı (ya da aylık araması çok düşük).", "No seasonal tags found (or their monthly searches are too low).")}
        </p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[34rem] space-y-1">
            <div className="grid grid-cols-[8rem_repeat(12,minmax(0,1fr))_4.5rem] items-center gap-1 text-[10px]">
              <span />
              {names.map((n, i) => (
                <span key={n} className={`text-center ${i === now ? "font-semibold text-[#B4553A] dark:text-[#E89A7F]" : "text-neutral-400 dark:text-neutral-500"}`}>
                  {n}
                </span>
              ))}
              <span />
            </div>
            {rows.map((r) => (
              <div key={r.term} className="grid grid-cols-[8rem_repeat(12,minmax(0,1fr))_4.5rem] items-center gap-1">
                <button type="button" onClick={() => onPick(r.term)} title={r.term} className="truncate text-left text-xs font-medium text-neutral-800 hover:text-[#B4553A] dark:text-neutral-200 dark:hover:text-[#E89A7F]">
                  {r.term}
                </button>
                {r.monthly.map((v, i) => {
                  const peak = r.peak_months.includes(i + 1);
                  return (
                    <span
                      key={i}
                      title={`${names[i]}: ${v}`}
                      className={`h-6 rounded-md ${peak ? "ring-1 ring-[#C6613F] dark:ring-[#E89A7F]" : ""} ${i === now ? "outline outline-1 outline-offset-1 outline-neutral-400 dark:outline-neutral-500" : ""}`}
                      style={{ backgroundColor: `rgba(217, 119, 87, ${(0.08 + 0.92 * Math.pow(v / 100, 1.4)).toFixed(2)})` }}
                    />
                  );
                })}
                <span className={`text-right text-[11px] ${r.in_months !== null && r.in_months <= 1 ? "font-medium text-[#B4553A] dark:text-[#E89A7F]" : "text-neutral-400 dark:text-neutral-500"}`}>
                  {r.in_months === null ? "" : r.in_months === 0 ? t("şimdi", "now") : t(`${r.in_months} ay`, `${r.in_months} mo`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

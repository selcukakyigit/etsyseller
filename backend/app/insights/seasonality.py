"""Mevsim: bir listing'in (ya da mağazanın) yılın hangi aylarında sattığı, sipariş geçmişinden.

Dış kaynak gerekmez. Listing'in kendi geçmişi azsa mağaza geneline bakılır. Zirve ayları, son üç yılın aylık
toplamında ortalamanın belirgin üstünde kalan aylardır; zirveye kalan hafta ve "zirvedesin" bilgisi buradan çıkar.
Google'daki talep kıyası ayrı bir sinyaldir (bkz. demand.py)."""
import datetime as dt

from app.core.i18n import tr
from app.insights import sales

PEAK_FACTOR = 1.6  # ortalamanın bu katı ve üstündeki aylar zirve
MIN_UNITS = 24  # listing'in kendi mevsimini çıkarmak için gereken en az satış
LOOKBACK_MONTHS = 36
MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def month_name(m: int) -> str:
    return tr(MONTHS_TR[m - 1], MONTHS_EN[m - 1])


def _peaks(monthly: dict[str, list[float]], today: dt.date) -> tuple[list[int], int]:
    keys = sales.month_range(sales.add_months(sales.ym(today), -1), LOOKBACK_MONTHS)
    by_month = [0.0] * 12
    total = 0.0
    for k in keys:
        u = monthly.get(k, [0, 0])[0]
        by_month[int(k[5:]) - 1] += u
        total += u
    if total <= 0:
        return [], 0
    avg = total / 12
    return [i + 1 for i, v in enumerate(by_month) if v >= avg * PEAK_FACTOR], int(total)


def season(listing_monthly: dict[str, list[float]], shop_monthly: dict[str, list[float]], today: dt.date) -> dict:
    peaks, total = _peaks(listing_monthly, today)
    source = "listing"
    if total < MIN_UNITS:
        peaks, _ = _peaks(shop_monthly, today)
        source = "shop"
    if not peaks:
        return {"peak_months": [], "source": source, "in_peak": False, "weeks_to_peak": None, "advice": None, "text": tr("Belirgin bir satış mevsimi yok.", "No clear sales season.")}
    in_peak = today.month in peaks
    weeks_to_peak = None
    if not in_peak:
        for ahead in range(1, 13):
            m = (today.month - 1 + ahead) % 12 + 1
            if m in peaks:
                y = today.year + (today.month - 1 + ahead) // 12
                weeks_to_peak = max(0, (dt.date(y, m, 1) - today).days // 7)
                break
    names = ", ".join(month_name(m) for m in peaks)
    if in_peak:
        advice = "in_peak"
        text = tr(
            f"Şu an satış zirvesindesin ({names}). Büyük değişiklik yapma; hem satışı riske atar hem de etkisi ölçülemez.",
            f"You are in your sales peak ({names}). Avoid big changes: they put sales at risk and their effect cannot be measured.",
        )
    elif weeks_to_peak is not None and weeks_to_peak <= 8:
        advice = "prepare"
        text = tr(
            f"Zirveye {weeks_to_peak} hafta var ({names}). Değişiklik yapacaksan şimdi yap ki Etsy zirveden önce oturtsun.",
            f"Your peak ({names}) starts in {weeks_to_peak} weeks. If you plan changes, make them now so Etsy settles them before the peak.",
        )
    else:
        advice = "off_season"
        text = tr(
            f"Satış zirvesi: {names}" + (f" ({weeks_to_peak} hafta sonra)." if weeks_to_peak is not None else "."),
            f"Sales peak: {names}" + (f" (in {weeks_to_peak} weeks)." if weeks_to_peak is not None else "."),
        )
    return {"peak_months": peaks, "source": source, "in_peak": in_peak, "weeks_to_peak": weeks_to_peak, "advice": advice, "text": text}

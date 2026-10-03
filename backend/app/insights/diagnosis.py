"""Düşüş teşhisi: "bu listing neden düştü, ne yapmalı?"

Önce satış eğrisi kurulur (son 12 ay ile önceki 12 ay, son 90 gün ile geçen yılın aynı 90 günü; mevsim etkisi böylece
ayrılır) ve listing'in durumu belirlenir: yeni / az veri / düşüşte / sabit / yükselişte. Ardından her sinyal kendi
kanıtını ve (varsa) bir sebep oyunu verir; en güçlü oy teşhisin sebebi olur. Sinyaller birbirinden bağımsızdır ve
`SIGNALS` listesine eklenerek çoğaltılır (sıra takibi, talep, Etsy verisi sonraki adımlarda buraya bağlanır).

Hiçbir sinyal Etsy'ye istek atmaz; yalnızca yerel veri (sipariş geçmişi, günlük görüntülenme kayıtları, sürüm geçmişi,
yorumlar, sağlık değerlendirmesi) kullanılır."""
import datetime as dt
import html
import json
from dataclasses import dataclass, field
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.fingerprint import ResultCache
from app.core.i18n import get_lang, tr
from app.insights import impact, next_step, sales, seasonality
from app.listings import health as listing_health
from app.listings import performance
from app.listings.models import ListingCache, ListingChange
from app.shops.models import ReviewCache, Shop

NEW_LISTING_DAYS = 120
MIN_UNITS_FOR_TREND = 8
DECLINE_RATIO = 0.7  # son 12 ay, önceki 12 ayın bu oranının altındaysa düşüş
RECENT_DECLINE_RATIO = 0.5  # son 90 gün, geçen yılın aynı 90 gününün bu oranının altındaysa düşüş
GROWTH_RATIO = 1.3
SHOP_WIDE_GAP = 15  # listing'in düşüşü mağazanınkinden en fazla bu kadar puan derinse "mağaza geneli"
PRICE_CHANGE = 0.12  # düşüş başlangıcı çevresinde birim fiyat bu orandan fazla değiştiyse olay sayılır


@dataclass
class Evidence:
    kind: str
    tone: str  # bad | good | info
    text: str


@dataclass
class Vote:
    cause: str  # visibility | appeal | conversion | shop_wide | demand
    weight: float


@dataclass
class Ctx:
    db: Session
    shop: Shop
    listing_id: int
    raw: dict
    today: dt.date
    idx: dict
    rows: list
    listing_monthly: dict
    shop_monthly: dict
    status: str
    change_pct: float | None
    shop_change_pct: float | None
    decline_start: str | None
    events: list[dict] = field(default_factory=list)


Signal = Callable[[Ctx], tuple[list[Evidence], list[Vote]]]


# ------------------------------------------------------------------ satış eğrisi

def _pct(now: float, before: float) -> float | None:
    return round((now - before) / before * 100) if before > 0 else None


def _decline_start(monthly: dict, today: dt.date) -> str | None:
    """Son 24 ayda, 3 aylık toplamın geçen yılın aynı 3 ayının %60'ının altında kaldığı kesintisiz (en fazla bir ay
    boşluklu) son dönemin ilk ayı."""
    keys = sales.month_range(sales.add_months(sales.ym(today), -1), 24)

    def roll(k: str) -> float:
        return sum(monthly.get(sales.add_months(k, -i), [0, 0])[0] for i in range(3))

    # Geçen yıl da az satılmış aylar (3 aylık toplam < 3) karşılaştırılamaz: zinciri ne uzatır ne de keser.
    weak: list[bool | None] = []
    for k in keys:
        before = roll(sales.add_months(k, -12))
        weak.append(None if before < 3 else roll(k) < before * 0.6)
    start, gap = None, 0
    for k, w in zip(reversed(keys), reversed(weak)):
        if w is None:
            continue
        if w:
            start, gap = k, 0
        else:
            gap += 1
            if gap > 1:
                break
    return start


def _status(raw: dict, rows: list, today: dt.date) -> tuple[str, dict]:
    created = raw.get("original_creation_timestamp") or raw.get("creation_timestamp")
    age_days = (today - dt.datetime.utcfromtimestamp(created).date()).days if created else None
    last12 = sales.units_between(rows, today - dt.timedelta(days=364), today)
    prev12 = sales.units_between(rows, today - dt.timedelta(days=729), today - dt.timedelta(days=365))
    recent90 = sales.units_between(rows, today - dt.timedelta(days=89), today)
    prev90 = sales.units_between(rows, today - dt.timedelta(days=454), today - dt.timedelta(days=365))
    metrics = {"last12": last12, "prev12": prev12, "recent90": recent90, "prev90": prev90, "age_days": age_days}
    if age_days is not None and age_days < NEW_LISTING_DAYS:
        return "new", metrics
    if last12 + prev12 < MIN_UNITS_FOR_TREND:
        return "low_data", metrics
    if (prev12 >= MIN_UNITS_FOR_TREND and last12 < prev12 * DECLINE_RATIO) or (prev90 >= 6 and recent90 < prev90 * RECENT_DECLINE_RATIO):
        return "declining", metrics
    if last12 >= MIN_UNITS_FOR_TREND and prev12 > 0 and last12 >= prev12 * GROWTH_RATIO:
        return "growing", metrics
    return "stable", metrics


# ------------------------------------------------------------------ sinyaller

def shop_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Listing mağazayla birlikte mi düşüyor, yoksa ondan hızlı mı? Mağaza = listing'in KENDİSİ HARİÇ geri kalanı: çok satan
    bir listing çökünce mağaza da onunla çöker; kendisiyle kıyaslanırsa düşüş yanlışlıkla "mağaza geneli" görünürdü."""
    if c.change_pct is None or c.shop_change_pct is None:
        return [], []
    gap = c.change_pct - c.shop_change_pct
    text = tr(
        f"Son 12 ay: bu listing %{c.change_pct:+d}, mağazanın geri kalanı %{c.shop_change_pct:+d}.",
        f"Last 12 months: this listing {c.change_pct:+d}%, the rest of the shop {c.shop_change_pct:+d}%.",
    )
    if c.status != "declining":
        return [Evidence("shop", "info", text)], []
    out = [Evidence("shop", "bad", text)]
    # Uzun vade: son 12 ay, listing'in en iyi takvim yılına göre; mağazanın aynı iki dönem arasındaki değişimiyle kıyaslanır.
    # Bir listing'in asıl çöküşü son 12 ayın öncesinde olmuş olabilir; yalnızca son 12 aya bakmak onu gizler.
    long_gap = None
    years: dict[int, int] = {}
    for key, (u, _) in c.listing_monthly.items():
        if int(key[:4]) < c.today.year:
            years[int(key[:4])] = years.get(int(key[:4]), 0) + int(u)
    if years:
        best = max(years, key=years.get)
        last12 = sales.units_between(c.rows, c.today - dt.timedelta(days=364), c.today)
        shop_best = sales.shop_units_between(c.idx, dt.date(best, 1, 1), dt.date(best, 12, 31)) - years[best]
        shop_last = sales.shop_units_between(c.idx, c.today - dt.timedelta(days=364), c.today) - last12
        lp, sp = _pct(last12, years[best]), _pct(shop_last, shop_best)
        if years[best] >= MIN_UNITS_FOR_TREND and lp is not None and sp is not None and best < c.today.year - 1:
            long_gap = lp - sp
            out.append(Evidence("shop", "bad" if long_gap < -SHOP_WIDE_GAP else "info", tr(
                f"En iyi yılına ({best}: {years[best]} adet) göre bu listing %{lp:+d}, mağazanın geri kalanı aynı dönemde %{sp:+d}.",
                f"Compared with its best year ({best}: {years[best]} units) this listing is {lp:+d}%, the rest of the shop {sp:+d}% over the same period.",
            )))
    listing_specific = gap < -SHOP_WIDE_GAP or (long_gap is not None and long_gap < -SHOP_WIDE_GAP)
    if c.shop_change_pct <= -20 and not listing_specific:
        out.append(Evidence("shop", "bad", tr("Düşüş büyük ölçüde mağaza genelinde.", "The drop is mostly shop-wide.")))
        return out, [Vote("shop_wide", 2.0)]
    if c.shop_change_pct <= -20:
        out.append(Evidence("shop", "bad", tr(
            "Mağaza da düşüyor ama bu listing ondan belirgin şekilde hızlı düşüyor; farkın sebebi listing'in kendisinde.",
            "The shop is falling too, but this listing is falling clearly faster; the difference is in the listing itself.",
        )))
        return out, []
    out.append(Evidence("shop", "bad", tr("Mağaza düşmüyor; sorun bu listing'e özel.", "The shop is not falling; the problem is specific to this listing.")))
    return out, []


FIELD_LABELS = {
    "title": ("başlık", "title"), "tags": ("etiketler", "tags"), "description": ("açıklama", "description"),
    "materials": ("malzemeler", "materials"), "images": ("fotoğraflar", "photos"), "videos": ("video", "video"),
    "price": ("fiyat", "price"), "inventory": ("varyasyonlar", "variations"), "properties": ("özellikler", "attributes"),
    "personalization": ("kişiselleştirme", "personalization"), "shipping": ("kargo", "shipping"),
    "category": ("kategori", "category"), "text": ("başlık/etiket/açıklama", "title/tags/description"), "other": ("diğer", "other"),
}


def fields_text(fields: list[str]) -> str:
    return ", ".join(tr(*FIELD_LABELS.get(f, (f, f))) for f in fields)


def _changes(c: Ctx) -> list[ListingChange]:
    return list(c.db.scalars(
        select(ListingChange).where(ListingChange.shop_id == c.shop.id, ListingChange.listing_id == c.listing_id).order_by(ListingChange.published_at)
    ))


def content_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Düşüş başlangıcı çevresinde içerik değişti mi (Ulagg'dan yayınlar ve Etsy'de yapılan metin değişiklikleri)."""
    dates: list[dt.date] = []
    for ch in _changes(c):
        d = ch.published_at.date()
        dates.append(d)
        what = fields_text(json.loads(ch.fields or "[]"))
        c.events.append({"date": d.isoformat(), "kind": "content", "text": tr(
            f"Etsy'de değiştirildi: {what}" if ch.source == "etsy" else f"Ulagg'dan yayınlandı: {what}",
            f"Changed on Etsy: {what}" if ch.source == "etsy" else f"Published from Ulagg: {what}",
        )})
    if not c.decline_start:
        return [], []
    start = dt.date(int(c.decline_start[:4]), int(c.decline_start[5:]), 1)
    near = [d for d in sorted(dates) if start - dt.timedelta(days=60) <= d <= start + dt.timedelta(days=45)]
    if near:
        return [Evidence("content", "bad", tr(
            f"Düşüş {near[0].isoformat()} tarihli bir içerik değişikliğinin hemen ardından başlıyor; o değişiklik görünürlüğü bozmuş olabilir.",
            f"The drop starts right after a content change on {near[0].isoformat()}; that change may have hurt visibility.",
        ))], [Vote("visibility", 1.5)]
    return [], []


_METRIC_LABEL = {"views": ("görüntülenme", "views"), "favorites": ("favori", "favorites"), "units": ("satış", "sales")}


def impact_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Son değişikliğin ölçülen sonucu (insights/impact.py): işe yaradı mı, henüz erken mi?"""
    rows = _changes(c)
    if not rows:
        return [], []
    ch = rows[-1]
    r = json.loads(ch.result_json) if ch.result_json else {}
    fields = json.loads(ch.fields or "[]")
    what, day = fields_text(fields), ch.published_at.date().isoformat()
    if r.get("status") == "waiting" or not r:
        days = (c.today - ch.published_at.date()).days
        return [Evidence("impact", "info", tr(
            f"Son değişiklik {days} gün önce yayınlandı ({what}). Sonucu en erken {max(impact.MIN_WINDOW - days, 1)} gün sonra ölçülür; o zamana kadar yeni değişiklik ölçümü karıştırır.",
            f"The last change was published {days} days ago ({what}). Its effect can be measured in {max(impact.MIN_WINDOW - days, 1)} days at the earliest; another change before then will muddy the result.",
        ))], []
    if r.get("status") != "measured" or r.get("verdict") == "low_data":
        return [], []
    metric, net = r["metric"], r["net"][r["metric"]] or 0
    label = tr(*_METRIC_LABEL[metric])
    verdict = r["verdict"]
    if verdict == "better":
        return [Evidence("impact", "good", tr(
            f"{day} tarihli değişiklik ({what}) işe yaradı: {label} dokunulmamış benzer listing'lere göre %{net:+d}.",
            f"The change on {day} ({what}) worked: {label} {net:+d}% relative to similar untouched listings.",
        ))], []
    if verdict == "unclear":
        return [Evidence("impact", "info", tr(
            f"{day} tarihli değişiklikten ({what}) sonra {label} %{net:+d} değişti ama veri tesadüften ayırt etmeye yetmiyor; biraz daha bekle.",
            f"After the change on {day} ({what}), {label} changed {net:+d}%, but there is not enough data to rule out chance yet; wait a little longer.",
        ))], []
    if verdict == "same":
        return [Evidence("impact", "info", tr(
            f"{day} tarihli değişiklik ({what}) belirgin bir fark yaratmadı ({label} %{net:+d}). Aynı alanı tekrar değiştirmek yerine başka bir aşamaya bak.",
            f"The change on {day} ({what}) made no clear difference ({label} {net:+d}%). Look at another stage instead of changing the same fields again.",
        ))], []
    votes = []
    if {"title", "tags", "text", "category", "properties"} & set(fields):
        votes.append(Vote("visibility", 1.0))
    if "images" in fields:
        votes.append(Vote("appeal", 1.0))
    if {"price", "inventory", "description"} & set(fields):
        votes.append(Vote("conversion", 1.0))
    return [Evidence("impact", "bad", tr(
        f"{day} tarihli değişiklikten ({what}) sonra {label} dokunulmamış benzer listing'lere göre %{net:+d} düştü; o değişikliği gözden geçir ya da geri al.",
        f"After the change on {day} ({what}), {label} fell {net:+d}% relative to similar untouched listings; review or revert that change.",
    ))], votes


def price_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Ortalama satış fiyatı düşüş başlangıcı çevresinde değişti mi (sipariş geçmişinden, rapor para biriminde)."""
    if not c.decline_start:
        return [], []

    def avg_price(keys: list[str]) -> float | None:
        u = sum(c.listing_monthly.get(k, [0, 0])[0] for k in keys)
        r = sum(c.listing_monthly.get(k, [0, 0])[1] for k in keys)
        return r / u if u >= 3 else None

    before = avg_price([sales.add_months(c.decline_start, -i) for i in range(1, 7)])
    after = avg_price([sales.add_months(c.decline_start, i) for i in range(0, 6)])
    if before is None or after is None:
        return [], []
    change = (after - before) / before
    if change >= PRICE_CHANGE:
        return [Evidence("price", "bad", tr(
            f"Ortalama satış fiyatı düşüşle birlikte %{round(change * 100)} arttı ({before:.0f} → {after:.0f}).",
            f"The average sale price rose {round(change * 100)}% along with the drop ({before:.0f} → {after:.0f}).",
        ))], [Vote("conversion", 1.0)]
    if change <= -PRICE_CHANGE:
        return [Evidence("price", "info", tr(
            f"Ortalama satış fiyatı %{abs(round(change * 100))} düştü ama satış toparlanmadı; sorun fiyattan çok görünürlükte olabilir.",
            f"The average sale price fell {abs(round(change * 100))}% but sales did not recover; the issue may be visibility more than price.",
        ))], [Vote("visibility", 0.5)]
    return [], []


def review_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Düşük puanlı yorumlar ve son yıldaki ortalama puan."""
    rows = c.db.execute(select(ReviewCache.rating, ReviewCache.created_at).where(
        ReviewCache.shop_id == c.shop.id, ReviewCache.listing_id == c.listing_id
    )).all()
    if not rows:
        return [], []
    year_ago = dt.datetime.combine(c.today - dt.timedelta(days=365), dt.time())
    recent = [r for r, at in rows if at >= year_ago]
    bad = sorted(at.date() for r, at in rows if r <= 3)
    for d in bad:
        c.events.append({"date": d.isoformat(), "kind": "review", "text": tr("Düşük puanlı yorum (3 ve altı)", "Low rating (3 or below)")})
    out: list[Evidence] = []
    votes: list[Vote] = []
    if recent:
        avg = sum(recent) / len(recent)
        tone = "bad" if avg < 4.5 else "good"
        out.append(Evidence("reviews", tone, tr(
            f"Son 12 ayda {len(recent)} yorum, ortalama {avg:.1f}.", f"{len(recent)} reviews in the last 12 months, average {avg:.1f}.",
        )))
        if avg < 4.5:
            votes.append(Vote("conversion", 1.0))
    if c.decline_start:
        start = dt.date(int(c.decline_start[:4]), int(c.decline_start[5:]), 1)
        near = [d for d in bad if start - dt.timedelta(days=120) <= d <= start + dt.timedelta(days=30)]
        if near:
            out.append(Evidence("reviews", "bad", tr(
                f"Düşüşten hemen önce {len(near)} düşük puanlı yorum gelmiş; alıcılar sayfada bunları görüyor.",
                f"{len(near)} low ratings arrived just before the drop; buyers see them on the page.",
            )))
            votes.append(Vote("conversion", 1.0))
    return out, votes


_FUNNEL = {"seo": "visibility", "appeal": "appeal", "conversion": "conversion"}


def funnel_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Sağlık değerlendirmesi: görüntülenme, favori oranı ve dönüşümün mağaza medyanına göre nerede zayıf olduğu."""
    h = listing_health.get_listing_health(c.db, c.shop, c.listing_id)
    if h is None or not h.bottleneck:
        return [], []
    cause = _FUNNEL.get(h.bottleneck)
    text = {
        "visibility": tr("Günlük görüntülenme mağaza ortalamasının çok altında: listing aramada az görünüyor.", "Daily views are far below the shop average: the listing shows up little in search."),
        "appeal": tr("Görüntüleniyor ama favoriye dönmüyor: kapak fotoğrafı ya da başlık çekmiyor.", "It gets views but few favorites: the main photo or title is not attracting buyers."),
        "conversion": tr("Favori alıyor ama satışa dönmüyor: fiyat, açıklama ya da varyasyonlar engel olabilir.", "It gets favorites but few sales: price, description or variations may be in the way."),
    }.get(cause or "", "")
    return ([Evidence("funnel", "bad", text)], [Vote(cause, 1.5)]) if cause else ([], [])


FIRST_PAGE = 48  # Etsy arama sonuçlarının ilk sayfası


def rank_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Sıra takibi: listing takip edilen aramalarda kayboluyor mu, yoksa görünüp satmıyor mu? Rakip fiyatlarıyla kıyas."""
    from app.insights import rank

    data = rank.listing_ranks(c.db, c.shop, c.listing_id, days=60, today=c.today)
    measured = [k for k in data["keywords"] if k["measured"]]
    if not measured:
        if data["is_tracked"]:
            return [Evidence("rank", "info", tr("Sıra takibi açık; ilk ölçüm bekleniyor.", "Rank tracking is on; waiting for the first measurement."))], []
        return [], []
    out: list[Evidence] = []
    for k in measured:
        pos = tr(f"{k['position']}. sırada", f"position {k['position']}") if k["position"] else tr(f"ilk {data['max_results']} sonuçta yok", f"not in the top {data['max_results']}")
        ch = k["change_30d"]
        move = ""
        if ch is not None and ch != 0:
            move = tr(f", 30 günde {abs(ch)} sıra {'yükseldi' if ch > 0 else 'düştü'}", f", {'up' if ch > 0 else 'down'} {abs(ch)} places in 30 days")
        lost = k["position"] is None or (ch is not None and ch <= -10)
        tone = "bad" if lost else "good" if k["position"] and k["position"] <= FIRST_PAGE else "info"
        total_tr = f"{k['total_results']:,}".replace(",", ".")
        out.append(Evidence("rank", tone, tr(
            f"\"{k['keyword']}\" aramasında {pos}{move} ({total_tr} listing).",
            f"For \"{k['keyword']}\": {pos}{move} ({k['total_results']:,} listings).",
        )))
    votes: list[Vote] = []
    lost = [k for k in measured if k["position"] is None or (k["change_30d"] is not None and k["change_30d"] <= -10)]
    visible = [k for k in measured if k["position"] and k["position"] <= FIRST_PAGE]
    if c.status == "declining":
        if len(lost) * 2 >= len(measured):
            votes.append(Vote("visibility", 2.0))
        elif visible:
            out.append(Evidence("rank", "bad", tr(
                "Aramanın ilk sayfasında görünüyor ama satış düşük: alıcılar görüyor, tıklamıyor ya da satın almıyor.",
                "It shows on the first page of search but sales are low: buyers see it but do not click or buy.",
            )))
            votes.append(Vote("appeal", 1.0))
    priced = next((k for k in measured if k["top_price_median"] and k["own_price"]), None)
    if priced:
        ratio = priced["own_price"] / priced["top_price_median"]
        cur = priced["currency"]
        if ratio >= 1.3:
            out.append(Evidence("price", "bad", tr(
                f"Fiyatın ({priced['own_price']:.0f} {cur}) ilk 20 rakibin ortanca fiyatının (%{round((ratio - 1) * 100)}) üstünde ({priced['top_price_median']:.0f} {cur}).",
                f"Your price ({priced['own_price']:.0f} {cur}) is {round((ratio - 1) * 100)}% above the median of the top 20 competitors ({priced['top_price_median']:.0f} {cur}).",
            )))
            if c.status == "declining":
                votes.append(Vote("conversion", 1.0))
        elif ratio <= 0.7:
            out.append(Evidence("price", "info", tr(
                f"Fiyatın ilk 20 rakibin ortancasından düşük ({priced['own_price']:.0f} / {priced['top_price_median']:.0f} {cur}); fiyat engel görünmüyor.",
                f"Your price is below the top 20 competitors' median ({priced['own_price']:.0f} / {priced['top_price_median']:.0f} {cur}); price does not look like the blocker.",
            )))
    return out, votes


def etsy_data_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Kullanıcının yapıştırdığı Etsy verisi: listing'i getiren aramalar ve aranan ama görünülmeyen kelimeler."""
    from app.insights import etsy_data, rank

    rows = etsy_data.for_listing(c.db, c.shop, c.listing_id)
    if not rows:
        return [], []
    out: list[Evidence] = []
    votes: list[Vote] = []
    bring = [r for r in rows if r["source"] in ("search_terms", "ads") and r["listing_id"] == c.listing_id and (r["orders"] or r["clicks"] or r["views"])]
    if bring:
        top = ", ".join(f"\"{r['keyword']}\"" for r in bring[:3])
        out.append(Evidence("etsy", "info", tr(f"Etsy verisine göre listing'i en çok getiren aramalar: {top}.", f"According to Etsy data, the searches bringing the most traffic: {top}.")))
    ranks = {k["keyword"]: k for k in rank.listing_ranks(c.db, c.shop, c.listing_id, days=30, today=c.today)["keywords"] if k["measured"]}
    hidden = [r for r in rows if r["source"] == "marketplace_insights" and (r["searches"] or 0) >= 500 and r["keyword"] in ranks and ranks[r["keyword"]]["position"] is None]
    if hidden:
        r = hidden[0]
        out.append(Evidence("etsy", "bad", tr(
            f"\"{r['keyword']}\" Etsy'de ayda {r['searches']} kez aranıyor ama listing ilk {rank.MAX_RESULTS} sonuçta yok.",
            f"\"{r['keyword']}\" is searched {r['searches']} times a month on Etsy, but the listing is not in the top {rank.MAX_RESULTS}.",
        )))
        if c.status == "declining":
            votes.append(Vote("visibility", 1.0))
    return out, votes


def demand_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Google'daki talep geçen yıla göre: talep de düştüyse sebep talep, aynı kaldıysa sorun listing'de."""
    from app.insights import demand
    from app.insights.models import TrackedKeyword

    keywords = [k for (k,) in c.db.execute(select(TrackedKeyword.keyword).where(
        TrackedKeyword.shop_id == c.shop.id, TrackedKeyword.listing_id == c.listing_id, TrackedKeyword.active.is_(True)
    ))]
    rows = [r for r in demand.for_keywords(c.db, keywords).values() if r.yoy_pct is not None]
    if not rows:
        return [], []
    parts = ", ".join(f"\"{r.keyword}\" %{r.yoy_pct:+d}" for r in rows)
    parts_en = ", ".join(f"\"{r.keyword}\" {r.yoy_pct:+d}%" for r in rows)
    avg = sum(r.yoy_pct for r in rows) / len(rows)
    if avg <= -25:
        ev = Evidence("demand", "bad", tr(
            f"Google'da bu aramalara ilgi geçen yıla göre düşmüş ({parts}); düşüşün bir kısmı talepten.",
            f"Google interest in these searches is down from last year ({parts_en}); part of the drop is demand.",
        ))
        return [ev], ([Vote("demand", 1.5)] if c.status == "declining" else [])
    if avg >= -10:
        tone = "bad" if c.status == "declining" else "info"
        return [Evidence("demand", tone, tr(
            f"Google'da bu aramalara ilgi geçen yılla aynı ya da daha yüksek ({parts}); talep yerinde, sorun listing'de.",
            f"Google interest in these searches is flat or up from last year ({parts_en}); demand is there, the problem is the listing.",
        ))], []
    return [Evidence("demand", "info", tr(f"Google'da ilgi geçen yıla göre biraz düşük ({parts}).", f"Google interest is somewhat lower than last year ({parts_en})."))], []


SIGNALS: list[Signal] = [shop_signal, content_signal, impact_signal, price_signal, review_signal, funnel_signal, rank_signal, etsy_data_signal, demand_signal]


# ------------------------------------------------------------------ sonuç

def _headline(status: str, cause: str | None, m: dict, change_pct: float | None) -> str:
    if status == "new":
        return tr("Yeni listing", "New listing")
    if status == "low_data":
        return tr("Yeterli satış geçmişi yok", "Not enough sales history")
    if status == "growing":
        return tr(f"Yükselişte (%{change_pct:+d})", f"Growing ({change_pct:+d}%)") if change_pct is not None else tr("Yükselişte", "Growing")
    if status == "stable":
        return tr("Sabit", "Stable")
    label = {
        "visibility": tr("görünürlük düştü", "visibility dropped"),
        "appeal": tr("tıklanmıyor", "not getting clicks"),
        "conversion": tr("satışa dönmüyor", "not converting"),
        "shop_wide": tr("mağaza genelinde düşüş", "shop-wide decline"),
        "demand": tr("talep düştü", "demand dropped"),
    }.get(cause or "", tr("sebep belirsiz", "cause unclear"))
    pct = f" (%{change_pct:+d})" if change_pct is not None else ""
    return tr(f"Düşüşte{pct}: {label}", f"Declining{pct}: {label}")


def diagnose(db: Session, shop: Shop, listing_id: int, today: dt.date | None = None) -> dict | None:
    today = today or dt.date.today()
    row = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id, ListingCache.listing_id == listing_id)).one_or_none()
    if row is None:
        return None
    raw = json.loads(row.raw_json)
    digital = raw.get("listing_type") == "download"
    idx = sales.index(db, shop)
    rows = idx.get(listing_id, [])
    lm, sm = sales.monthly(rows), sales.shop_monthly(idx)
    status, metrics = _status(raw, rows, today)
    # Mağazanın geri kalanı (listing hariç): bkz. shop_signal
    shop_last = sales.shop_units_between(idx, today - dt.timedelta(days=364), today) - metrics["last12"]
    shop_prev = sales.shop_units_between(idx, today - dt.timedelta(days=729), today - dt.timedelta(days=365)) - metrics["prev12"]
    change_pct = _pct(metrics["last12"], metrics["prev12"])
    shop_change_pct = _pct(shop_last, shop_prev)
    decline_start = _decline_start(lm, today) if status == "declining" else None
    c = Ctx(db, shop, listing_id, raw, today, idx, rows, lm, sm, status, change_pct, shop_change_pct, decline_start)

    evidence: list[Evidence] = []
    weights: dict[str, float] = {}
    for signal in SIGNALS:
        ev, votes = signal(c)
        evidence += ev
        for v in votes:
            weights[v.cause] = weights.get(v.cause, 0.0) + v.weight

    cause = max(weights, key=weights.get) if status == "declining" and weights else None
    strength = weights.get(cause, 0.0) if cause else 0.0
    confidence = "high" if strength >= 2.5 else "medium" if strength >= 1.5 else "low"

    peak_key = max(lm, key=lambda k: lm[k][0]) if lm else None
    sales_lines = []
    if peak_key and lm[peak_key][0] >= 5:
        sales_lines.append(Evidence("sales", "info", tr(
            f"Zirve: {peak_key} ayında {int(lm[peak_key][0])} adet. Son 12 ayda toplam {metrics['last12']}, önceki 12 ayda {metrics['prev12']}.",
            f"Peak: {int(lm[peak_key][0])} units in {peak_key}. {metrics['last12']} units in the last 12 months, {metrics['prev12']} in the 12 before.",
        )))
    if decline_start:
        sales_lines.append(Evidence("sales", "bad", tr(f"Düşüş {decline_start} civarında başlamış.", f"The drop started around {decline_start}.")))

    season = seasonality.season(lm, sm, today)
    # Tek sıradaki adım: teşhis, huni sağlığı, son değişikliğin sonucu, fiyat ve sıra birlikte (bkz. insights/next_step.py).
    step = next_step.decide(db, shop.id, listing_id, today, status, cause, season, digital, _changes(c), fields_text, idx)

    end_key = sales.ym(today)
    months = [{"month": k, "units": int(lm.get(k, [0, 0])[0]), "prev_year_units": int(lm.get(sales.add_months(k, -12), [0, 0])[0])} for k in sales.month_range(end_key, 24)]
    return {
        "listing_id": listing_id,
        "status": status,
        "cause": cause,
        "confidence": confidence if cause else None,
        "headline": _headline(status, cause, metrics, change_pct),
        # Eski alan adı korunur (pano kartı, yayın kaydının odağı): key = AI/ölçüm odağı, text = sıradaki adım.
        "action": {"key": step["focus"], "text": step["text"]},
        "next_step": step,
        "digital": digital,
        "metrics": {**metrics, "change_pct": change_pct, "shop_change_pct": shop_change_pct, "peak_month": peak_key, "peak_units": int(lm[peak_key][0]) if peak_key else 0},
        "decline_start": decline_start,
        "season": season,
        "months": months,
        # Takvim yılına göre satış (24 aylık grafiğin göremediği uzun dönem: "eskiden satıyordu, söndü")
        "years": [{"year": y, "units": u} for y, u in sorted(_years(rows, today).items())],
        "evidence": [e.__dict__ for e in sales_lines + evidence],
        "events": sorted(c.events, key=lambda e: e["date"], reverse=True)[:20],
        "last_change": _last_change_out(c),
    }


def _years(rows: list, today: dt.date) -> dict[int, int]:
    """Listing'in ilk satış yılından bu yıla her takvim yılının satış adedi (satışsız yıllar 0)."""
    if not rows:
        return {}
    out = {y: 0 for y in range(rows[0][0].year, today.year + 1)}
    for day, units, _ in rows:
        out[day.year] = out.get(day.year, 0) + units
    return out


def _last_change_out(c: Ctx) -> dict | None:
    """Son değişiklik ve ölçüm durumu (editörde "henüz erken" uyarısı ve yapay zekâ özeti için)."""
    rows = _changes(c)
    if not rows:
        return None
    ch = rows[-1]
    return {
        "published_at": ch.published_at.isoformat(),
        "days_ago": (c.today - ch.published_at.date()).days,
        "fields": json.loads(ch.fields or "[]"),
        "details": json.loads(ch.details or "{}"),
        "source": ch.source,
        "result": json.loads(ch.result_json) if ch.result_json else None,
    }


def prompt_brief(d: dict) -> str:
    """AI önerisine giden teşhis özeti (modele; Türkçe yeterli): satış düşüşünün sebebi ve son değişikliğin sonucu."""
    if not d:
        return ""
    parts = []
    step = d.get("next_step") or {}
    lines = [f"- {e['text']}" for e in d["evidence"][:6]]
    if lines:
        parts.append("Bu listing'in satış teşhisi:\n" + "\n".join(lines))
    focus = {
        "title_tags": "Bu turun hamlesi: başlık ve etiketler (aramada görünürlük). Başlık Etsy rehberine uygun, kısa ve net olsun; etiketler ve açıklamanın ilk cümleleri ürünü arayanın kullandığı kelimelerle anlatsın; satış getiren eski etiketleri koru."
        + (f" Listing'in görünmediği takip edilen aramalar: {', '.join(step['keywords'])}; ürüne uyuyorsa başlıkta ya da etiketlerde kullan." if step.get("keywords") else "")
        + (" Mağazada neredeyse aynı başlıklı listing var (" + "; ".join(f'"{x["title"]}"' for x in step["duplicates"]) + "): bu listing'i onlardan FARKLI bir ana aramaya yönelt (boyut, kullanım yeri, stil, alıcı); aynı ana öbeği kullanma." if step.get("duplicates") else ""),
        "description": (
            "Bu turun hamlesi: açıklama (satın alma). Bu dijital (indirilebilir) bir ürün: açıklama ilk paragraflarda alıcının sorularını cevaplasın "
            "(dosya biçimi, çözünürlük/boyut, kaç dosya, nasıl indirilip kullanılacağı, kullanım hakkı); kargo/teslim süresinden söz etme. Başlıkta büyük değişiklik yapma."
            if d.get("digital") else
            "Bu turun hamlesi: açıklama (satın alma). Açıklama alıcının sorularını (ölçü, malzeme, kişiselleştirme, teslim) ilk paragraflarda cevaplasın. Başlıkta büyük değişiklik yapma."
        ),
        "overhaul": "Bu listing eskiden satıp sönmüş; kapsamlı yenileme turu. Başlığı, etiketleri ve açıklamayı bugünün Etsy aramalarına göre baştan kur (ürünün ne olduğunu anlatan ana öbeği koru ama eski, artık aranmayan ifadeleri bırak); açıklamanın ilk paragrafı alıcının sorularını cevaplasın. Gerekçede kapak fotoğrafını ve fiyatı da yenilemesini öner.",
        "photo": "Bu turun asıl hamlesi kapak fotoğrafı, metin değil. Aynı anda iki şey değişirse hangisinin işe yaradığı ölçülemez: başlığı ve etiketleri büyük ölçüde koru, yalnızca açık hataları düzelt; gerekçede kapak fotoğrafını değiştirmesini öner.",
        "price": "Bu turun asıl hamlesi fiyat, metin değil. Aynı anda iki şey değişirse hangisinin işe yaradığı ölçülemez: başlığı, etiketleri ve açıklamayı büyük ölçüde koru, yalnızca açık hataları düzelt.",
        "shop": "Sorun büyük ölçüde mağaza genelinde; metni yine de Etsy kurallarına göre iyileştir ama gerekçede tek başına yetmeyeceğini belirt.",
        "track": "Sebep net değil; Etsy kurallarına göre dengeli bir iyileştirme yap.",
        "demand": "Talep genel olarak düşmüş; ürünün farklı kullanım/alıcı aramalarını etiketlerle yakala.",
        "keep": "Listing'de belirgin bir zayıf nokta yok: büyük değişiklik yapma, yalnızca Etsy kurallarına aykırı açık hataları düzelt ve iyi çalışan kısımları koru.",
        "keep_working": "Son değişiklik işe yaradı: büyük değişiklik yapma, iyi çalışan kısımları koru.",
        "keep_peak": "Satış zirvesindeyiz: büyük değişiklik yapma, yalnızca açık hataları düzelt.",
        "deactivate": "Bu listing birkaç denemeye rağmen zayıf; son bir kez dengeli bir iyileştirme yap ve gerekçede durdurmanın da düşünülebileceğini belirt.",
    }.get(step.get("key", ""), "")
    if focus:
        parts.append(focus)
    lc = d.get("last_change")
    if lc:
        parts.append(_change_brief(lc))
    return "\n\n".join(p for p in parts if p)


def _change_brief(lc: dict) -> str:
    """Son değişikliğin sonucu, modelin aynı hatayı tekrarlamaması ya da işe yarayanı bozmaması için."""
    names = {k: v[0] for k, v in FIELD_LABELS.items()}
    what = ", ".join(names.get(f, f) for f in lc["fields"])
    det, r = lc.get("details") or {}, lc.get("result") or {}
    head = f"Son değişiklik {lc['days_ago']} gün önce yayınlandı ({what})."
    if det.get("tags_removed"):
        head += f" O değişiklikte çıkarılan etiketler: {', '.join(det['tags_removed'])}."
    if det.get("title_before"):
        head += f' Önceki başlık: "{det["title_before"]}".'
    status, verdict = r.get("status"), r.get("verdict")
    if status in (None, "waiting"):
        return head + " Sonucu henüz ölçülmedi: büyük değişiklik yapma, yalnızca açık hataları düzelt ve iyi çalışan kısımları koru; gerekçede bunu belirt."
    if status != "measured" or verdict == "low_data":
        return head
    label = {"views": "görüntülenme", "favorites": "favori", "units": "satış"}[r["metric"]]
    net = r["net"][r["metric"]] or 0
    if verdict == "better":
        return head + f" Sonuç: {label} dokunulmamış benzer listing'lere göre %{net:+d} — işe yaradı. Aynı yönü koru, o değişikliği bozma; yalnızca kalan zayıf noktaları iyileştir."
    if verdict == "worse":
        return head + f" Sonuç: {label} dokunulmamış benzer listing'lere göre %{net:+d} — kötüleşti. O değişiklikte kaybedilen satış getiren kelimeleri (çıkarılan etiketler, önceki başlıktaki ana öbek) geri getirmeyi değerlendir; gerekçede bunu açıkla."
    if verdict == "unclear":
        return head + f" Sonuç henüz belirsiz ({label} %{net:+d}, veri yetersiz): büyük değişiklik yapma, iyi çalışan kısımları koru."
    return head + f" Sonuç: belirgin fark yok ({label} %{net:+d}). Aynı alanları aynı şekilde yeniden yazmak yerine farklı bir yaklaşım dene; gerekçede neyi farklı yaptığını açıkla."


# ------------------------------------------------------------------ mağaza geneli: dikkat isteyen listing'ler

_attention_cache = ResultCache(max_items=50)


def attention(db: Session, shop: Shop, today: dt.date | None = None, limit: int = 5) -> dict:
    """Düşüşteki aktif listing'ler (en çok satış kaybedenden başlayarak) ve ilk `limit` tanesinin tam teşhisi.
    Dashboard kartı ve "Düşüşte" filtresi için. Sipariş verisi ve gün değişmedikçe önbellekten döner."""
    today = today or dt.date.today()
    key = (shop.id, today.isoformat(), performance._orders_version(db, shop), get_lang())
    cached = _attention_cache.get(key)
    if cached is not None:
        return cached
    _attention_cache.drop_shop(shop.id)
    idx = sales.index(db, shop)
    declining: list[tuple[int, int, str]] = []
    for lid, title, raw_json in db.execute(select(ListingCache.listing_id, ListingCache.title, ListingCache.raw_json).where(ListingCache.shop_id == shop.id)):
        raw = json.loads(raw_json)
        if raw.get("state") != "active":
            continue
        status, m = _status(raw, idx.get(lid, []), today)
        if status == "declining":
            declining.append((lid, m["prev12"] - m["last12"], html.unescape(title or "")))
    declining.sort(key=lambda x: -x[1])
    items = []
    for lid, lost, title in declining[:limit]:
        d = diagnose(db, shop, lid, today)
        if d:
            items.append({"listing_id": lid, "title": title, "lost_units": lost, "headline": d["headline"], "action": d["action"], "season": d["season"]})
    result = {"items": items, "declining_ids": [lid for lid, _, _ in declining], "declining_count": len(declining)}
    _attention_cache.set(key, result)
    return result

"""Düşüş teşhisi: "bu listing neden düştü, ne yapmalı?"

Önce satış eğrisi kurulur (son 12 ay ile önceki 12 ay, son 90 gün ile geçen yılın aynı 90 günü; mevsim etkisi böylece
ayrılır) ve listing'in durumu belirlenir: yeni / az veri / düşüşte / sabit / yükselişte. Ardından her sinyal kendi
kanıtını ve (varsa) bir sebep oyunu verir; en güçlü oy teşhisin sebebi olur. Sinyaller birbirinden bağımsızdır ve
`SIGNALS` listesine eklenerek çoğaltılır (sıra takibi, talep, Etsy verisi sonraki adımlarda buraya bağlanır).

Hiçbir sinyal Etsy'ye istek atmaz; yalnızca yerel veri (sipariş geçmişi, günlük görüntülenme kayıtları, sürüm geçmişi,
yorumlar, sağlık değerlendirmesi) kullanılır."""
import datetime as dt
import json
from dataclasses import dataclass, field
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.insights import sales, seasonality
from app.listings import health as listing_health
from app.listings import performance
from app.listings.models import ListingCache, ListingVersion
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
    """Listing mağazayla birlikte mi düşüyor, yoksa ondan hızlı mı?"""
    if c.change_pct is None or c.shop_change_pct is None:
        return [], []
    gap = c.change_pct - c.shop_change_pct
    text = tr(
        f"Son 12 ay: bu listing %{c.change_pct:+d}, mağazanın tamamı %{c.shop_change_pct:+d}.",
        f"Last 12 months: this listing {c.change_pct:+d}%, the whole shop {c.shop_change_pct:+d}%.",
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
        shop_best = sales.shop_units_between(c.idx, dt.date(best, 1, 1), dt.date(best, 12, 31))
        shop_last = sales.shop_units_between(c.idx, c.today - dt.timedelta(days=364), c.today)
        lp, sp = _pct(last12, years[best]), _pct(shop_last, shop_best)
        if years[best] >= MIN_UNITS_FOR_TREND and lp is not None and sp is not None and best < c.today.year - 1:
            long_gap = lp - sp
            out.append(Evidence("shop", "bad" if long_gap < -SHOP_WIDE_GAP else "info", tr(
                f"En iyi yılına ({best}: {years[best]} adet) göre bu listing %{lp:+d}, mağaza aynı dönemde %{sp:+d}.",
                f"Compared with its best year ({best}: {years[best]} units) this listing is {lp:+d}%, the shop {sp:+d}% over the same period.",
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


def content_signal(c: Ctx) -> tuple[list[Evidence], list[Vote]]:
    """Düşüş başlangıcı çevresinde içerik değişti mi (uygulamadan yayınlanan değişiklikler ve Etsy'de görülen değişiklikler)."""
    dates: list[tuple[dt.date, str]] = []
    for applied in c.db.scalars(select(ListingVersion.applied_at).where(
        ListingVersion.shop_id == c.shop.id, ListingVersion.listing_id == c.listing_id, ListingVersion.status == "applied", ListingVersion.applied_at.is_not(None)
    )):
        dates.append((applied.date(), "app"))
    prev_hash = None
    for s in performance._snapshots(c.db, c.shop.id, c.listing_id):
        if s.content_hash and prev_hash and s.content_hash != prev_hash:
            dates.append((s.captured_at.date(), "etsy"))
        prev_hash = s.content_hash or prev_hash
    for d, src in sorted(set(dates)):
        c.events.append({"date": d.isoformat(), "kind": "content", "text": tr(
            "İçerik değişti (Ulagg'dan yayınlandı)" if src == "app" else "İçerik değişti (Etsy'de)",
            "Content changed (published from Ulagg)" if src == "app" else "Content changed (on Etsy)",
        )})
    if not c.decline_start:
        return [], []
    start = dt.date(int(c.decline_start[:4]), int(c.decline_start[5:]), 1)
    near = [d for d, _ in dates if start - dt.timedelta(days=60) <= d <= start + dt.timedelta(days=45)]
    if near:
        return [Evidence("content", "bad", tr(
            f"Düşüş {near[0].isoformat()} tarihli bir içerik değişikliğinin hemen ardından başlıyor; o değişiklik görünürlüğü bozmuş olabilir.",
            f"The drop starts right after a content change on {near[0].isoformat()}; that change may have hurt visibility.",
        ))], [Vote("visibility", 1.5)]
    return [], []


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


SIGNALS: list[Signal] = [shop_signal, content_signal, price_signal, review_signal, funnel_signal]


# ------------------------------------------------------------------ sonuç

def _action(cause: str | None, status: str) -> dict:
    if status in ("new", "low_data"):
        return {"key": "wait", "text": tr("Henüz yeterli satış geçmişi yok; değişiklik için veri birikmesini bekle.", "Not enough sales history yet; wait for more data before changing things.")}
    if status != "declining":
        return {"key": "keep", "text": tr("Satış düşmüyor; büyük bir değişiklik gerekmiyor.", "Sales are not falling; no big change is needed.")}
    return {
        "visibility": {"key": "seo", "text": tr("Başlık, etiketler ve özellikler: listing aramada eskisi kadar görünmüyor.", "Title, tags and attributes: the listing is not showing up in search as before.")},
        "appeal": {"key": "appeal", "text": tr("Kapak fotoğrafı ve başlık: görülüyor ama tıklanmıyor.", "Main photo and title: it is seen but not clicked.")},
        "conversion": {"key": "conversion", "text": tr("Fiyat, açıklama ve varyasyonlar: ilgi var ama satışa dönmüyor.", "Price, description and variations: there is interest but it does not turn into sales.")},
        "shop_wide": {"key": "shop", "text": tr(
            "Sorun büyük ölçüde mağaza genelinde. Listing metnini değiştirmek tek başına yetmez: mağaza puanına, teslim süresine, fiyatlara ve reklam ayarlarına bak.",
            "The problem is mostly shop-wide. Changing this listing's text alone will not fix it: check your shop rating, processing times, prices and ad settings.",
        )},
        "demand": {"key": "demand", "text": tr("Bu ürüne olan talep genel olarak düşmüş; listing'i değiştirmek sınırlı fayda sağlar.", "Demand for this product has dropped overall; changing the listing will help only a little.")},
    }.get(cause or "", {"key": "track", "text": tr(
        "Sebep henüz net değil. Listing'i sıra takibine al: aramada mı kayboluyor, yoksa görünüp satmıyor mu, netleşsin.",
        "The cause is not clear yet. Add the listing to rank tracking to see whether it is losing search position or being seen without selling.",
    )})


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
    idx = sales.index(db, shop)
    rows = idx.get(listing_id, [])
    lm, sm = sales.monthly(rows), sales.shop_monthly(idx)
    status, metrics = _status(raw, rows, today)
    shop_last = sales.shop_units_between(idx, today - dt.timedelta(days=364), today)
    shop_prev = sales.shop_units_between(idx, today - dt.timedelta(days=729), today - dt.timedelta(days=365))
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

    end_key = sales.ym(today)
    months = [{"month": k, "units": int(lm.get(k, [0, 0])[0]), "prev_year_units": int(lm.get(sales.add_months(k, -12), [0, 0])[0])} for k in sales.month_range(end_key, 24)]
    return {
        "listing_id": listing_id,
        "status": status,
        "cause": cause,
        "confidence": confidence if cause else None,
        "headline": _headline(status, cause, metrics, change_pct),
        "action": _action(cause, status),
        "metrics": {**metrics, "change_pct": change_pct, "shop_change_pct": shop_change_pct, "peak_month": peak_key, "peak_units": int(lm[peak_key][0]) if peak_key else 0},
        "decline_start": decline_start,
        "season": seasonality.season(lm, sm, today),
        "months": months,
        "evidence": [e.__dict__ for e in sales_lines + evidence],
        "events": sorted(c.events, key=lambda e: e["date"], reverse=True)[:20],
    }


def prompt_brief(d: dict) -> str:
    """AI önerisine giden teşhis özeti (modele; Türkçe yeterli)."""
    if not d or d["status"] != "declining":
        return ""
    focus = {
        "seo": "Odak: aramada görünürlük. Başlık (Etsy rehberine uygun, kısa ve net), etiketler ve açıklamanın ilk cümleleri ürünü arayanın kullandığı kelimelerle anlatsın; satış getiren eski etiketleri koru.",
        "appeal": "Odak: tıklanma. Başlık ilk 40 karakterde ürünü net ve çekici anlatsın; kapak fotoğrafının da değişmesi gerektiğini gerekçede belirt.",
        "conversion": "Odak: satın alma. Açıklama alıcının sorularını (ölçü, malzeme, kişiselleştirme, teslim) ilk paragraflarda cevaplasın; fiyat/varyasyon gözden geçirilmeli diye gerekçede belirt.",
        "shop": "Sorun büyük ölçüde mağaza genelinde; metni yine de Etsy kurallarına göre iyileştir ama gerekçede tek başına yetmeyeceğini belirt.",
        "track": "Sebep net değil; Etsy kurallarına göre dengeli bir iyileştirme yap.",
        "demand": "Talep genel olarak düşmüş; ürünün farklı kullanım/alıcı aramalarını etiketlerle yakala.",
    }.get(d["action"]["key"], "")
    lines = [f"- {e['text']}" for e in d["evidence"][:6]]
    return "Bu listing'in satış teşhisi:\n" + "\n".join(lines) + f"\n{focus}"

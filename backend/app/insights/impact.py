"""Değişikliğin etkisi: "yayınladık, işe yaradı mı?"

Her ListingChange için yayından önceki ve sonraki EŞİT uzunlukta iki pencere karşılaştırılır (en az MIN_WINDOW, en fazla
MAX_WINDOW gün; sonraki değişiklik gelirse pencere orada kesilir, iki değişikliğin etkisi karışmasın). Görüntülenme,
favori, satış ve takip edilen aramalardaki sıra ölçülür.

Kontrol grubu: aynı iki pencerede HİÇ değiştirilmemiş listing'ler. Yeterli veri varsa yalnızca aynı kategoridekiler
(benzer ürünler aynı mevsimi yaşar), yoksa mağazanın dokunulmamış geri kalanı. Mevsim ve mağaza geneli dalgalanma böylece
ayrılır: listing %30 artarken kontrol grubu da %30 arttıysa net etki sıfırdır.

Güven: "sonraki penceredeki pay" testi. Hiçbir etki yoksa listing'in iki penceredeki toplamının sonraki pencereye düşen
payı, kontrol grubununkine eşit olmalıdır (p0). Sapma z-skoruyla ölçülür; görüntülenme günden güne Poisson'dan fazla
dalgalandığı için varyans, listing'in iki penceredeki günlük dalgalanmasıyla (her pencere kendi ortalamasına göre;
aşırı yayılım katsayısı) büyütülür. Simülasyonda (gamma-Poisson günlük trafik) etki yokken yanlış "işe yaradı/kötüleşti"
oranı %6–7, gerçek 2 katlık değişimi yakalama oranı günde 2+ görüntülenmede %90+ çıktı.
Kararlar: better/worse (net değişim en az MIN_EFFECT ve |z| ≥ Z_MEDIUM), unclear (etki büyük ama veri ayırt etmeye
yetmiyor), same (etki küçük), low_data (çok az görüntülenme). Güven: |z| ≥ Z_HIGH yüksek, değilse orta.

Karar ölçütü değişikliğin amacına göre seçilir (`focus`): görünürlük için görüntülenme, tıklanma için favori, satın alma
için satış (yeterli satış yoksa favori). Sonuç sayılarla birlikte döner; metni arayüz iki dilde kurar.

Ölçüm günlük işte (jobs/listing_health.py) hesaplanıp ListingChange.result_json'a yazılır; pencere sınırına ulaşınca
`final` olur ve bir daha hesaplanmaz."""
import datetime as dt
import html
import json
import math
import statistics

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.insights.models import RankSnapshot
from app.listings import performance
from app.listings.models import ListingCache, ListingChange, ListingStatSnapshot
from app.shops.models import Shop

MIN_WINDOW = 7
MAX_WINDOW = 30
MIN_VIEWS = 40  # iki pencerenin toplam görüntülenmesi bunun altındaysa sonuç gürültüdür
MIN_UNITS = 4  # satış ölçütü için iki pencerede toplam en az bu kadar satış
MIN_EFFECT = 10  # net değişim bu yüzdenin altındaysa (anlamlı olsa bile) "fark yok"
Z_MEDIUM, Z_HIGH = 1.96, 2.58  # ~%95, %99 (iki yönlü)
MIN_CATEGORY_CONTROL = 5  # kategori kontrol grubu için en az bu kadar dokunulmamış listing
MIN_CONTROL_VIEWS = 100  # ...ve iki pencerede toplam en az bu kadar görüntülenme

_METRIC_BY_FOCUS = {"appeal": "favorites", "conversion": "units"}


class _ShopData:
    """Bir mağazanın ölçüm için gereken verisi; aynı iş içinde bir kez yüklenir.
    `at(day)`: o gündeki ömür boyu görüntülenme/favori sayaçları ({listing_id: (views, favorites)}); günlük kayıt bir gün
    atlanmışsa en yakın (önce önceki) gün kullanılır. `taxonomy`: listing → kategori. `changes`: mağazanın tüm değişiklikleri."""

    def __init__(self, db: Session, shop_id: int, changes: list[ListingChange] | None = None):
        self.db, self.shop_id, self._days = db, shop_id, {}
        self._changes = changes
        self._taxonomy: dict[int, int | None] | None = None

    @property
    def changes(self) -> list[ListingChange]:
        if self._changes is None:
            self._changes = list(self.db.scalars(select(ListingChange).where(ListingChange.shop_id == self.shop_id).order_by(ListingChange.published_at)))
        return self._changes

    @property
    def taxonomy(self) -> dict[int, int | None]:
        if self._taxonomy is None:
            self._taxonomy = {
                lid: json.loads(raw).get("taxonomy_id")
                for lid, raw in self.db.execute(select(ListingCache.listing_id, ListingCache.raw_json).where(ListingCache.shop_id == self.shop_id))
            }
        return self._taxonomy

    def at(self, day: dt.date) -> dict[int, tuple[int, int]]:
        if day not in self._days:
            start = dt.datetime.combine(day - dt.timedelta(days=2), dt.time.min)
            end = dt.datetime.combine(day + dt.timedelta(days=3), dt.time.min)
            best: dict[int, tuple[int, tuple[int, int]]] = {}
            for lid, at, views, favs in self.db.execute(
                select(ListingStatSnapshot.listing_id, ListingStatSnapshot.captured_at, ListingStatSnapshot.views, ListingStatSnapshot.favorites)
                .where(ListingStatSnapshot.shop_id == self.shop_id, ListingStatSnapshot.captured_at >= start, ListingStatSnapshot.captured_at < end)
            ):
                diff = (at.date() - day).days
                rank = abs(diff) * 2 + (1 if diff > 0 else 0)  # aynı uzaklıkta önceki gün tercih edilir
                if lid not in best or rank < best[lid][0]:
                    best[lid] = (rank, (views or 0, favs or 0))
            self._days[day] = {lid: v for lid, (_, v) in best.items()}
        return self._days[day]


def _delta(a: dict, b: dict, ids: set[int]) -> tuple[int, int]:
    """`a` gününden `b` gününe, `ids` içindeki (iki günde de kaydı olan) listing'lerin görüntülenme/favori artışı."""
    v = f = 0
    for k in ids & a.keys() & b.keys():
        v += max(0, b[k][0] - a[k][0])
        f += max(0, b[k][1] - a[k][1])
    return v, f


def _pct(after: float, before: float) -> int | None:
    return round((after - before) / before * 100) if before > 0 else None


def _net(after: float, before: float, ctl_after: float, ctl_before: float) -> int | None:
    """Listing'in değişimi, kontrol grubunun değişimine göre (yüzde). +1 küçük sayılarda sıfıra bölmeyi önler."""
    if before + after == 0:
        return None
    ratio = (after + 1) / (before + 1)
    ctl = (ctl_after + 1) / (ctl_before + 1) if ctl_before + ctl_after > 0 else 1.0
    return round((ratio / ctl - 1) * 100)


def _z(before: float, after: float, ctl_before: float, ctl_after: float, dispersion: float) -> float | None:
    """Sonraki pencerenin payı testi: etki yoksa after / (before + after) ≈ kontrolün aynı payı (p0)."""
    n = before + after
    if n == 0 or ctl_before + ctl_after == 0:
        return None
    p0 = ctl_after / (ctl_before + ctl_after)
    if p0 <= 0 or p0 >= 1:
        return None
    return round((after - n * p0) / math.sqrt(dispersion * n * p0 * (1 - p0)), 2)


def _dispersion(db: Session, shop_id: int, listing_id: int, d0: dt.date, d1: dt.date, d2: dt.date, idx: int) -> float:
    """Listing'in günlük sayımlarının varyans/ortalama oranı (Poisson'da 1); önce (d0..d1) ve sonra (d1..d2) pencereleri
    kendi ortalamalarına göre birleştirilir ki gerçek bir etki varyansı şişirmesin. `idx`: 0 görüntülenme, 1 favori.
    Günlük kayıt eksikse aradaki artış günlere bölünür. Veri azsa ya da oran 1'in altındaysa 1 (Poisson) kullanılır."""
    rows = db.execute(
        select(ListingStatSnapshot.captured_at, ListingStatSnapshot.views, ListingStatSnapshot.favorites).where(
            ListingStatSnapshot.shop_id == shop_id, ListingStatSnapshot.listing_id == listing_id,
            ListingStatSnapshot.captured_at >= dt.datetime.combine(d0, dt.time.min),
            ListingStatSnapshot.captured_at < dt.datetime.combine(d2 + dt.timedelta(days=1), dt.time.min),
        ).order_by(ListingStatSnapshot.captured_at)
    ).all()
    sides: tuple[list[float], list[float]] = ([], [])
    for (t0, v0, f0), (t1, v1, f1) in zip(rows, rows[1:]):
        gap = max((t1.date() - t0.date()).days, 1)
        inc = max(0, (v1 - v0) if idx == 0 else (f1 - f0))
        sides[0 if t1.date() <= d1 else 1].extend([inc / gap] * gap)
    if len(sides[0]) + len(sides[1]) < 10 or min(len(sides[0]), len(sides[1])) < 2:
        return 1.0
    total = sides[0] + sides[1]
    mean = statistics.fmean(total)
    if mean <= 0:
        return 1.0
    ss = sum((x - statistics.fmean(side)) ** 2 for side in sides for x in side)
    return round(min(max(ss / (len(total) - 2) / mean, 1.0), 25.0), 2)


def _confidence(z: float | None) -> str | None:
    if z is None:
        return None
    a = abs(z)
    return "high" if a >= Z_HIGH else "medium" if a >= Z_MEDIUM else None


def _control_groups(data: _ShopData, ch: ListingChange, start: dt.date, end: dt.date, with_snapshots: set[int]) -> tuple[set[int], set[int]]:
    """İki pencerede (start..end) hiç değiştirilmemiş listing'ler: (aynı kategoridekiler, tümü)."""
    touched = {c.listing_id for c in data.changes if start <= c.published_at.date() <= end} | {ch.listing_id}
    clean = with_snapshots - touched
    tax = data.taxonomy.get(ch.listing_id)
    same = {lid for lid in clean if tax and data.taxonomy.get(lid) == tax}
    return same, clean


def _ranks(db: Session, shop_id: int, listing_id: int, b0: dt.date, b1: dt.date, a0: dt.date, a1: dt.date) -> list[dict]:
    rows = db.execute(
        select(RankSnapshot.keyword, RankSnapshot.day, RankSnapshot.position).where(
            RankSnapshot.shop_id == shop_id, RankSnapshot.listing_id == listing_id, RankSnapshot.day >= b0, RankSnapshot.day <= a1,
        )
    ).all()
    per: dict[str, dict[str, list]] = {}
    for kw, day, pos in rows:
        side = "before" if day <= b1 else "after" if day >= a0 else None
        if side:
            per.setdefault(kw, {"before": [], "after": []})[side].append(pos)
    out = []
    for kw, s in per.items():
        if not s["before"] or not s["after"]:
            continue  # iki pencerede de ölçülmemiş arama kıyaslanamaz

        def avg(xs: list) -> float | None:
            found = [x for x in xs if x is not None]
            return round(sum(found) / len(found), 1) if found else None  # None: ilk sonuçlarda hiç görünmedi

        out.append({"keyword": kw, "before": avg(s["before"]), "after": avg(s["after"])})
    return sorted(out, key=lambda r: r["keyword"])[:8]


def _next_at(changes: list[ListingChange], ch: ListingChange) -> dt.datetime | None:
    later = [c.published_at for c in changes if c.listing_id == ch.listing_id and c.published_at > ch.published_at]
    return min(later) if later else None


def measure(db: Session, shop: Shop, ch: ListingChange, today: dt.date, data: _ShopData | None = None) -> dict:
    data = data or _ShopData(db, shop.id)
    pub = ch.published_at.date()
    days = (today - pub).days
    cap = MAX_WINDOW
    next_at = _next_at(data.changes, ch)
    if next_at is not None:
        cap = min(cap, (next_at.date() - pub).days)
    first = db.scalar(
        select(ListingStatSnapshot.captured_at).where(ListingStatSnapshot.shop_id == shop.id, ListingStatSnapshot.listing_id == ch.listing_id)
        .order_by(ListingStatSnapshot.captured_at).limit(1)
    )
    history = (pub - first.date()).days if first else 0  # yayından önce kaç günlük kayıt var
    limit = min(cap, history)
    window = min(days, limit)
    if window < MIN_WINDOW:
        if history < MIN_WINDOW:
            return {"status": "no_baseline", "final": True}  # yayından önce yeterli kayıt yok; kıyas hiç yapılamaz
        if cap < MIN_WINDOW:
            return {"status": "interrupted", "final": True, "next_change_days": cap}
        return {"status": "waiting", "final": False, "days": days, "ready_in": MIN_WINDOW - days}

    w = dt.timedelta(days=window)
    d0, d1, d2 = pub - dt.timedelta(days=1) - w, pub - dt.timedelta(days=1), pub - dt.timedelta(days=1) + w
    s0, s1, s2 = data.at(d0), data.at(d1), data.at(d2)
    me = {ch.listing_id}
    if not (me <= s0.keys() & s1.keys() & s2.keys()):
        return {"status": "no_baseline", "final": True}
    lb, la = _delta(s0, s1, me), _delta(s1, s2, me)

    same, clean = _control_groups(data, ch, d0, d2, s0.keys() & s1.keys() & s2.keys())
    ctl_ids, ctl_kind = clean, "shop"
    if len(same) >= MIN_CATEGORY_CONTROL:
        sb, sa = _delta(s0, s1, same), _delta(s1, s2, same)
        if sb[0] + sa[0] >= MIN_CONTROL_VIEWS:
            ctl_ids, ctl_kind = same, "category"
    cb, ca = _delta(s0, s1, ctl_ids), _delta(s1, s2, ctl_ids)

    b_start, b_end, a_start, a_end = pub - w, pub - dt.timedelta(days=1), pub, pub + w - dt.timedelta(days=1)
    sales_b, sales_a = performance.sales_by_listing(db, shop, b_start, b_end), performance.sales_by_listing(db, shop, a_start, a_end)
    ub, ua = sales_b.get(ch.listing_id, {"units": 0})["units"], sales_a.get(ch.listing_id, {"units": 0})["units"]
    ctl_ub = sum(v["units"] for k, v in sales_b.items() if k in ctl_ids)
    ctl_ua = sum(v["units"] for k, v in sales_a.items() if k in ctl_ids)

    disp_v = _dispersion(db, shop.id, ch.listing_id, d0, d1, d2, 0)
    disp_f = _dispersion(db, shop.id, ch.listing_id, d0, d1, d2, 1)
    nets = {
        "views": _net(la[0], lb[0], ca[0], cb[0]),
        "favorites": _net(la[1], lb[1], ca[1], cb[1]),
        "units": _net(ua, ub, ctl_ua, ctl_ub),
    }
    zs = {
        "views": _z(lb[0], la[0], cb[0], ca[0], disp_v),
        "favorites": _z(lb[1], la[1], cb[1], ca[1], disp_f),
        "units": _z(ub, ua, ctl_ub, ctl_ua, 1.0),
    }
    metric = _METRIC_BY_FOCUS.get(ch.focus or "", "views")
    if metric == "units" and ub + ua < MIN_UNITS:
        metric = "favorites"  # satış çok az: kararı favori verir
    net, z = nets[metric], zs[metric]
    confidence = None
    if lb[0] + la[0] < MIN_VIEWS:
        verdict = "low_data"
    elif net is None or abs(net) < MIN_EFFECT:
        verdict = "same"
    elif z is not None and abs(z) >= Z_MEDIUM and (z > 0) == (net > 0):
        verdict = "better" if net > 0 else "worse"
        confidence = _confidence(z)
    else:
        verdict = "unclear"  # yön belli ama bu kadar veriyle tesadüften ayırt edilemiyor

    return {
        "status": "measured",
        "final": window >= limit,
        "window_days": window,
        "partial_window": window < MAX_WINDOW,
        "metric": metric,
        "verdict": verdict,
        "confidence": confidence,
        "before": {"views": lb[0], "favorites": lb[1], "units": ub},
        "after": {"views": la[0], "favorites": la[1], "units": ua},
        "control": {
            "kind": ctl_kind, "listings": len(ctl_ids),
            "views_pct": _pct(ca[0], cb[0]), "favorites_pct": _pct(ca[1], cb[1]), "units_pct": _pct(ctl_ua, ctl_ub),
        },
        "net": nets,
        "z": zs,
        "ranks": _ranks(db, shop.id, ch.listing_id, b_start, b_end, a_start, a_end),
    }


def refresh_shop(db: Session, shop: Shop, today: dt.date | None = None) -> int:
    """Kesinleşmemiş ölçümleri yeniden hesaplar ve kaydeder (günlük iş). Hesaplanan değişiklik sayısını döner."""
    today = today or dt.date.today()
    data = _ShopData(db, shop.id)
    n = 0
    for ch in data.changes:
        if ch.result_json and json.loads(ch.result_json).get("final"):
            continue
        ch.result_json = json.dumps(measure(db, shop, ch, today, data))
        ch.measured_at = dt.datetime.utcnow()
        n += 1
    db.commit()
    return n


def listing_changes(db: Session, shop: Shop, listing_id: int, today: dt.date | None = None) -> list[ListingChange]:
    """Listing'in değişiklikleri (yeniden eskiye). Ölçümü hiç yapılmamış olanlar (ör. bugünkü yayın) yerinde hesaplanır."""
    today = today or dt.date.today()
    data = _ShopData(db, shop.id)
    rows = [c for c in data.changes if c.listing_id == listing_id]
    dirty = False
    for ch in rows:
        if ch.result_json is None:
            ch.result_json = json.dumps(measure(db, shop, ch, today, data))
            ch.measured_at = dt.datetime.utcnow()
            dirty = True
    if dirty:
        db.commit()
    return list(reversed(rows))


def shop_summary(db: Session, shop: Shop, days: int = 90, today: dt.date | None = None) -> dict:
    """Pano kartı: son `days` günde yayınlanan değişikliklerin sonuç dağılımı ve en yeni sonuçlar (kayıtlı ölçümden)."""
    today = today or dt.date.today()
    since = dt.datetime.combine(today - dt.timedelta(days=days), dt.time.min)
    rows = list(db.scalars(
        select(ListingChange).where(ListingChange.shop_id == shop.id, ListingChange.published_at >= since).order_by(ListingChange.published_at.desc())
    ))
    counts = {"better": 0, "same": 0, "worse": 0, "unclear": 0, "waiting": 0, "other": 0}
    titles = dict(db.execute(select(ListingCache.listing_id, ListingCache.title).where(
        ListingCache.shop_id == shop.id, ListingCache.listing_id.in_({ch.listing_id for ch in rows}),
    )).all()) if rows else {}
    items = []
    for ch in rows:
        r = json.loads(ch.result_json) if ch.result_json else {"status": "waiting"}
        key = r.get("verdict") if r.get("status") == "measured" and r.get("verdict") in counts else "waiting" if r.get("status") == "waiting" else "other"
        counts[key] += 1
        if len(items) < 6:
            items.append({"listing_id": ch.listing_id, "title": html.unescape(titles.get(ch.listing_id) or ""), "change_id": ch.id,
                          "published_at": ch.published_at.isoformat(), "fields": json.loads(ch.fields or "[]"), "source": ch.source, "result": r})
    return {"days": days, "total": len(rows), "counts": counts, "items": items}

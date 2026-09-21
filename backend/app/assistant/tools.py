"""Asistanın kullanabildiği araçlar. Okuma araçları mevcut finans/sipariş/listing servislerini çağırır (sayıları model
hesaplamaz). Yazma araçları YALNIZCA yerel taslak üretir/düzenler; Etsy'ye hiçbir şey göndermez (yayın, listing
düzenleyicisindeki "Etsy'de yayınla" düğmesiyle yapılır)."""
import datetime as dt
import html
import itertools
import json
import re
import statistics
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import quality
from app.assistant.models import AdReport, ChatImage
from app.finance import service as fin
from app.listings import bulk, creation, drafts, performance
from app.listings import service as listing_service
from app.listings.models import ListingCache
from app.orders.models import OrderCache
from app.shops.models import Shop
from app.taxonomy import service as taxonomy_service

CUSTOM_VARIATION_IDS = [513, 514, 516]  # Etsy'nin serbest isimli varyasyon kimlikleri
MAX_COMBOS = 400
_taxonomy_cache: dict[int, str] | None = None  # kategori kimliği -> "Ev & Yaşam > Duvar Dekoru > ..." (bir kez yüklenir)


def _taxonomy() -> dict[int, str]:
    global _taxonomy_cache
    if _taxonomy_cache is None:
        flat: dict[int, str] = {}

        def walk(nodes: list[dict], path: list[str]) -> None:
            for n in nodes:
                p = [*path, n.get("name", "")]
                flat[n["id"]] = " > ".join(p)
                walk(n.get("children") or [], p)

        walk(taxonomy_service.get_seller_taxonomy_nodes(), [])
        _taxonomy_cache = flat
    return _taxonomy_cache


@dataclass
class Ctx:
    db: Session
    shop: Shop
    user_id: int
    today: dt.date
    cards: list[dict] = field(default_factory=list)


def _d(value: str | None, default: dt.date) -> dt.date:
    if not value:
        return default
    return dt.date.fromisoformat(value)


def _r(x: float, n: int = 2) -> float:
    return round(float(x), n)


# ------------------------------------------------------------------ okuma araçları

def finance_summary(ctx: Ctx, a: dict) -> dict:
    start = _d(a.get("start_date"), dt.date(ctx.today.year, 1, 1))
    end = _d(a.get("end_date"), ctx.today)
    country = (a.get("country") or "").upper()
    r = fin.report(ctx.db, ctx.shop, start, end, country, compare=[1])
    k, p = r["kpi"], r["prev_kpi"]
    cur = r["currency"]
    rng = f"{start} – {end}" + (f" · {country}" if country else "")
    ctx.cards.append({
        "type": "finance",
        "title": f"Finans özeti ({rng})",
        "currency": cur,
        "kpis": [
            {"label": "Satış (vergi hariç)", "value": _r(k["sales"]), "prev": _r(p["sales"])},
            {"label": "Sipariş", "value": k["orders"], "prev": p["orders"], "count": True},
            {"label": "Etsy ücretleri", "value": _r(k["fees"]), "prev": _r(p["fees"]), "invert": True},
            {"label": "Reklam / diğer giderler", "value": _r(k["overhead"]), "prev": _r(p["overhead"]), "invert": True},
            {"label": "Ürün + kargo maliyeti", "value": _r(k["cogs"]), "prev": _r(p["cogs"]), "invert": True},
            {"label": "Net kâr", "value": _r(k["profit"]), "prev": _r(p["profit"]), "highlight": True},
        ],
        "countries": [{"iso": c["iso"], "sales": _r(c["sales"]), "orders": c["orders"]} for c in r["countries"][:5]],
    })
    out = {
        "donem": rng, "para_birimi": cur, "satis_vergi_haric": _r(k["sales"]), "siparis": k["orders"],
        "etsy_ucretleri": _r(k["fees"]), "reklam_ve_diger_giderler": _r(k["overhead"]),
        "girilen_urun_kargo_maliyeti": _r(k["cogs"]), "net_kar": _r(k["profit"]), "kar_marji_yuzde": _r(k["margin"], 1),
        "iadeler": _r(k["refunds"]), "ortalama_siparis_degeri": _r(k["aov"]), "etsy_payi_yuzde": _r(k["etsy_share"], 1),
        "reklam_harcamasi": _r(k["ads"]),
        "gecen_yil_ayni_donem": {"satis": _r(p["sales"]), "siparis": p["orders"], "net_kar": _r(p["profit"]), "etsy_ucretleri": _r(p["fees"])},
        "en_cok_satan_ulkeler": [{"ulke": c["iso"], "satis": _r(c["sales"]), "siparis": c["orders"]} for c in r["countries"][:5]],
    }
    if k["cogs"] == 0:
        out["uyari"] = "Ürün maliyetleri girilmemiş; net kâr yalnızca Etsy ücretleri ve reklam düşülmüş brüt kârdır."
    if country:
        out["not"] = "Ülke filtresinde reklam/yenileme giderleri hesaba katılmaz, net kâr gerçekte olduğundan yüksek görünür."
    return out


def monthly_pnl(ctx: Ctx, a: dict) -> dict:
    year = int(a.get("year") or ctx.today.year)
    start, end = dt.date(year, 1, 1), (ctx.today if year == ctx.today.year else dt.date(year, 12, 31))
    r = fin.report(ctx.db, ctx.shop, start, end, compare=[1])
    cur = r["currency"]
    rows = [
        {"ay": s["month"], "satis": _r(s["sales"]), "etsy_ucretleri": _r(s["fees"]), "reklam_diger": _r(s["overhead"]),
         "urun_maliyeti": _r(s["cogs"]), "net_kar": _r(s["profit"]), "siparis": s["orders"]}
        for s in r["series"]
    ]
    k = r["kpi"]
    ctx.cards.append({
        "type": "pnl", "title": f"{year} aylık kâr-zarar", "currency": cur,
        "rows": [{"month": x["ay"], "sales": x["satis"], "fees": x["etsy_ucretleri"], "overhead": x["reklam_diger"], "cogs": x["urun_maliyeti"], "profit": x["net_kar"], "orders": x["siparis"]} for x in rows],
        "totals": {"sales": _r(k["sales"]), "fees": _r(k["fees"]), "overhead": _r(k["overhead"]), "cogs": _r(k["cogs"]), "profit": _r(k["profit"]), "orders": k["orders"]},
    })
    out = {"yil": year, "para_birimi": cur, "aylar": rows, "toplam": {"satis": _r(k["sales"]), "net_kar": _r(k["profit"]), "siparis": k["orders"], "kar_marji_yuzde": _r(k["margin"], 1)}}
    if k["cogs"] == 0:
        out["uyari"] = "Ürün maliyetleri girilmemiş; net kâr brüt kârdır."
    return out


def _prev_range(start: dt.date, end: dt.date) -> tuple[dt.date, dt.date]:
    """Bir önceki yılın AYNI dönemi (kısmi yıl, tam yılla kıyaslanmasın diye)."""
    return fin._shift_year(start, -1), fin._shift_year(end, -1)


def top_products(ctx: Ctx, a: dict) -> dict:
    start = _d(a.get("start_date"), dt.date(ctx.today.year, 1, 1))
    end = _d(a.get("end_date"), ctx.today)
    sort = a.get("sort_by") if a.get("sort_by") in ("sales", "profit", "units") else "sales"
    limit = max(1, min(int(a.get("limit") or 10), 15))
    r = fin.report(ctx.db, ctx.shop, start, end, compare=[1])
    ps, pe = _prev_range(start, end)
    prev = {p["listing_id"]: p for p in fin.report(ctx.db, ctx.shop, ps, pe, compare=[1])["products"]}
    prods = sorted(r["products"], key=lambda p: -p[sort])[:limit]

    def prev_of(p: dict) -> dict:
        q = prev.get(p["listing_id"])
        return {"adet": q["units"] if q else 0, "satis": _r(q["sales"]) if q else 0.0}

    ctx.cards.append({
        "type": "products", "title": f"En iyi ürünler ({start} – {end}) · karşılaştırma: {ps} – {pe}", "currency": r["currency"],
        "rows": [{"title": p["title"], "listing_id": p["listing_id"], "units": p["units"], "sales": _r(p["sales"]), "profit": _r(p["profit"]), "margin": _r(p["margin"], 0), "image": p["image"],
                  "prev_units": prev_of(p)["adet"], "prev_sales": prev_of(p)["satis"]} for p in prods],
    })
    return {"donem": f"{start} – {end}", "onceki_yil_ayni_donem": f"{ps} – {pe}", "siralama": sort, "urunler": [
        {"baslik": p["title"], "listing_id": p["listing_id"], "adet": p["units"], "satis": _r(p["sales"]), "kar": _r(p["profit"]), "marj_yuzde": _r(p["margin"], 0),
         "maliyet_girilmis": p["unit_cost"] is not None or p["cost_pct"] is not None, "onceki_yil_ayni_donem": prev_of(p)}
        for p in prods]}


def compare_periods(ctx: Ctx, a: dict) -> dict:
    """Dönemi geçen yılın AYNI dönemiyle karşılaştırır ve düşüşün/artışın nedenini gösteren kırılımı verir: hangi ürünler,
    ülkeler ve aylar değişti; sipariş sayısı mı sepet mi değişti; reklam/ücret payı."""
    start = _d(a.get("start_date"), dt.date(ctx.today.year, 1, 1))
    end = _d(a.get("end_date"), ctx.today)
    ps, pe = _prev_range(start, end)
    cur = fin.report(ctx.db, ctx.shop, start, end, compare=[1])
    prev = fin.report(ctx.db, ctx.shop, ps, pe, compare=[1])
    k, p = cur["kpi"], cur["prev_kpi"]
    cp = {x["listing_id"]: x for x in cur["products"]}
    pp = {x["listing_id"]: x for x in prev["products"]}
    rows = []
    for lid in set(cp) | set(pp):
        c, q = cp.get(lid), pp.get(lid)
        base = c or q
        rows.append({
            "listing_id": lid, "title": base["title"], "units": c["units"] if c else 0, "prev_units": q["units"] if q else 0,
            "sales": _r(c["sales"]) if c else 0.0, "prev_sales": _r(q["sales"]) if q else 0.0,
        })
    for x in rows:
        x["change"] = _r(x["sales"] - x["prev_sales"])
    rows.sort(key=lambda x: x["change"])
    drops = [x for x in rows if x["change"] < 0][:6]
    gains = [x for x in reversed(rows) if x["change"] > 0][:4]
    total_change = k["sales"] - p["sales"]
    top3_drop = sum(x["change"] for x in drops[:3])

    def pct(now: float, before: float) -> float | None:
        return _r((now - before) / before * 100, 1) if before else None

    ctx.cards.append({"type": "movers", "title": f"Değişim: {start} – {end} ↔ {ps} – {pe}", "currency": cur["currency"], "rows": drops + gains})
    out = {
        "donem": f"{start} – {end}", "karsilastirilan_ayni_donem": f"{ps} – {pe}", "para_birimi": cur["currency"],
        "satis": {"simdi": _r(k["sales"]), "onceki": _r(p["sales"]), "fark": _r(total_change), "yuzde": pct(k["sales"], p["sales"])},
        "siparis": {"simdi": k["orders"], "onceki": p["orders"], "yuzde": pct(k["orders"], p["orders"])},
        "ortalama_siparis_degeri": {"simdi": _r(k["aov"]), "onceki": _r(p["aov"]), "yuzde": pct(k["aov"], p["aov"])},
        "etsy_ucretleri": {"simdi": _r(k["fees"]), "onceki": _r(p["fees"])},
        "reklam_ve_diger_giderler": {"simdi": _r(k["overhead"]), "onceki": _r(p["overhead"])},
        "reklam_harcamasi_satisa_orani_yuzde": {"simdi": _r(k["ads_pct"], 1), "onceki": _r(p["ads_pct"], 1)},
        "en_cok_dusen_urunler": drops, "yukselen_urunler": gains,
        "ilk_3_dusen_urunun_toplam_dususu": _r(top3_drop),
        "ulkeler": [{"ulke": c["iso"], "simdi": _r(c["sales"]), "onceki": _r(c["prev_sales"]), "siparis": c["orders"], "onceki_siparis": c["prev_orders"]} for c in cur["countries"][:6]],
        "aylar": [{"ay": s["month"], "satis": _r(s["sales"]), "onceki_yil": _r(s["prev_sales"]), "siparis": s["orders"], "onceki_yil_siparis": s["prev_orders"]} for s in cur["series"]],
    }
    if total_change < 0 and top3_drop < 0:
        out["dususun_yuzde_kaci_ilk_3_urunde"] = _r(top3_drop / total_change * 100, 0)
    if k["cogs"] == 0:
        out["uyari"] = "Ürün maliyetleri girilmemiş; kâr/marj değerleri gerçek değil (brüt)."
    return out


def ads_summary(ctx: Ctx, a: dict) -> dict:
    """Reklam HARCAMASI (ledger): Etsy Ads + Offsite Ads. Reklamdan gelen satışı (ROAS) Etsy API'si vermez."""
    start = _d(a.get("start_date"), dt.date(ctx.today.year, 1, 1))
    end = _d(a.get("end_date"), ctx.today)
    r = fin.report(ctx.db, ctx.shop, start, end, compare=[1])
    k, p = r["kpi"], r["prev_kpi"]
    return {
        "donem": f"{start} – {end}", "para_birimi": r["currency"],
        "reklam_harcamasi": {"simdi": _r(k["ads"]), "onceki_yil_ayni_donem": _r(p["ads"])},
        "satisa_orani_yuzde": {"simdi": _r(k["ads_pct"], 1), "onceki_yil_ayni_donem": _r(p["ads_pct"], 1)},
        "satis": {"simdi": _r(k["sales"]), "onceki_yil_ayni_donem": _r(p["sales"])},
        "aylik_reklam_ve_diger_gider": [{"ay": s["month"], "gider": _r(s["overhead"]), "satis": _r(s["sales"])} for s in r["series"]],
        "not": "Reklamın getirdiği satış/ROAS verisi Etsy API'sinde yok; yalnızca harcamayı biliyoruz. ROAS için kullanıcının Etsy Ads ekranındaki verisi gerekir.",
    }


def listing_performance(ctx: Ctx, a: dict) -> dict:
    """Tek listing'in dönem performansı ve içerik tazeliği (bkz. listings/performance.py)."""
    lid = int(a["listing_id"])
    end = _d(a.get("end_date"), ctx.today)
    start = _d(a.get("start_date"), end - dt.timedelta(days=89))
    r = performance.listing_performance(ctx.db, ctx.shop, lid, start, end, ctx.today)
    if r is None:
        return {"error": "Listing yerelde bulunamadı (senkronize edilmesi gerekebilir)."}
    ctx.cards.append({"type": "performance", "title": r["title"], "listing_id": lid, "period": r["period"], "previous_period": r["previous_period"], "sales": r["sales"],
                      "views_now": r["views_now"], "conversion_percent": r["conversion_percent"], "freshness": r["freshness"], "lifetime": r["lifetime"], "price": r["price"]})
    r["onceki_donem_aciklamasi"] = "sales.prev_* ve views_prev, seçilen dönemden HEMEN ÖNCEKİ eşit uzunluktaki dönemdir; geçen yılın aynı dönemi DEĞİLDİR."
    r["not"] = ("Görüntülenme/favori geçmişini Etsy vermez; günlük kendimiz biriktiriyoruz. 'partial' ya da 'available: false' ise izleme kısa demektir: "
                "görüntülenme trendi için kesin konuşma. Satışlar sipariş geçmişinden tam hesaplanır.")
    return r


def stale_listings(ctx: Ctx, a: dict) -> dict:
    """Uzun süredir güncellenmemiş listing'ler ve satış eğilimleri (hangilerini yenilemeye değer)."""
    min_days = int(a.get("min_days") or 60)
    limit = max(1, min(int(a.get("limit") or 12), 25))
    rows = [x for x in performance.stale_listings(ctx.db, ctx.shop, ctx.today) if x["state"] == "active" and x["days_since_update"] >= min_days]
    rows.sort(key=lambda x: (-x["days_since_update"], -x["units_previous"]))
    rows = rows[:limit]
    ctx.cards.append({"type": "stale", "title": f"{min_days}+ gündür güncellenmeyen aktif listing'ler", "rows": [
        {"listing_id": x["listing_id"], "title": x["title"], "days": x["days_since_update"], "exact": x["exact"], "units_recent": x["units_recent"], "units_previous": x["units_previous"], "views": x["views"]} for x in rows]})
    tracking = max((x["freshness"].get("tracking_days", 0) for x in rows), default=0)
    return {
        "esik_gun": min_days, "sayi": len(rows), "izleme_suresi_gun": tracking,
        "listingler": [{"listing_id": x["listing_id"], "baslik": x["title"], "guncellenmeyen_gun": x["days_since_update"], "kesin_tarih_biliniyor": x["exact"],
                        "son_180_gun_adet": x["units_recent"], "onceki_180_gun_adet": x["units_previous"], "toplam_goruntulenme": x["views"], "toplam_favori": x["favorites"]} for x in rows],
        "not": ("guncellenmeyen_gun: içerik değişikliği izleme sırasında yakalandıysa kesin (kesin_tarih_biliniyor=true); değilse Etsy'nin son değişiklik tarihi ya da izleme süresi "
                "(alt sınır). Etsy'nin son değişiklik tarihi fiyat/yenileme gibi işlemlerle de değişir."),
    }


def _ad_metrics(spend: float, views: int, clicks: int, orders: int, revenue: float) -> dict:
    return {
        "ctr_yuzde": round(clicks / views * 100, 2) if views else None,
        "tiklama_basina_maliyet": round(spend / clicks, 2) if clicks else None,
        "roas": round(revenue / spend, 2) if spend else None,
        "tiklama_siparis_donusumu_yuzde": round(orders / clicks * 100, 2) if clicks else None,
        "siparis_basina_reklam_maliyeti": round(spend / orders, 2) if orders else None,
    }


def save_ad_report(ctx: Ctx, a: dict) -> dict:
    """Kullanıcının yapıştırdığı Etsy Ads verisini saklar ve hesaplanmış metriklerle kapatma/koruma adaylarını döner."""
    spend, revenue = float(a.get("spend") or 0), float(a.get("revenue") or 0)
    views, clicks, orders = int(a.get("views") or 0), int(a.get("clicks") or 0), int(a.get("orders") or 0)
    kws = [
        {"keyword": str(k.get("keyword", ""))[:80], "views": int(k.get("views") or 0), "clicks": int(k.get("clicks") or 0), "orders": int(k.get("orders") or 0),
         "spend": float(k.get("spend") or 0), "revenue": float(k.get("revenue") or 0)}
        for k in (a.get("keywords") or []) if k.get("keyword")
    ][:60]
    lid = int(a["listing_id"]) if a.get("listing_id") else None
    prev = None
    q = select(AdReport).where(AdReport.shop_id == ctx.shop.id).order_by(AdReport.created_at.desc())
    q = q.where(AdReport.listing_id == lid) if lid else q.where(AdReport.listing_title == str(a.get("listing_title", ""))[:255])
    prev = ctx.db.scalars(q.limit(1)).first()
    rep_row = AdReport(
        shop_id=ctx.shop.id, listing_id=lid, listing_title=str(a.get("listing_title", ""))[:255],
        period_start=_d(a.get("period_start"), None) if a.get("period_start") else None, period_end=_d(a.get("period_end"), None) if a.get("period_end") else None,
        spend=spend, views=views, clicks=clicks, orders=orders, revenue=revenue, keywords_json=json.dumps(kws, ensure_ascii=False), note=str(a.get("note", ""))[:500],
    )
    ctx.db.add(rep_row)
    ctx.db.commit()
    m = _ad_metrics(spend, views, clicks, orders, revenue)
    # Kural tabanlı adaylar (model yorumlar; Etsy Ads'te anahtar kelimeyi kullanıcı elle kapatır)
    close = [k for k in kws if k["orders"] == 0 and (k["clicks"] >= 8 or k["spend"] >= 3.0)]
    good = [k for k in kws if k["orders"] >= 1 and (k["spend"] == 0 or k["revenue"] / max(k["spend"], 0.01) >= 2.0)]
    out = {
        "kaydedildi": True, "rapor_id": rep_row.id, "metrikler": m,
        "kapatma_adaylari": close, "koruma_adaylari": good,
        "kapatma_kurali": "0 sipariş ve (en az 8 tıklama ya da en az 3 harcama)",
        "not": ("Reklamı/anahtar kelimeyi Etsy Ads panelinden kullanıcı elle kapatır; biz kapatamayız. "
                + ("Anahtar kelime satırlarında yeterli tıklama yok; kelime bazında karar için veri az, ürün düzeyinde karar ver. " if kws and not close and not good else "")),
    }
    if prev is not None and prev.id != rep_row.id:
        pm = _ad_metrics(prev.spend, prev.views, prev.clicks, prev.orders, prev.revenue)
        out["onceki_rapor"] = {"tarih": prev.created_at.date().isoformat(), "donem": [str(prev.period_start), str(prev.period_end)], "harcama": prev.spend, "siparis": prev.orders, "gelir": prev.revenue, "metrikler": pm}
    ctx.cards.append({"type": "ad_report", "title": rep_row.listing_title or "Reklam raporu", "spend": spend, "views": views, "clicks": clicks, "orders": orders, "revenue": revenue,
                      "metrics": m, "close": [k["keyword"] for k in close][:12], "good": [k["keyword"] for k in good][:12]})
    return out


def ad_reports(ctx: Ctx, a: dict) -> dict:
    q = select(AdReport).where(AdReport.shop_id == ctx.shop.id)
    if a.get("listing_id"):
        q = q.where(AdReport.listing_id == int(a["listing_id"]))
    rows = ctx.db.scalars(q.order_by(AdReport.created_at.desc()).limit(max(1, min(int(a.get("limit") or 10), 30)))).all()
    return {"sayi": len(rows), "raporlar": [
        {"rapor_id": r.id, "listing_id": r.listing_id, "baslik": r.listing_title, "kayit_tarihi": r.created_at.date().isoformat(), "donem": [str(r.period_start), str(r.period_end)],
         "harcama": r.spend, "gelir": r.revenue, "siparis": r.orders, "metrikler": _ad_metrics(r.spend, r.views, r.clicks, r.orders, r.revenue)} for r in rows]}


def list_orders(ctx: Ctx, a: dict) -> dict:
    kind = a.get("filter") or "to_ship"
    limit = max(1, min(int(a.get("limit") or 10), 20))
    q = select(OrderCache).where(OrderCache.shop_id == ctx.shop.id)
    if kind in ("to_ship", "overdue"):
        q = q.where(OrderCache.is_paid.is_(True), OrderCache.is_shipped.is_(False), OrderCache.is_canceled.is_(False))
        if kind == "overdue":
            q = q.where(OrderCache.expected_ship_date < dt.datetime.combine(ctx.today, dt.time.min))
        q = q.order_by(OrderCache.expected_ship_date.asc())
    elif kind == "search" and a.get("query"):
        q = q.where(OrderCache.search_text.like(f"%{str(a['query']).strip().lower()}%")).order_by(OrderCache.created_at.desc())
    else:
        q = q.order_by(OrderCache.created_at.desc())
    rows = ctx.db.scalars(q.limit(limit)).all()
    out = []
    for o in rows:
        raw = json.loads(o.raw_json)
        items = [f"{t.get('quantity') or 1}× {html.unescape(t.get('title') or '')[:60]}" for t in raw.get("transactions") or []]
        out.append({
            "siparis_no": o.receipt_id, "alici": o.buyer_name, "ulke": o.country_iso, "tarih": o.created_at.date().isoformat(),
            "gonderim_tarihi": o.expected_ship_date.date().isoformat() if o.expected_ship_date else None,
            "tutar": _r(o.grandtotal_amount / (o.grandtotal_divisor or 100)), "urunler": items,
        })
    label = {"to_ship": "Gönderilecek siparişler", "overdue": "Gecikmiş siparişler", "search": "Arama sonucu", "recent": "Son siparişler"}.get(kind, "Siparişler")
    ctx.cards.append({
        "type": "orders", "title": label,
        "rows": [{"receipt_id": x["siparis_no"], "buyer": x["alici"], "country": x["ulke"], "date": x["tarih"], "ship_by": x["gonderim_tarihi"], "total": x["tutar"], "items": x["urunler"]} for x in out],
    })
    return {"filtre": kind, "sayi": len(out), "siparisler": out}


def search_listings(ctx: Ctx, a: dict) -> dict:
    limit = max(1, min(int(a.get("limit") or 10), 20))
    q = select(ListingCache).where(ListingCache.shop_id == ctx.shop.id)
    if a.get("query"):
        q = q.where(ListingCache.title.like(f"%{str(a['query']).strip()}%"))
    rows = ctx.db.scalars(q.order_by(ListingCache.views.desc()).limit(limit)).all()
    out = []
    for r in rows:
        raw = json.loads(r.raw_json)
        pr = raw.get("price") or {}
        out.append({"listing_id": r.listing_id, "baslik": html.unescape(r.title), "durum": raw.get("state"), "fiyat": _r(pr["amount"] / pr["divisor"]) if pr.get("divisor") else None, "goruntulenme": r.views, "favori": r.favorites})
    return {"sayi": len(out), "listingler": out}


def get_listing(ctx: Ctx, a: dict) -> dict:
    work = _current_work(ctx, int(a["listing_id"]))
    if work is None:
        return {"error": "Listing bulunamadı (yerelde yok olabilir)."}
    offers = [o for p in work.get("inventory", {}).get("products", []) for o in p.get("offerings", [])]
    prices = [o["price"]["amount"] / o["price"]["divisor"] for o in offers if isinstance(o.get("price"), dict)]
    return {
        "listing_id": work["listing_id"], "baslik": work["title"], "etiketler": work["tags"], "aciklama_ilk_600": (work.get("description") or "")[:600],
        "fiyat_aralik": [min(prices), max(prices)] if prices else None, "urun_kombinasyonu": len(work.get("inventory", {}).get("products", [])),
        "fotograf_sayisi": len(work.get("images") or []), "durum": work.get("state"),
    }


def _shop_norms(ctx: Ctx) -> tuple[float, int]:
    """Mağazanın tipik birim fiyatı (medyan) ve tipik stok adedi (en sık kullanılan); yeni listing'de belirtilmeyen değerler için."""
    prices, qtys = [], Counter()
    for (raw,) in ctx.db.execute(select(ListingCache.raw_json).where(ListingCache.shop_id == ctx.shop.id)):
        j = json.loads(raw)
        pr = j.get("price") or {}
        if pr.get("divisor"):
            prices.append(pr["amount"] / pr["divisor"])
        if j.get("quantity"):
            qtys[int(j["quantity"])] += 1
    return (round(statistics.median(prices), 2) if prices else 20.0), (qtys.most_common(1)[0][0] if qtys else 1)


def standard_sections(db: Session, shop_id: int) -> dict:
    """Mağazanın listing açıklamalarında tekrar eden SABİT bölümlerini (iletişim, işleme/teslimat süresi, garanti, yasal uyarı…)
    otomatik bulur: ≥%30 (en az 3) listing'de birebir geçen paragraflar. `header` açıklamanın başına, `footer` sonuna eklenir."""
    descs = []
    for (raw,) in db.execute(select(ListingCache.raw_json).where(ListingCache.shop_id == shop_id)):
        d = html.unescape(json.loads(raw).get("description") or "")
        if d.strip():
            descs.append(d)

    def norm(x: str) -> str:
        return re.sub(r"\s+", " ", x).strip().lower()

    count: Counter = Counter()
    sample: dict[str, str] = {}
    pos: dict[str, list[float]] = {}
    for d in descs:
        paras = [x.strip() for x in re.split(r"\n\s*\n", d) if x.strip()]
        seen: set[str] = set()
        for i, para in enumerate(paras):
            if len(para) < 25:
                continue
            k = norm(para)
            if k in seen:
                continue
            seen.add(k)
            count[k] += 1
            sample.setdefault(k, para)
            pos.setdefault(k, []).append(i / max(1, len(paras) - 1))
    threshold = max(3, int(len(descs) * 0.3))
    blocks = sorted(
        ({"text": sample[k], "count": n, "pos": statistics.mean(pos[k])} for k, n in count.items() if n >= threshold),
        key=lambda b: b["pos"],
    )
    return {
        "listings": len(descs),
        "header": [b["text"] for b in blocks if b["pos"] < 0.25],
        "footer": [b["text"] for b in blocks if b["pos"] >= 0.25],
        "blocks": blocks,
    }


def _with_standard_sections(db: Session, shop_id: int, product_part: str) -> tuple[str, int]:
    std = standard_sections(db, shop_id)

    def norm(x: str) -> str:
        return re.sub(r"\s+", " ", x.replace("…", "").replace("...", "")).strip().lower()

    std_norms = [norm(b) for b in [*std["header"], *std["footer"]]]
    # Model sabit bölümleri (ya da kısaltılmış özetini) ürün kısmına kopyaladıysa çıkar; aynı bölüm iki kez görünmesin.
    kept = []
    for para in re.split(r"\n\s*\n", product_part.strip()):
        n = norm(para)
        if n and any(n[:60] and (sn.startswith(n[:60]) or n in sn) for sn in std_norms):
            continue
        kept.append(para.strip())
    parts = [*std["header"], "\n\n".join(kept), *std["footer"]]
    return "\n\n".join(x for x in parts if x), len(std["header"]) + len(std["footer"])


_RISKY_CLAIMS = re.compile(
    r"\b(hardware|mounting|included|provided|warranty|lifetime|waterproof|rust[- ]?proof|weather[- ]?proof|certified|fireproof|hypoallergenic)\b", re.I
)


def _quality_problems(title: str, tags: list[str], product_description: str) -> list[str]:
    """Taslak oluşturulmadan önce kaliteyi denetler; sorun varsa model düzeltip tekrar dener (yanlış/eksik içerik yayına gitmesin)."""
    out = []
    if len(title) < 80:
        out.append(f"Başlık {len(title)} karakter; 80–120 karakter olmalı (boyut, malzeme, kullanım yeri ve alıcı gibi doğal öbekler ekle).")
    if len(tags) < 13:
        out.append(f"{len(tags)} etiket var; tam 13 olmalı.")
    single = [t for t in tags if " " not in t]
    if len(single) > 3:
        out.append(f"{len(single)} etiket tek kelime ({', '.join(single)}); 2–4 kelimelik uzun kuyruklu etiketler kullan (her biri en fazla 20 karakter).")
    claims = sorted({m.group(0).lower() for m in _RISKY_CLAIMS.finditer(product_description)})
    if claims:
        out.append(f"Açıklamada kullanıcının söylemediği/doğrulanmamış iddialar var ({', '.join(claims)}); bunları çıkar. Yalnızca kullanıcının verdiği ya da resimde gördüğün bilgileri yaz.")
    return out


_STOP = {"the", "and", "for", "with", "your", "our", "you", "from", "this", "that", "custom", "personalized"}


def similar_listings(ctx: Ctx, a: dict) -> dict:
    """Mağazanın benzer listing'leri (fiyat, etiket, başlık üslubu ve açıklama örneği için)."""
    words = {w for w in re.findall(r"[a-z0-9]+", str(a.get("query", "")).lower()) if len(w) > 2 and w not in _STOP}
    if not words:
        return {"error": "Sorgu için anahtar kelime ver (İngilizce, ör. 'mountain metal wall art')."}
    scored = []
    for row in ctx.db.scalars(select(ListingCache).where(ListingCache.shop_id == ctx.shop.id)).all():
        j = json.loads(row.raw_json)
        text = (html.unescape(row.title) + " " + " ".join(j.get("tags") or [])).lower()
        score = sum(1 for w in words if w in text)
        if score:
            scored.append((score, row.views or 0, row, j))
    scored.sort(key=lambda t: (-t[0], -t[1]))
    out = []
    for score, _, row, j in scored[: max(1, min(int(a.get("limit") or 5), 8))]:
        pr = j.get("price") or {}
        out.append({
            "listing_id": row.listing_id, "baslik": html.unescape(row.title), "etiketler": j.get("tags") or [],
            "fiyat": _r(pr["amount"] / pr["divisor"]) if pr.get("divisor") else None, "goruntulenme": row.views, "favori": row.favorites,
            "aciklama_ilk_500": html.unescape(j.get("description") or "")[:500],
        })
    prices = [x["fiyat"] for x in out if x["fiyat"]]
    return {"benzer_sayisi": len(out), "fiyat_araligi": [min(prices), max(prices)] if prices else None, "listingler": out}


def shop_defaults(ctx: Ctx, a: dict) -> dict:
    """Yeni listing için varsayılanlar: mağazada en çok kullanılan kategoriler, kargo profili ve iade politikası (yerel önbellekten)."""
    ship, ret = Counter(), Counter()
    for (raw,) in ctx.db.execute(select(ListingCache.raw_json).where(ListingCache.shop_id == ctx.shop.id)):
        j = json.loads(raw)
        if j.get("shipping_profile_id"):
            ship[j["shipping_profile_id"]] += 1
        if j.get("return_policy_id"):
            ret[j["return_policy_id"]] += 1
    cats = listing_service.get_top_categories(ctx.db, ctx.shop)
    try:
        names = _taxonomy()
        cats = [{**c, "ad": names.get(c["taxonomy_id"], "")} for c in cats]
    except Exception:  # noqa: BLE001 — kategori adları alınamazsa yalnızca kimlikler döner
        pass
    typical_price, typical_qty = _shop_norms(ctx)
    std = standard_sections(ctx.db, ctx.shop.id)
    return {"tipik_fiyat_medyan": typical_price, "tipik_stok_adedi": typical_qty, "sabit_aciklama_bolumu_sayisi": len(std["blocks"]), "en_cok_kullanilan_kategoriler": cats[:8], "en_cok_kullanilan_kargo_profili_id": ship.most_common(1)[0][0] if ship else None, "en_cok_kullanilan_iade_politikasi_id": ret.most_common(1)[0][0] if ret else None}


def find_category(ctx: Ctx, a: dict) -> dict:
    """Etsy kategori ağacında ada göre arar (kategori kimliği bulmak için)."""
    q = str(a.get("query", "")).strip().lower()
    if not q:
        return {"error": "Arama metni gerekli."}
    words = q.split()
    scored = []
    for tid, path in _taxonomy().items():
        low = path.lower()
        hit = sum(1 for w in words if w in low)
        if hit:
            scored.append((hit, path.count(">"), tid, path))
    scored.sort(key=lambda h: (-h[0], -h[1], len(h[3])))  # en çok kelime eşleşen, sonra daha spesifik (derin) kategoriler
    return {"sonuclar": [{"taxonomy_id": tid, "yol": path} for _, _, tid, path in scored[:10]]}


# ------------------------------------------------------------------ yazma araçları (yalnızca yerel taslak)

def _current_work(ctx: Ctx, listing_id: int) -> dict | None:
    local = drafts._local_row(ctx.db, ctx.shop, listing_id)
    if local is not None:
        return json.loads(local.data_json)
    row = ctx.db.scalars(select(ListingCache).where(ListingCache.shop_id == ctx.shop.id, ListingCache.listing_id == listing_id)).one_or_none()
    return bulk.snapshot_cached(row) if row is not None else None


def _tags(raw: list[str]) -> tuple[list[str], list[str]]:
    out, short, seen = [], [], set()
    for t in raw:
        t = " ".join(str(t).split())
        if not t:
            continue
        if len(t) > bulk.TAG_MAX_LEN:
            t = t[: bulk.TAG_MAX_LEN].rsplit(" ", 1)[0] if " " in t[: bulk.TAG_MAX_LEN] else t[: bulk.TAG_MAX_LEN]
            short.append(t)
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[: bulk.TAGS_MAX], short


def _build_inventory(work: dict, price: float, quantity: int, variations: list[dict]) -> str | None:
    cur = work["inventory"]["products"][0]["offerings"][0]["price"]["currency_code"]

    def offering(p: float) -> dict:
        return {"price": {"amount": round(p * 100), "divisor": 100, "currency_code": cur}, "quantity": quantity, "is_enabled": True}

    if not variations:
        work["inventory"]["products"] = [{"sku": "", "property_values": [], "offerings": [offering(price)]}]
        return None
    if len(variations) > 3:
        return "En fazla 3 varyasyon tanımlanabilir."
    props = []
    for i, v in enumerate(variations):
        vals = [x if isinstance(x, dict) else {"value": x} for x in v.get("values", [])]
        vals = [{"value": str(x["value"]).strip(), "price": x.get("price")} for x in vals if str(x.get("value", "")).strip()]
        if not vals:
            return f'"{v.get("name")}" varyasyonunda seçenek yok.'
        props.append({"id": CUSTOM_VARIATION_IDS[i], "name": str(v["name"]).strip()[:50], "values": vals})
    varying = [p for p in props if any(x["price"] is not None for x in p["values"])]
    if len(varying) > 1:
        return "Fiyat aynı anda yalnızca tek bir varyasyona göre değişebilir (Etsy kuralı)."
    n = 1
    for p in props:
        n *= len(p["values"])
    if n > MAX_COMBOS:
        return f"Kombinasyon sayısı çok fazla ({n}); en fazla {MAX_COMBOS}."
    products = []
    for combo in itertools.product(*[p["values"] for p in props]):
        p_val = price
        for prop, val in zip(props, combo):
            if prop in varying and val["price"] is not None:
                p_val = float(val["price"])
        products.append({
            "sku": "",
            "property_values": [{"property_id": prop["id"], "property_name": prop["name"], "scale_id": None, "value_ids": [], "values": [val["value"]]} for prop, val in zip(props, combo)],
            "offerings": [offering(p_val)],
        })
    work["inventory"]["products"] = products
    work["inventory"]["price_on_property"] = [varying[0]["id"]] if varying else []
    return None


def create_listing_draft(ctx: Ctx, a: dict) -> dict:
    title = " ".join(str(a.get("title", "")).split())[: bulk.TITLE_MAX]
    if not title:
        return {"error": "Başlık gerekli."}
    tags_checked, _short = _tags(a.get("tags") or [])
    others = quality.shop_others(ctx.db, ctx.shop.id)
    problems_pre = quality.all_problems(title, tags_checked, str(a.get("description") or ""), others)
    if problems_pre:
        return {"error": "Taslak henüz oluşturulmadı. Önce şunları düzelt ve create_listing_draft'ı tekrar çağır (mağazanın diğer listing'lerinin kopyası olmamalı): " + " ".join(problems_pre)}
    norm_price, norm_qty = _shop_norms(ctx)
    price_assumed = a.get("price_source", "typical") != "user" or not a.get("price")  # yalnızca kullanıcının verdiği fiyat kesin sayılır
    qty_assumed = not a.get("quantity")
    price = float(a["price"]) if a.get("price") else norm_price  # verilmediyse mağazanın tipik fiyatı (kullanıcıya bildirilir)
    if price < bulk.MIN_PRICE:
        return {"error": f"Fiyat en az {bulk.MIN_PRICE} olmalı."}
    created = creation.create_local_new(ctx.db, ctx.shop, None)
    lid = created["listing_id"]
    work = json.loads(drafts._local_row(ctx.db, ctx.shop, lid).data_json)
    # Tek seçenekli "varyasyon" gerçek varyasyon değildir (ör. yalnızca tek boyut): açılmaz, bilgi başlık/açıklamada yer alır.
    variations = [v for v in (a.get("variations") or []) if len(v.get("values") or []) > 1]
    dropped_variations = len(a.get("variations") or []) - len(variations)
    err = _build_inventory(work, price, max(1, int(a.get("quantity") or norm_qty)), variations)
    if err:
        creation_cleanup(ctx, lid)
        return {"error": err}
    tags, shortened = _tags(a.get("tags") or [])
    description, std_count = (_with_standard_sections(ctx.db, ctx.shop.id, str(a.get("description") or "")) if a.get("use_standard_sections", True) else (str(a.get("description") or ""), 0))
    dims = a.get("dimensions") or {}
    unit = str(dims.get("unit") or "cm").lower()
    if any(dims.get(k) for k in ("length", "width", "height")) and unit in ("mm", "cm", "m", "in", "ft"):
        work.update({"item_length": dims.get("length"), "item_width": dims.get("width"), "item_height": dims.get("height"), "item_dimensions_unit": unit})
    work.update({"title": title, "description": description, "tags": tags, "materials": [str(m).strip() for m in (a.get("materials") or []) if str(m).strip()][:13]})
    if a.get("who_made") in ("i_did", "someone_else", "collective"):
        work["who_made"] = a["who_made"]
    if a.get("when_made"):
        work["when_made"] = a["when_made"]
    defaults = shop_defaults(ctx, {})
    work["taxonomy_id"] = int(a["taxonomy_id"]) if a.get("taxonomy_id") else None
    work["shipping_profile_id"] = int(a["shipping_profile_id"]) if a.get("shipping_profile_id") else defaults["en_cok_kullanilan_kargo_profili_id"]
    work["return_policy_id"] = int(a["return_policy_id"]) if a.get("return_policy_id") else defaults["en_cok_kullanilan_iade_politikasi_id"]

    # Alt metinler: model resimleri zaten gördüğü için image_ids ile aynı sırada verir (en fazla 500 karakter, önerilen 125).
    ids_in = [str(i) for i in (a.get("image_ids") or [])[:10]]
    alts = [" ".join(str(t).split())[:500] for t in (a.get("image_alt_texts") or [])]
    alt_by_image = {iid: alts[i] for i, iid in enumerate(ids_in) if i < len(alts) and alts[i]}
    attached = 0
    for n, image_id in enumerate((a.get("image_ids") or [])[:10], start=1):
        img = ctx.db.get(ChatImage, str(image_id))
        if img is None or img.shop_id != ctx.shop.id:
            continue
        with open(img.path, "rb") as f:
            saved = drafts.save_file(ctx.db, ctx.shop, lid, "image", img.filename, img.content_type, f.read())
        url = creation._file_url(ctx.shop, lid, saved["file_id"])
        attached += 1
        work["images"].append({
            "listing_image_id": -attached, "draft_file_id": saved["file_id"], "rank": attached, "alt_text": alt_by_image.get(str(image_id)),
            "url_75x75": url, "url_170x135": url, "url_570xN": url, "url_fullxfull": url,
        })
    drafts.save_local(ctx.db, ctx.shop, lid, work, None)
    problems = creation.validate_new(work, activate=True)
    offers = [o for p in work["inventory"]["products"] for o in p["offerings"]]
    prices = [o["price"]["amount"] / 100 for o in offers]
    ctx.cards.append({
        "type": "listing_draft", "listing_id": lid, "title": title, "edit_url": f"/listings/{lid}/edit",
        "price": [min(prices), max(prices)], "quantity": offers[0]["quantity"] if offers else 0, "tags": tags,
        "combos": len(work["inventory"]["products"]) if work["inventory"]["products"][0]["property_values"] else 0,
        "image": work["images"][0]["url_170x135"] if work["images"] else None, "images": attached, "problems": problems,
        "price_assumed": price_assumed, "quantity_assumed": qty_assumed,
    })
    return {
        "listing_id": lid, "duzenleyici_baglantisi": f"/listings/{lid}/edit", "eklenen_resim": attached,
        "varyasyon_kombinasyonu": len(work["inventory"]["products"]) if work["inventory"]["products"][0]["property_values"] else 0,
        "kisaltilan_etiketler": shortened, "yayin_icin_eksikler": problems,
        "mağaza_sabit_bolumleri_eklendi": std_count, "acilmayan_tek_secenekli_varyasyon": dropped_variations,
        "varsayilanlar": {"fiyat_mağaza_tipik_degeri_kullanildi": price_assumed, "adet_mağaza_tipik_degeri_kullanildi": qty_assumed, "fiyat": price},
        "not": "Bu yalnızca yerel taslaktır; Etsy'ye gitmedi. Kullanıcı düzenleyicide kontrol edip 'Etsy'de yayınla' düğmesine basmalı.",
    }


def creation_cleanup(ctx: Ctx, lid: int) -> None:
    """Başarısız taslak oluşturmada boş kalan yerel kaydı siler."""
    drafts.discard_local(ctx.db, ctx.shop, lid)


def update_listing(ctx: Ctx, a: dict) -> dict:
    lid = int(a["listing_id"])
    work = _current_work(ctx, lid)
    if work is None:
        return {"error": "Listing bulunamadı (yerelde yok olabilir; senkronize edilmesi gerekebilir)."}
    ch: dict = {}
    if a.get("new_title"):
        ch["title"] = bulk.TextOp(mode="set", text=str(a["new_title"]))
    if a.get("new_description"):
        ch["description"] = bulk.TextOp(mode="set", text=str(a["new_description"]))
    tag_add, tag_remove = list(a.get("add_tags") or []), list(a.get("remove_tags") or [])
    if a.get("set_tags") is not None:
        wanted, _ = _tags(a["set_tags"])
        have = {t.lower() for t in wanted}
        tag_remove += [t for t in work["tags"] if t.lower() not in have]
        tag_add += wanted
    if tag_add or tag_remove:
        ch["tags"] = bulk.TagsOp(add=tag_add, remove=tag_remove)
    if a.get("set_price") is not None:
        ch["price"] = bulk.PriceOp(mode="set", value=float(a["set_price"]))
    elif a.get("price_change_percent") is not None:
        ch["price"] = bulk.PriceOp(mode="percent", value=float(a["price_change_percent"]))
    if not ch:
        return {"error": "Değişiklik belirtilmedi."}
    changes = bulk.BulkChanges(**ch)
    if lid < 0:
        err = bulk.apply_changes(work, changes)
        if err:
            return {"error": err}
        drafts.save_local(ctx.db, ctx.shop, lid, work, None)
        result = {"id": lid, "ok": True, "changed": True, "error": None}
    else:
        result = bulk.bulk_stage(ctx.db, ctx.shop, bulk.BulkStageIn(listing_ids=[lid], changes=changes))[0]
        if not result["ok"]:
            return {"error": result["error"]}
    after = _current_work(ctx, lid) or work
    ctx.cards.append({
        "type": "listing_update", "listing_id": lid, "title": after["title"], "edit_url": f"/listings/{lid}/edit",
        "changes": [k for k in ch], "tags": after["tags"],
    })
    return {"ok": True, "degisti": result["changed"], "duzenleyici_baglantisi": f"/listings/{lid}/edit", "yeni_baslik": after["title"],
            "not": "Değişiklik yalnızca yerel taslak olarak kaydedildi; Etsy'ye gitmedi. Kullanıcı düzenleyicide 'Etsy'de yayınla' ile gönderir."}


# ------------------------------------------------------------------ araç tanımları

def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


DATE = {"type": "string", "description": "YYYY-MM-DD"}

TOOLS: list[dict] = [
    {"name": "finance_summary", "description": "Belirli bir dönem için finans özeti: satış, Etsy ücretleri, reklam, ürün maliyeti, net kâr, marj, iade, geçen yılla karşılaştırma ve en çok satış yapılan ülkeler. Tarih verilmezse bu yıl başından bugüne.", "input_schema": _obj({"start_date": DATE, "end_date": DATE, "country": {"type": "string", "description": "İsteğe bağlı 2 harfli ülke kodu (US, DE...)"}})},
    {"name": "monthly_pnl", "description": "Bir yılın aylık kâr-zarar tablosu (satış, ücretler, reklam, ürün maliyeti, net kâr, sipariş).", "input_schema": _obj({"year": {"type": "integer"}})},
    {"name": "compare_periods", "description": "Dönemi geçen yılın AYNI dönemiyle karşılaştırır ve değişimin nedenini gösteren kırılımı verir: düşen/yükselen ürünler, ülkeler, aylar, sipariş sayısı ve ortalama sepet, reklam payı. 'Neden düştü/arttı', 'geçen yıla göre nasıl' sorularında MUTLAKA bunu kullan.", "input_schema": _obj({"start_date": DATE, "end_date": DATE})},
    {"name": "ads_summary", "description": "Reklam harcaması (Etsy Ads + Offsite Ads) ve satışa oranı, geçen yılın aynı dönemiyle. Reklamın getirdiği satışı (ROAS) vermez.", "input_schema": _obj({"start_date": DATE, "end_date": DATE})},
    {"name": "listing_performance", "description": "Tek listing'in dönem performansı: satış (adet/tutar, önceki eşit dönemle), görüntülenme/favori artışı (günlük biriktirilen anlık görüntülerden), dönüşüm ve İÇERİĞİN son değişikliği (kaç gündür güncellenmedi). Tarih verilmezse son 90 gün.", "input_schema": _obj({"listing_id": {"type": "integer"}, "start_date": DATE, "end_date": DATE}, ["listing_id"])},
    {"name": "stale_listings", "description": "Uzun süredir güncellenmemiş aktif listing'leri satış eğilimleriyle listeler ('hangi listing'leri yenilemeliyim', 'ne kadardır güncellenmedi' soruları için).", "input_schema": _obj({"min_days": {"type": "integer", "description": "Varsayılan 60"}, "limit": {"type": "integer"}})},
    {"name": "save_ad_report", "description": "Kullanıcı bir listing için Etsy Ads verisi yapıştırdığında çağır: metrikleri (CTR, tıklama başına maliyet, ROAS, dönüşüm) hesaplar, kapatma/koruma adaylarını çıkarır, raporu kaydeder ve önceki raporla kıyaslar.", "input_schema": _obj({
        "listing_id": {"type": "integer", "description": "Biliniyorsa (search_listings ile bul)"}, "listing_title": {"type": "string"},
        "period_start": DATE, "period_end": DATE, "spend": {"type": "number"}, "views": {"type": "integer"}, "clicks": {"type": "integer"}, "orders": {"type": "integer"}, "revenue": {"type": "number"},
        "keywords": {"type": "array", "items": _obj({"keyword": {"type": "string"}, "views": {"type": "integer"}, "clicks": {"type": "integer"}, "orders": {"type": "integer"}, "spend": {"type": "number"}, "revenue": {"type": "number"}}, ["keyword"])},
        "note": {"type": "string"}}, ["spend", "views", "clicks", "orders", "revenue"])},
    {"name": "ad_reports", "description": "Daha önce kaydedilmiş reklam raporları (isteğe bağlı listing'e göre), dönemler arası karşılaştırma için.", "input_schema": _obj({"listing_id": {"type": "integer"}, "limit": {"type": "integer"}})},
    {"name": "top_products", "description": "Dönemin en iyi ürünleri (satış, kâr, adet, marj) ve her ürünün geçen yılın AYNI dönemindeki adet/satışı.", "input_schema": _obj({"start_date": DATE, "end_date": DATE, "sort_by": {"type": "string", "enum": ["sales", "profit", "units"]}, "limit": {"type": "integer"}})},
    {"name": "list_orders", "description": "Siparişleri listeler: to_ship (gönderilecek), overdue (gecikmiş), recent (son siparişler) ya da search (alıcı/ürün/sipariş no arama).", "input_schema": _obj({"filter": {"type": "string", "enum": ["to_ship", "overdue", "recent", "search"]}, "query": {"type": "string"}, "limit": {"type": "integer"}})},
    {"name": "search_listings", "description": "Mağazadaki listing'lerde başlığa göre arar (en çok görüntülenenden başlar).", "input_schema": _obj({"query": {"type": "string"}, "limit": {"type": "integer"}})},
    {"name": "get_listing", "description": "Bir listing'in mevcut başlığı, etiketleri, açıklaması ve fiyatı (düzenlemeden önce bakmak için).", "input_schema": _obj({"listing_id": {"type": "integer"}}, ["listing_id"])},
    {"name": "shop_defaults", "description": "Yeni listing için mağazanın en çok kullanılan kategorileri, kargo profili ve iade politikası.", "input_schema": _obj({})},
    {"name": "similar_listings", "description": "Mağazadaki benzer listing'leri bulur (İngilizce anahtar kelimelerle): fiyatlarını, etiketlerini, başlık üslubunu ve açıklama örneğini verir. Yeni listing'de fiyat ve üslup için MUTLAKA bak.", "input_schema": _obj({"query": {"type": "string", "description": "İngilizce ürün anahtar kelimeleri, ör. 'mountain metal wall art'"}, "limit": {"type": "integer"}}, ["query"])},
    {"name": "find_category", "description": "Etsy kategori ağacında ada göre arar ve kategori kimliği (taxonomy_id) bulur.", "input_schema": _obj({"query": {"type": "string"}}, ["query"])},
    {"name": "create_listing_draft", "description": "Yeni listing YEREL TASLAĞI oluşturur (Etsy'ye göndermez). Kullanıcının verdiği bilgileri ve sohbete yüklediği resimleri (image_ids) kullanır; verilmeyen fiyat/adet mağazanın tipik değerleriyle doldurulur. Kullanıcı SEO uyumlu yazmanı isterse ya da bilgi kabaysa başlık, 13 etiket ve açıklamayı sen üret; ürünün gerçek özelliklerini uydurma.", "input_schema": _obj({
        "title": {"type": "string", "description": "En fazla 140 karakter, doğal okunan, ilk 40 karakterde ana anahtar kelime"},
        "description": {"type": "string", "description": "YALNIZCA ürüne özel kısım (satış paragrafı + özellik maddeleri). Mağazanın sabit bölümleri otomatik eklenir; onları yazma"},
        "tags": {"type": "array", "items": {"type": "string"}, "description": "En fazla 13 etiket, her biri en fazla 20 karakter"},
        "price": {"type": "number", "description": "Mağaza para biriminde birim fiyat. Kullanıcı vermediyse similar_listings fiyatlarından mantıklı bir değer seç (boyut/malzeme farkını düşün); hiç veri yoksa boş bırak"},
        "price_source": {"type": "string", "enum": ["user", "similar", "typical"], "description": "Fiyatın kaynağı: user = kullanıcı verdi, similar = benzer listing'lerden çıkardım, typical = mağaza medyanı"},
        "dimensions": _obj({"length": {"type": "number"}, "width": {"type": "number"}, "height": {"type": "number"}, "unit": {"type": "string", "enum": ["mm", "cm", "m", "in", "ft"]}}),
        "use_standard_sections": {"type": "boolean", "description": "Mağazanın sabit açıklama bölümlerini (iletişim, işleme/teslimat, garanti, yasal uyarı) açıklamaya otomatik ekle. Varsayılan true"},
        "quantity": {"type": "integer", "description": "Stok adedi. Kullanıcı vermediyse BOŞ BIRAK: mağazanın tipik adedi kullanılır"},
        "materials": {"type": "array", "items": {"type": "string"}},
        "variations": {"type": "array", "description": "En fazla 3 varyasyon. Fiyat yalnızca bir varyasyona göre değişebilir.", "items": _obj({"name": {"type": "string"}, "values": {"type": "array", "items": _obj({"value": {"type": "string"}, "price": {"type": "number", "description": "Bu seçeneğin fiyatı (isteğe bağlı)"}}, ["value"])}}, ["name", "values"])},
        "image_ids": {"type": "array", "items": {"type": "string"}, "description": "Sohbete yüklenen resimlerin kimlikleri (sistem mesajındaki listeden)"},
        "image_alt_texts": {"type": "array", "items": {"type": "string"}, "description": "Her resim için, image_ids ile AYNI SIRADA alt metin: resimde gerçekten görünenin tek cümlelik betimlemesi (en fazla 125 karakter, 'image of' ile başlama, anahtar kelime doldurma), başlıkla aynı dilde"},
        "taxonomy_id": {"type": "integer", "description": "Kategori kimliği (shop_defaults'tan)"},
        "who_made": {"type": "string", "enum": ["i_did", "someone_else", "collective"]},
        "when_made": {"type": "string"},
    }, ["title"])},
    {"name": "update_listing", "description": "Var olan bir listing'in başlık, açıklama, etiket veya fiyatını YEREL TASLAK olarak değiştirir (Etsy'ye göndermez). Önce get_listing ile mevcut hâline bak.", "input_schema": _obj({
        "listing_id": {"type": "integer"}, "new_title": {"type": "string"}, "new_description": {"type": "string"},
        "set_tags": {"type": "array", "items": {"type": "string"}, "description": "Etiketlerin tamamını bununla değiştirir (en fazla 13)"},
        "add_tags": {"type": "array", "items": {"type": "string"}}, "remove_tags": {"type": "array", "items": {"type": "string"}},
        "set_price": {"type": "number"}, "price_change_percent": {"type": "number", "description": "Örn. 10 = %10 zam, -5 = %5 indirim"},
    }, ["listing_id"])},
]

# Kullanıcıya gösterilen ilerleme metinleri ("asistan şu an ne yapıyor").
TOOL_LABELS = {
    "finance_summary": "Finans verilerine bakıyor",
    "monthly_pnl": "Aylık kâr-zarar tablosunu hazırlıyor",
    "top_products": "En iyi ürünleri karşılaştırıyor",
    "compare_periods": "Geçen yılın aynı dönemiyle karşılaştırıyor",
    "listing_performance": "Listing performansına bakıyor",
    "stale_listings": "Güncellenmemiş listing'leri tarıyor",
    "save_ad_report": "Reklam verisini hesaplıyor",
    "ad_reports": "Reklam raporlarını getiriyor",
    "ads_summary": "Reklam harcamasını inceliyor",
    "list_orders": "Siparişleri getiriyor",
    "search_listings": "Listing'lerde arıyor",
    "get_listing": "Listing'i okuyor",
    "shop_defaults": "Mağaza varsayılanlarına bakıyor",
    "find_category": "Kategori arıyor",
    "similar_listings": "Benzer listing'leri inceliyor",
    "create_listing_draft": "Taslağı oluşturuyor",
    "update_listing": "Taslağı güncelliyor",
}

EXECUTORS = {
    "finance_summary": finance_summary, "monthly_pnl": monthly_pnl, "top_products": top_products, "listing_performance": listing_performance, "stale_listings": stale_listings, "save_ad_report": save_ad_report, "ad_reports": ad_reports, "compare_periods": compare_periods, "ads_summary": ads_summary, "list_orders": list_orders,
    "search_listings": search_listings, "get_listing": get_listing, "shop_defaults": shop_defaults, "find_category": find_category, "similar_listings": similar_listings,
    "create_listing_draft": create_listing_draft, "update_listing": update_listing,
}


def execute(ctx: Ctx, name: str, args: dict) -> dict:
    fn = EXECUTORS.get(name)
    if fn is None:
        return {"error": f"Bilinmeyen araç: {name}"}
    try:
        return fn(ctx, args or {})
    except (ValueError, KeyError, TypeError) as exc:  # doğrulama hataları (ör. 20 karakteri aşan etiket) modele anlaşılır döner
        msg = str(exc)
        if hasattr(exc, "errors"):  # pydantic: yalnızca okunur hata iletileri
            msg = "; ".join(str(e.get("msg", "")).removeprefix("Value error, ") for e in exc.errors())
        return {"error": msg[:400]}

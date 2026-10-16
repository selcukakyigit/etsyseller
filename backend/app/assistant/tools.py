"""Asistanın kullanabildiği araçlar. Okuma araçları mevcut finans/sipariş/listing servislerini çağırır (sayıları model
hesaplamaz). Yazma araçları YALNIZCA yerel taslak üretir/düzenler; Etsy'ye hiçbir şey göndermez (yayın, listing
düzenleyicisindeki "Etsy'de yayınla" düğmesiyle yapılır)."""
import copy
import datetime as dt
import html
import itertools
import json
import re
import statistics
import time
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import func, select

from app.assistant import fields, inventory_edit, listing_view
from app.ai import catalog, video_gen
from app.listings import generation
from app.core import blobstore
from app.core.ttl_cache import cached
from app.core.i18n import tr
from sqlalchemy.orm import Session

from app.ai import quality
from app.assistant import toolsets
from app.assistant.models import AdReport, ChatImage
from app.finance import invoices
from app.finance import service as fin
from app.listings import bulk, creation, drafts, performance, templates
from app.listings import service as listing_service
from app.keywords import service as keyword_service
from app.listings import sync_status as listing_sync
from app.listings.models import ListingCache, ListingLocal
from app.orders import service as orders_service
from app.orders.models import OrderCache
from app.shops import reference_cache
from app.shops.models import Shop
from app.taxonomy import service as taxonomy_service

CUSTOM_VARIATION_IDS = [513, 514, 516]  # Etsy'nin serbest isimli varyasyon kimlikleri
MAX_COMBOS = 400
_taxonomy_cache: dict[int, str] | None = None  # kategori kimliği -> "Ev & Yaşam > Duvar Dekoru > ..." (bir kez yüklenir)
_taxonomy_leaves: set[int] = set()  # alt kategorisi olmayan (ürünün atanabileceği) düğümler


def _taxonomy() -> dict[int, str]:
    global _taxonomy_cache
    if _taxonomy_cache is None:
        flat: dict[int, str] = {}

        def walk(nodes: list[dict], path: list[str]) -> None:
            for n in nodes:
                p = [*path, n.get("name", "")]
                flat[n["id"]] = " > ".join(p)
                if not n.get("children"):
                    _taxonomy_leaves.add(n["id"])
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
    message: str = ""  # kullanıcının bu mesajı (yapıştırılan fatura metni gibi, modele yeniden yazdırmadan okumak için)
    cards: list[dict] = field(default_factory=list)
    session_id: int | None = None  # sohbet oturumu: üretilen resimler bu oturuma kaydedilir


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
        "title": tr(f"Finans özeti ({rng})", f"Finance summary ({rng})"),
        "currency": cur,
        "kpis": [
            {"label": tr("Satış (vergi hariç)", "Sales (excl. tax)"), "value": _r(k["sales"]), "prev": _r(p["sales"])},
            {"label": tr("Sipariş", "Orders"), "value": k["orders"], "prev": p["orders"], "count": True},
            {"label": tr("Etsy ücretleri", "Etsy fees"), "value": _r(k["fees"]), "prev": _r(p["fees"]), "invert": True},
            {"label": tr("Reklam / diğer giderler", "Ads / other costs"), "value": _r(k["overhead"]), "prev": _r(p["overhead"]), "invert": True},
            {"label": tr("Ürün + kargo maliyeti", "Item + shipping cost"), "value": _r(k["cogs"]), "prev": _r(p["cogs"]), "invert": True},
            {"label": tr("Net kâr", "Net profit"), "value": _r(k["profit"]), "prev": _r(p["profit"]), "highlight": True},
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
        "type": "pnl", "title": tr(f"{year} aylık kâr-zarar", f"{year} monthly profit and loss"), "currency": cur,
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
        "type": "products", "title": tr(f"En iyi ürünler ({start} – {end}) · karşılaştırma: {ps} – {pe}", f"Top products ({start} – {end}) · compared with {ps} – {pe}"), "currency": r["currency"],
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

    ctx.cards.append({"type": "movers", "title": tr(f"Değişim: {start} – {end} ↔ {ps} – {pe}", f"Change: {start} – {end} ↔ {ps} – {pe}"), "currency": cur["currency"], "rows": drops + gains})
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
    from app.insights import impact
    from app.listings import changes

    r["degisiklikler"] = [changes.serialize(c) for c in impact.listing_changes(ctx.db, ctx.shop, lid, ctx.today)[:5]]
    r["degisiklik_notu"] = (
        "degisiklikler: Etsy'ye giden son değişiklikler (yeniden eskiye) ve ölçülen etkisi. result.verdict: better/worse (istatistiksel olarak "
        "anlamlı; result.confidence high/medium), unclear (fark büyük ama tesadüf olabilir — kesin konuşma), same, low_data. result.net: listing'in "
        "değişimi, kontrol grubunun (aynı dönemde dokunulmamış, mümkünse aynı kategorideki listing'ler; result.control) değişimine göre yüzde. "
        "result.metric kararın hangi ölçüte göre verildiğidir. status=waiting ise henüz erken (en az 7 gün gerekir)."
    )
    return r


def stale_listings(ctx: Ctx, a: dict) -> dict:
    """Uzun süredir güncellenmemiş listing'ler ve satış eğilimleri (hangilerini yenilemeye değer)."""
    min_days = int(a.get("min_days") or 60)
    limit = max(1, min(int(a.get("limit") or 12), 25))
    rows = [x for x in performance.stale_listings(ctx.db, ctx.shop, ctx.today) if x["state"] == "active" and x["days_since_update"] >= min_days]
    rows.sort(key=lambda x: (-x["days_since_update"], -x["units_previous"]))
    rows = rows[:limit]
    ctx.cards.append({"type": "stale", "title": tr(f"{min_days}+ gündür güncellenmeyen aktif listing'ler", f"Active listings not updated for {min_days}+ days"), "rows": [
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
    ctx.cards.append({"type": "ad_report", "title": rep_row.listing_title or tr("Reklam raporu", "Ad report"), "spend": spend, "views": views, "clicks": clicks, "orders": orders, "revenue": revenue,
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
    label = {
        "to_ship": tr("Gönderilecek siparişler", "Orders to ship"),
        "overdue": tr("Gecikmiş siparişler", "Overdue orders"),
        "search": tr("Arama sonucu", "Search results"),
        "recent": tr("Son siparişler", "Recent orders"),
    }.get(kind, tr("Siparişler", "Orders"))
    ctx.cards.append({
        "type": "orders", "title": label,
        "rows": [{"receipt_id": x["siparis_no"], "buyer": x["alici"], "country": x["ulke"], "date": x["tarih"], "ship_by": x["gonderim_tarihi"], "total": x["tutar"], "items": x["urunler"]} for x in out],
    })
    return {"filtre": kind, "sayi": len(out), "siparisler": out}


_LISTING_STATES = ("active", "inactive", "draft", "sold_out", "expired")


def _state_like(state: str):
    return ListingCache.raw_json.like(f'%"state": "{state}"%')  # kaba süzgeç; kesin kontrol satır okunurken yapılır


def search_listings(ctx: Ctx, a: dict) -> dict:
    limit = max(1, min(int(a.get("limit") or 10), 50))
    state = a.get("state") if a.get("state") in _LISTING_STATES else None
    q = select(ListingCache).where(ListingCache.shop_id == ctx.shop.id)
    if a.get("query"):
        q = q.where(ListingCache.title.like(f"%{str(a['query']).strip()}%"))
    if state:
        q = q.where(_state_like(state))
    rows = ctx.db.scalars(q.order_by(ListingCache.views.desc()).limit(limit)).all()
    out = []
    for r in rows:
        raw = json.loads(r.raw_json)
        if state and raw.get("state") != state:
            continue
        pr = raw.get("price") or {}
        out.append({"listing_id": r.listing_id, "baslik": html.unescape(r.title), "durum": raw.get("state"), "fiyat": _r(pr["amount"] / pr["divisor"]) if pr.get("divisor") else None, "goruntulenme": r.views, "favori": r.favorites})
    if (state is None or state == "draft") and (a.get("query") is None or len(out) < limit):
        needle = str(a.get("query") or "").strip().lower()
        for r in ctx.db.scalars(select(ListingLocal).where(ListingLocal.shop_id == ctx.shop.id, ListingLocal.listing_id < 0).order_by(ListingLocal.updated_at.desc())):
            title = html.unescape(json.loads(r.data_json).get("title") or "")
            if needle in title.lower():
                out.append({"listing_id": r.listing_id, "baslik": title or "(başlıksız)", "durum": "yayınlanmamış yeni taslak", "fiyat": None, "goruntulenme": 0, "favori": 0})
    counts = {
        st: ctx.db.scalar(select(func.count()).select_from(ListingCache).where(ListingCache.shop_id == ctx.shop.id, _state_like(st))) or 0
        for st in _LISTING_STATES
    }
    counts["yayinlanmamis_yeni_taslak"] = ctx.db.scalar(select(func.count()).select_from(ListingLocal).where(ListingLocal.shop_id == ctx.shop.id, ListingLocal.listing_id < 0)) or 0
    return {"sayi": len(out), "durum_sayilari": counts, "listingler": out[: limit + 5]}


def get_listing(ctx: Ctx, a: dict) -> dict:
    """Listing'in güncel hâli (düzenleyicinin gördüğü): varyasyonlar ve kombinasyonlar, özellikler, kategori, profiller, fotoğraf/video sırası…
    Bir listing'i değiştirmeden ÖNCE bunu oku; hafızandan yazma."""
    work, err = _work_or_error(ctx, int(a["listing_id"]))
    if err:
        return {"error": "Listing bulunamadı (yerelde yok olabilir)."}
    try:
        category = _taxonomy().get(work.get("taxonomy_id"))
    except Exception:  # noqa: BLE001 - kategori adı alınamazsa yalnızca kimlik döner
        category = None
    return listing_view.describe_listing(work, category)


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
    out += quality.title_problems(title)
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


def _variations_of(row: ListingCache) -> list[dict]:
    """Önbellekteki listing'in varyasyonları (ad + ilk seçenekler); benzer listing'lerden varyasyon önerisi için."""
    try:
        work = bulk.snapshot_cached(row)
        return [{"ad": n, "secenekler": inventory_edit.options(work, n)[:8]} for n in inventory_edit.variation_names(work)]
    except Exception:  # noqa: BLE001 - envanter okunamazsa varyasyon bilgisi verilmez
        return []


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
            "varyasyonlar": _variations_of(row),
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


_CAT_STOP = {"the", "and", "for", "with", "your", "custom", "personalized", "gift", "gifts", "modern", "unique", "design", "style", "set"}
_CAT_WORD = re.compile(r"[a-z]+")


def _cat_words(text: str) -> set[str]:
    """Küçük harfli, basit tekilleştirilmiş kelimeler ("signs" → "sign")."""
    return {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in _CAT_WORD.findall(text.lower()) if len(w) > 2 and w not in _CAT_STOP}


def _auto_category(ctx: Ctx, text: str) -> tuple[int, str, str] | None:
    """Model kategori vermediyse Etsy'nin sabit kategori ağacından ürüne en uygun (alt kategorisi olmayan) düğümü seçer:
    başlık/etiket kelimeleriyle yol adı örtüşmesi, mağazanın zaten kullandığı kategoriler ve derinlik puanlanır. Hiç örtüşme
    yoksa mağazanın en çok kullandığı kategori. Döner: (kimlik, yol, neden) ya da None."""
    names = _taxonomy()
    used = {c["taxonomy_id"] for c in listing_service.get_top_categories(ctx.db, ctx.shop, limit=50)}
    words = _cat_words(text)
    best: tuple[float, int] | None = None
    for tid, path in names.items():
        if tid not in _taxonomy_leaves:
            continue
        leaf = path.rsplit(">", 1)[-1]
        leaf_overlap = len(words & _cat_words(leaf))
        rest_overlap = len(words & _cat_words(path)) - leaf_overlap
        if not leaf_overlap and not rest_overlap:
            continue
        # Yaprak adı eşleşmesi ağır basar (uzun yolun üst düğümleri kelime toplayıp kazanmasın); mağazanın zaten kullandığı
        # kategori, ürünle en az bir kelime örtüşüyorsa öne geçer (aynı tür ürün aynı kategoriye girer).
        score = leaf_overlap * 4 + rest_overlap + (5 if tid in used else 0)
        if best is None or score > best[0]:
            best = (score, tid)
    if best is not None:
        return best[1], names[best[1]], "başlık/etiketlerle eşleşti"
    top = listing_service.get_top_categories(ctx.db, ctx.shop, limit=1)
    if top and top[0]["taxonomy_id"] in names:
        return top[0]["taxonomy_id"], names[top[0]["taxonomy_id"]], "mağazanın en çok kullandığı kategori"
    return None


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

    def offering(p: float, q: int = quantity) -> dict:
        return {"price": {"amount": round(p * 100), "divisor": 100, "currency_code": cur}, "quantity": q, "is_enabled": True}

    if not variations:
        work["inventory"]["products"] = [{"sku": "", "property_values": [], "offerings": [offering(price)]}]
        work["inventory"]["price_on_property"], work["inventory"]["quantity_on_property"], work["inventory"]["sku_on_property"] = [], [], []
        return None
    if len(variations) > 3:
        return "En fazla 3 varyasyon tanımlanabilir."
    props = []
    for i, v in enumerate(variations):
        vals = [x if isinstance(x, dict) else {"value": x} for x in v.get("values", [])]
        vals = [{"value": str(x["value"]).strip(), "price": x.get("price"), "quantity": x.get("quantity")} for x in vals if str(x.get("value", "")).strip()]
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
        p_val, q_val = price, quantity
        for prop, val in zip(props, combo):
            if prop in varying and val["price"] is not None:
                p_val = float(val["price"])
            if val.get("quantity"):  # "100 cm: 10 adet, 50 cm: 5 adet": seçenek başına stok
                q_val = max(1, min(int(val["quantity"]), inventory_edit.MAX_QUANTITY))
        products.append({
            "sku": "",
            "property_values": [{"property_id": prop["id"], "property_name": prop["name"], "scale_id": None, "value_ids": [], "values": [val["value"]]} for prop, val in zip(props, combo)],
            "offerings": [offering(p_val, q_val)],
        })
    work["inventory"]["products"] = products
    work["inventory"]["price_on_property"] = [varying[0]["id"]] if varying else []
    return inventory_edit.recompute_dependencies(work)  # stok/SKU hangi varyasyona göre değişiyorsa Etsy kuralına uygun işaretlenir


def _listing_card(ctx: Ctx, lid: int, work: dict, changes: list[str] | None = None, *, category: str | None = None, price_missing: bool | None = None, qty_assumed: bool = False) -> dict:
    """Listing'in güncel hâlini gösteren kart (küçük resim, fiyat, adet, etiketler, eksikler). Oluşturma ve her düzenleme aynı kartı
    gösterir; `changes` o işlemde değişen alanlardır."""
    offers = [o for p in (work.get("inventory") or {}).get("products", []) for o in p.get("offerings", [])]
    prices = [o["price"]["amount"] / o["price"]["divisor"] for o in offers if isinstance(o.get("price"), dict) and o["price"].get("divisor")]
    products = (work.get("inventory") or {}).get("products", [])
    images = sorted(work.get("images") or [], key=lambda i: i.get("rank") or 0)
    if category is None and work.get("taxonomy_id"):
        try:
            category = _taxonomy().get(work["taxonomy_id"])
        except Exception:  # noqa: BLE001 - kategori adı alınamazsa kartta gösterilmez
            category = None
    card = {
        "type": "listing_draft", "listing_id": lid, "title": work.get("title") or "", "edit_url": f"/listings/{lid}/edit",
        "price": [min(prices), max(prices)] if prices else [0, 0], "quantity": offers[0].get("quantity", 0) if offers else 0, "tags": work.get("tags") or [],
        "combos": len(products) if products and products[0].get("property_values") else 0,
        "image": images[0].get("url_170x135") if images else None, "images": len(images),
        "problems": creation.validate_new(work, activate=True) if lid < 0 else [],
        "category": category, "price_missing": (not any(p > 0 for p in prices)) if price_missing is None else price_missing, "quantity_assumed": qty_assumed,
    }
    if changes:
        card["changes"] = changes
    return card


def _show_listing(ctx: Ctx, lid: int, work: dict, changes: list[str] | None = None, **kw) -> None:
    """Listing kartını gösterir. Aynı yanıtta aynı listing için birden çok işlem yapılırsa tek kart kalır: en güncel hâli, tüm değişenlerle."""
    card = _listing_card(ctx, lid, work, changes, **kw)
    for earlier in [c for c in ctx.cards if c.get("type") == "listing_draft" and c.get("listing_id") == lid]:
        ctx.cards.remove(earlier)
        merged = list(dict.fromkeys([*earlier.get("changes", []), *card.get("changes", [])]))
        if merged:
            card["changes"] = merged
    ctx.cards.append(card)


def create_listing_draft(ctx: Ctx, a: dict) -> dict:
    title = " ".join(str(a.get("title", "")).split())[: bulk.TITLE_MAX]
    if not title:
        return {"error": "Başlık gerekli."}
    tags_checked, _short = _tags(a.get("tags") or [])
    others = quality.shop_others(ctx.db, ctx.shop.id)
    problems_pre = quality.all_problems(title, tags_checked, str(a.get("description") or ""), others)
    if problems_pre:
        return {"error": "Taslak henüz oluşturulmadı. Önce şunları düzelt ve create_listing_draft'ı tekrar çağır (mağazanın diğer listing'lerinin kopyası olmamalı): " + " ".join(problems_pre)}
    _, norm_qty = _shop_norms(ctx)
    qty_assumed = not a.get("quantity")
    # Fiyat yalnızca kullanıcının söylediği değerdir: verilmediyse 0 kalır ve taslak "Fiyat gir." ile yayına hazır sayılmaz.
    price_missing = not a.get("price")
    price = 0.0 if price_missing else float(a["price"])
    if not price_missing and price < bulk.MIN_PRICE:
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
    tpl, tpl_err = _pick_template(ctx, a)
    if tpl_err:
        creation_cleanup(ctx, lid)
        return {"error": tpl_err}
    if tpl is not None or not a.get("use_standard_sections", True):
        description, std_count = str(a.get("description") or ""), 0  # şablon aşağıda, envanter hazır olunca uygulanır
    else:
        description, std_count = _with_standard_sections(ctx.db, ctx.shop.id, str(a.get("description") or ""))
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
    category_note = None
    if work["taxonomy_id"] is None:  # model vermediyse sunucu en uygun kategoriyi seçer; kullanıcıya gösterilir, değiştirilebilir
        try:
            auto = _auto_category(ctx, " ".join([title, *tags, *(str(m) for m in a.get("materials") or [])]))
        except Exception:  # noqa: BLE001 - kategori ağacı alınamazsa taslak kategorisiz kalır ("Kategori seç." eksiği çıkar)
            auto = None
        if auto is not None:
            work["taxonomy_id"], category_path, why = auto
            category_note = {"yol": category_path, "neden": why, "otomatik_secildi": True}
    elif work["taxonomy_id"] in _taxonomy():
        category_note = {"yol": _taxonomy()[work["taxonomy_id"]], "otomatik_secildi": False}
    work["shipping_profile_id"] = int(a["shipping_profile_id"]) if a.get("shipping_profile_id") else defaults["en_cok_kullanilan_kargo_profili_id"]
    work["return_policy_id"] = int(a["return_policy_id"]) if a.get("return_policy_id") else defaults["en_cok_kullanilan_iade_politikasi_id"]
    if tpl is not None:
        work["description"] = templates.applier(ctx.db, ctx.shop, tpl)(work)

    # Alt metinler: model resimleri zaten gördüğü için image_ids ile aynı sırada verir (en fazla 500 karakter, önerilen 125).
    ids_in = [str(i) for i in (a.get("image_ids") or [])[:creation.MAX_LISTING_IMAGES]]
    alts = [" ".join(str(t).split())[:500] for t in (a.get("image_alt_texts") or [])]
    alt_by_image = {iid: alts[i] for i, iid in enumerate(ids_in) if i < len(alts) and alts[i]}
    attached = 0
    for n, image_id in enumerate((a.get("image_ids") or [])[: creation.MAX_LISTING_IMAGES], start=1):
        img = ctx.db.get(ChatImage, str(image_id))
        if img is None or img.shop_id != ctx.shop.id:
            continue
        saved = drafts.save_file(ctx.db, ctx.shop, lid, "image", img.filename, img.content_type, blobstore.read(img.path))
        url = creation._file_url(ctx.shop, lid, saved["file_id"])
        attached += 1
        work["images"].append({
            "listing_image_id": -attached, "draft_file_id": saved["file_id"], "rank": attached, "alt_text": alt_by_image.get(str(image_id)),
            "url_75x75": url, "url_170x135": url, "url_570xN": url, "url_fullxfull": url,
        })
    # Kategori özellikleri ve kişiselleştirme taslakla BİRLİKTE yazılır; doğrulama hataları ve eksik zorunlu özellikler sonuçta döner.
    completion: dict = {}
    if a.get("personalization_questions"):
        _, q_errors = fields.apply_fields(work, {"personalization_questions": a["personalization_questions"]})
        if q_errors:
            completion["kisisellestirme_hatalari"] = q_errors
    if work.get("taxonomy_id"):
        try:
            defs = _category_defs(int(work["taxonomy_id"]))
        except Exception as exc:  # noqa: BLE001 - özellikler alınamazsa taslak yine oluşur, model get_category_attributes ile yeniden dener
            completion["ozellikler_alinamadi"] = str(exc)
        else:
            if a.get("attributes"):
                _, attr_errors = fields.apply_attributes(work, defs, list(a["attributes"]))
                if attr_errors:
                    completion["ozellik_hatalari"] = attr_errors
            described = fields.describe(defs, work)
            completion["eksik_zorunlu_ozellikler"] = described["eksik_zorunlu"]
            completion["doldurulabilecek_bos_ozellikler"] = [r["ad"] for r in described["ozellikler"] if not r["secili"] and not r["zorunlu"]][:12]
    wanted = int(a.get("wanted_image_count") or 0)
    if wanted > attached:
        completion["eksik_resim"] = min(wanted, creation.MAX_LISTING_IMAGES) - attached
    for spec in a.get("crop_photos") or []:  # "birinci resmi 1:1 kırp": taslakla birlikte, resimler eklendikten sonra
        bad = _crop_in_work(ctx, lid, work, int(spec.get("photo_number") or 1), spec)
        if bad:
            completion.setdefault("kirpma_hatalari", []).append(bad)
    text_all = " ".join([title, str(a.get("description") or ""), *tags]).lower()
    if not (work.get("personalization") or {}).get("questions") and re.search(r"personali[sz]|custom (name|text)|engrav|monogram|your name", text_all):
        completion["kisisellestirme_eksik"] = (
            "Başlık/açıklama kişiselleştirmeden söz ediyor ama listing'de kişiselleştirme (Özel seçenekler) sorusu yok. Kullanıcı isim/yazı istediyse "
            "set_listing_fields.add_personalization_questions ile ekle (açıklamaya gömme); 'Can be personalized' özelliğini de Yes yap."
        )
    missing_alt = sum(1 for i in work.get("images") or [] if not i.get("alt_text"))
    if missing_alt:
        completion["alt_metni_eksik_resim"] = missing_alt
    videos_attached = 0
    for chat_video_id in (a.get("video_ids") or [])[: generation.MAX_LISTING_VIDEOS]:
        file, bad = _chat_video_file(ctx, lid, chat_video_id)
        if bad or _attach_video(ctx, lid, work, file):
            completion.setdefault("video_hatalari", []).append(bad or "Video eklenemedi.")
        else:
            videos_attached += 1
    completion["eklenen_video"] = videos_attached
    completion["standart_varyasyona_cevrilen"] = _standardize(work)
    drafts.save_local(ctx.db, ctx.shop, lid, work, None)
    problems = creation.validate_new(work, activate=True)
    _show_listing(ctx, lid, work, category=category_note["yol"] if category_note else None, price_missing=price_missing, qty_assumed=qty_assumed)
    if completion.get("eksik_resim") or completion.get("kisisellestirme_eksik") or completion.get("kirpma_hatalari") or completion.get("ozellik_hatalari") or completion.get("kisisellestirme_hatalari") or completion.get("eksik_zorunlu_ozellikler") or completion.get("video_hatalari"):
        completion["sonraki_adim"] = (
            "Taslak EKSİK; kullanıcıya yazmadan önce tamamla: eksik_resim>0 ise edit_chat_image ile (add_to_listing=true, listing_id) o kadar FARKLI görsel üret; "
            "hatalı ya da eksik özellikleri set_listing_attributes ile, kişiselleştirme hatalarını/eksikliğini set_listing_fields ile düzelt; "
            "yeni üretilen görsellerin alt metni için resimler eklendikten sonra generate_missing_alt_texts çağır; "
            "doldurulabilecek_bos_ozellikler'den ürüne uyanları doldur."
        )
    return {
        **completion,
        "listing_id": lid, "duzenleyici_baglantisi": f"/listings/{lid}/edit", "eklenen_resim": attached, "kategori": category_note,
        "varyasyon_kombinasyonu": len(work["inventory"]["products"]) if work["inventory"]["products"][0]["property_values"] else 0,
        "kisaltilan_etiketler": shortened, "yayin_icin_eksikler": problems,
        "mağaza_sabit_bolumleri_eklendi": std_count, "kullanilan_aciklama_sablonu": tpl.name if tpl is not None else None,
        "acilmayan_tek_secenekli_varyasyon": dropped_variations,
        "varsayilanlar": {"fiyat_verilmedi": price_missing, "adet_mağaza_tipik_degeri_kullanildi": qty_assumed, "fiyat": None if price_missing else price},
        "not": "Bu yalnızca yerel taslaktır; Etsy'ye gitmedi. Kullanıcı düzenleyicide kontrol edip 'Etsy'de yayınla' düğmesine basmalı.",
    }


def _pick_template(ctx: Ctx, a: dict):
    """create_listing_draft için şablon: verilen kimlik, 0 = şablonsuz, verilmediyse mağazanın varsayılanı."""
    tid = a.get("description_template_id")
    if tid is None:
        return templates.default(ctx.db, ctx.shop), None
    if int(tid) == 0:
        return None, None
    try:
        return templates.get(ctx.db, ctx.shop, int(tid)), None
    except templates.TemplateError as exc:
        return None, str(exc)


# ------------------------------------------------------------------ hazır açıklama metinleri (şablonlar)

def list_description_templates(ctx: Ctx, a: dict) -> dict:
    rows = templates.list_templates(ctx.db, ctx.shop)
    return {
        "sablonlar": [{"id": t.id, "ad": t.name, "varsayilan": t.is_default, "metin": t.body} for t in rows],
        "yer_tutucular": [f"{{{p}}}" for p in templates.PLACEHOLDERS],
        "not": "{product} satırı ürüne özel yazının yeridir (yoksa ürün yazısı başa gelir). Değeri boş yer tutucunun satırı atlanır.",
    }


def save_description_template(ctx: Ctx, a: dict) -> dict:
    try:
        if a.get("template_id"):
            t = templates.edit(ctx.db, ctx.shop, int(a["template_id"]), a.get("name"), a.get("body"), a.get("is_default"))
        else:
            t = templates.create(ctx.db, ctx.shop, str(a.get("name") or ""), str(a.get("body") or ""), bool(a.get("is_default")))
    except templates.TemplateError as exc:
        return {"error": str(exc)}
    return {"ok": True, "id": t.id, "ad": t.name, "varsayilan": t.is_default, "not": "Şablon kaydedildi (yalnızca uygulamada; Etsy'ye bir şey gitmedi)."}


def delete_description_templates(ctx: Ctx, a: dict) -> dict:
    ids = [int(i) for i in a.get("template_ids") or []]
    if not ids:
        return {"error": "Silinecek şablon seçilmedi."}
    return {"ok": True, "silinen": templates.delete_many(ctx.db, ctx.shop, ids)}


def read_shipping_invoice(ctx: Ctx, a: dict) -> dict:
    """Sohbete eklenen fatura dosyasını (PDF, resim, Excel/CSV, HTML) ya da mesaja yapıştırılan fatura metnini okur ve
    siparişlerle eşleştirir. KAYDETMEZ: kullanıcı sohbetteki kartta eşleşmeleri kontrol edip onaylayınca kaydedilir."""
    from app.assistant.models import ChatImage
    from app.core import blobstore
    from app.finance import invoices
    from app.finance import service as fin_service

    report_ccy = fin_service.report_currency(ctx.db, ctx.shop)
    try:
        if a.get("file_id"):
            f = ctx.db.get(ChatImage, str(a["file_id"]))
            if f is None or f.shop_id != ctx.shop.id:
                return {"error": "Dosya bulunamadı."}
            source = f.filename
            cands = invoices.parse_file(ctx.db, ctx.shop, blobstore.read(f.path), f.filename, f.content_type, report_ccy)
        else:
            text = ctx.message if a.get("from_message", True) else str(a.get("text") or "")
            source = "yapıştırılan metin"
            cands = invoices.parse_text(ctx.db, ctx.shop, text, report_ccy)
    except invoices.InvoiceError as exc:
        return {"error": str(exc)}
    except FileNotFoundError:
        return {"error": "Dosya depoda bulunamadı; tekrar yükle."}
    ctx.cards.append({"type": "invoice_review", "source": source, "currency": report_ccy, "candidates": cands})
    rows = []
    for n, c in enumerate(cands, start=1):
        best = c["matches"][0] if c["matches"] else None
        rows.append({
            "satir": n, "takip_no": c["tracking_no"], "alici": c["recipient"], "ulke": c["recipient_country"], "tur": c["kind"],
            "tutar": f"{c['original_amount']} {c['original_currency']}", "rapor_tutari": c["amount"],
            "zaten_kayitli": c["already_saved"],
            "en_iyi_eslesme": {"siparis": best["receipt_id"], "alici": best["buyer"], "guven": best["score"], "neden": best["reason"],
                               "olasi_mukerrer": best.get("duplicate_of")} if best else None,
        })
    return {
        "kaynak": source, "satir_sayisi": len(cands), "satirlar": rows[:40],
        "eslesmeyen": sum(1 for c in cands if not c["matches"]), "zaten_kayitli": sum(1 for c in cands if c["already_saved"]),
        "not": "HİÇBİR ŞEY KAYDEDİLMEDİ. Ekrandaki fatura kartında kullanıcı her satırın siparişini kontrol edip 'Onayla' ile kaydeder. "
               "Kısa özet ver: kaç satır, kaçı yüksek güvenle eşleşti, hangileri belirsiz/eşleşmedi, hangileri zaten kayıtlı; "
               "olasi_mukerrer doluysa o siparişe aynı tutarda kalem zaten var, aynı faturanın iki kez yüklenmiş olabileceğini söyle. Kayıt yaptığını SÖYLEME.",
    }


def listing_diagnosis(ctx: Ctx, a: dict) -> dict:
    """Listing'in satış teşhisi (Analiz panelindeki Teşhis sekmesiyle aynı hesap)."""
    from app.insights import diagnosis

    d = diagnosis.diagnose(ctx.db, ctx.shop, int(a["listing_id"]), ctx.today)
    if d is None:
        return {"error": "Listing bulunamadı (yerelde yok olabilir; senkronize edilmesi gerekebilir)."}
    return {
        "durum": d["status"], "baslik": d["headline"], "sebep": d["cause"], "guven": d["confidence"],
        "onerilen_hamle": d["action"]["text"], "mevsim": d["season"]["text"], "dusus_baslangici": d["decline_start"],
        "kanitlar": [e["text"] for e in d["evidence"]], "olaylar": d["events"][:8], "metrikler": d["metrics"],
        "not": "Kullanıcıya kısa özetle: neden düştüğü, kanıtlar ve önerilen tek hamle. Önerilen hamle metin değişikliğiyse update_listing ile taslak önerebilirsin; mevsim uyarısını mutlaka belirt.",
    }


def track_keywords(ctx: Ctx, a: dict) -> dict:
    """Listing'in Etsy aramasındaki sırasının takibi: arama ekle/çıkar, istenirse hemen ölç."""
    from app.insights import rank

    lid = int(a["listing_id"])
    errors = []
    for kw in a.get("remove") or []:
        rank.remove_keyword(ctx.db, ctx.shop, lid, str(kw))
    for kw in a.get("add") or []:
        try:
            rank.add_keyword(ctx.db, ctx.shop, lid, str(kw))
        except rank.RankError as exc:
            errors.append(str(exc))
    if a.get("measure_now"):
        try:
            rank.measure_listing(ctx.db, ctx.shop, lid)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Ölçülemedi: {str(exc)[:150]}")
    data = rank.listing_ranks(ctx.db, ctx.shop, lid)
    return {
        "takip_edilen_aramalar": [{"arama": k["keyword"], "sira": k["position"], "olculdu": k["measured"], "rakip": k["total_results"], "degisim_30g": k["change_30d"]} for k in data["keywords"]],
        "oneriler": data["suggestions"], "sinirlar": f"listing başına {data['max_keywords']} arama, mağaza başına {data['max_listings']} listing ({data['tracked_listings']} takipte)",
        "hatalar": errors,
        "not": "Sıra her sabah otomatik ölçülür; sira=None ve olculdu doluysa listing ilk 200 sonuçta yok demektir.",
    }


def read_etsy_keyword_data(ctx: Ctx, a: dict) -> dict:
    """Etsy panelinden yapıştırılan arama verisini (Marketplace Insights, arama terimleri, Etsy Ads) okur; KAYDETMEZ.
    Kullanıcı sohbetteki kartta kontrol edip kaydeder."""
    from app.assistant.models import ChatImage
    from app.core import blobstore
    from app.insights import etsy_data

    try:
        if a.get("file_id"):
            f = ctx.db.get(ChatImage, str(a["file_id"]))
            if f is None or f.shop_id != ctx.shop.id or not f.content_type.startswith("image/"):
                return {"error": "Ekran görüntüsü bulunamadı."}
            parsed = etsy_data.parse(None, (blobstore.read(f.path), f.content_type))
        else:
            parsed = etsy_data.parse(ctx.message)
    except etsy_data.EtsyDataError as exc:
        return {"error": str(exc)}
    lid = int(a["listing_id"]) if a.get("listing_id") else None
    ctx.cards.append({"type": "etsy_data_review", "listing_id": lid, **parsed})
    return {
        "tur": parsed["source"], "satir": len(parsed["rows"]), "ilk_satirlar": parsed["rows"][:10], "listing_id": lid,
        "not": "HİÇBİR ŞEY KAYDEDİLMEDİ. Ekrandaki kartta kullanıcı satırları kontrol edip 'Kaydet' ile kaydeder. Kısa özet ver: hangi tür veri, kaç satır, öne çıkan kelimeler. Kaydettiğini SÖYLEME.",
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
    ch.update(_ref_changes(a))
    variations = a.get("set_variations")
    if not ch and variations is None:
        return {"error": "Değişiklik belirtilmedi."}
    if variations is not None:
        return _update_variations(ctx, lid, work, ch, a, variations)
    changes = bulk.BulkChanges(**ch)
    if lid < 0:
        try:
            err = bulk.apply_changes(work, changes, bulk.template_applier(ctx.db, ctx.shop, changes))
        except templates.TemplateError as exc:
            return {"error": str(exc)}
        if err:
            return {"error": err}
        drafts.save_local(ctx.db, ctx.shop, lid, work, None)
        result = {"id": lid, "ok": True, "changed": True, "error": None}
    else:
        try:
            result = bulk.bulk_stage(ctx.db, ctx.shop, bulk.BulkStageIn(listing_ids=[lid], changes=changes))[0]
        except templates.TemplateError as exc:
            return {"error": str(exc)}
        if not result["ok"]:
            return {"error": result["error"]}
    after = _current_work(ctx, lid) or work
    _show_listing(ctx, lid, after, [k for k in ch])
    return {"ok": True, "degisti": result["changed"], "duzenleyici_baglantisi": f"/listings/{lid}/edit", "yeni_baslik": after["title"],
            "not": "Değişiklik yalnızca yerel taslak olarak kaydedildi; Etsy'ye gitmedi. Kullanıcı düzenleyicide 'Etsy'de yayınla' ile gönderir."}



def _standardize(work: dict) -> list[str]:
    """Varyasyon adı ve tüm seçenekleri kategorinin standart bir varyasyon özelliğiyle eşleşiyorsa onu standarda çevirir (bkz. inventory_edit.standardize)."""
    if not work.get("taxonomy_id"):
        return []
    try:
        return inventory_edit.standardize(work, _category_defs(int(work["taxonomy_id"])))
    except Exception:  # noqa: BLE001 - özellikler alınamazsa varyasyonlar özel kalır (yine geçerli)
        return []


def _update_variations(ctx: Ctx, lid: int, work: dict, ch: dict, a: dict, variations: list[dict]) -> dict:
    """Aynı listing'in (yerel taslak ya da Etsy'deki listing) varyasyonlarını baştan kurar; YENİ taslak açmaz.
    Fiyat verilmediyse mevcut en düşük fiyat, stok ve işlem profili mevcut listing'den korunur."""
    live = None
    if lid > 0:
        row = ctx.db.scalars(select(ListingCache).where(ListingCache.shop_id == ctx.shop.id, ListingCache.listing_id == lid)).one_or_none()
        if row is None:
            return {"error": "Listing yerelde yok (senkronize et)."}
        live = bulk.snapshot_cached(row)
    tpl_id = ch.pop("description_template_id", None)  # şablon, yeni envanter kurulunca uygulanır ({sizes}/{colors} ondan gelir)
    if ch:
        err = bulk.apply_changes(work, bulk.BulkChanges(**ch))
        if err:
            return {"error": err}
    offers = [o for p in work["inventory"]["products"] for o in p["offerings"]]
    first = offers[0] if offers else {}
    price = float(a["set_price"]) if a.get("set_price") is not None else min((o["price"]["amount"] / o["price"]["divisor"] for o in offers), default=0.0)
    quantity = max(1, int(a.get("quantity") or first.get("quantity") or 1))
    wanted = [v for v in variations if len(v.get("values") or []) > 1]
    err = _build_inventory(work, price, quantity, wanted)
    if err:
        return {"error": err}
    inv = work["inventory"]
    inv["readiness_state_on_property"] = []  # stok/SKU bağımlılıkları _build_inventory'de verilerden kuruldu
    if first.get("readiness_state_id"):  # Etsy fiziksel ürünlerde her teklifte işlem profili ister
        for p in inv["products"]:
            for o in p["offerings"]:
                o["readiness_state_id"] = first["readiness_state_id"]
    # Eski varyasyon-fotoğraf bağları yeni seçeneklere uymaz: yeni taslakta boşalt, Etsy'deki listing'de dokunma.
    work["variation_links"] = None if lid > 0 else {"property_id": None, "images": {}}
    standardized = _standardize(work)
    if tpl_id is not None:
        try:
            work["description"] = templates.applier(ctx.db, ctx.shop, templates.get(ctx.db, ctx.shop, int(tpl_id)))(work)
        except templates.TemplateError as exc:
            return {"error": str(exc)}
        ch["description_template_id"] = tpl_id
    drafts.save_local(ctx.db, ctx.shop, lid, work, live)
    _show_listing(ctx, lid, work, ["variations", *ch.keys()])
    return {"ok": True, "listing_id": lid, "varyasyon_kombinasyonu": len(inv["products"]), "fiyat": price, "adet": quantity, "standart_varyasyona_cevrilen": standardized,
            "not": "Aynı listing'in yerel taslağı güncellendi (yeni taslak açılmadı); Etsy'ye gitmedi."}


# ------------------------------------------------------------------ mağaza seçenekleri, toplu taslak, durum, sipariş, anahtar kelime

_REF_FIELDS = ("shop_section_id", "shipping_profile_id", "return_policy_id", "readiness_state_id", "production_partner_ids", "should_auto_renew", "description_template_id")


def _ref_changes(a: dict) -> dict:
    """update_listing / bulk_update_listings ortak alanları: bölüm, kargo, iade, hazırlık süresi, üretim ortağı, otomatik yenileme."""
    out: dict = {}
    for k in _REF_FIELDS:
        if a.get(k) is None:
            continue
        out[k] = [int(x) for x in a[k]] if k == "production_partner_ids" else (bool(a[k]) if k == "should_auto_renew" else int(a[k]))
    return out


def shop_options(ctx: Ctx, a: dict) -> dict:
    """Bölüm / kargo profili / iade politikası / hazırlık süresi kimlikleri ve adları (yerel önbellekten, kullanan listing sayısıyla)."""
    from app.etsy import shipping as etsy_shipping
    from app.etsy.client import EtsyClient
    from app.shops import shipping_admin as admin

    client = EtsyClient(ctx.db, ctx.shop)
    out: dict = {}
    try:
        secs = reference_cache.get_or_fetch(ctx.db, ctx.shop, "sections", lambda: etsy_shipping.list_shop_sections(client))
        out["bolumler"] = [{"id": x.get("shop_section_id"), "ad": x.get("title")} for x in secs]
        prof = reference_cache.get_or_fetch(ctx.db, ctx.shop, "shipping_profiles", lambda: etsy_shipping.list_shipping_profiles(client))
        cnt = admin.listing_counts(ctx.db, ctx.shop, "shipping_profile_id")
        out["kargo_profilleri"] = [{"id": x.get("shipping_profile_id"), "ad": x.get("title"), "listing_sayisi": cnt.get(x.get("shipping_profile_id"), 0)} for x in prof]
        pol = reference_cache.get_or_fetch(ctx.db, ctx.shop, "return_policies", lambda: etsy_shipping.list_return_policies(client))
        out["iade_politikalari"] = [{"id": x.get("return_policy_id"), "kabul_iade": x.get("accepts_returns"), "kabul_degisim": x.get("accepts_exchanges"), "gun": x.get("return_deadline")} for x in pol]
        rd = reference_cache.get_or_fetch(ctx.db, ctx.shop, "readiness_state_definitions", lambda: etsy_shipping.list_readiness_state_definitions(client))
        out["hazirlik_sureleri"] = [{"id": x.get("readiness_state_id"), "tur": x.get("readiness_state"), "min_gun": x.get("min_processing_time"), "max_gun": x.get("max_processing_time")} for x in rd]
        partners = reference_cache.get_or_fetch(ctx.db, ctx.shop, "production_partners", lambda: etsy_shipping.list_production_partners(client))
        out["uretim_ortaklari"] = [{"id": x.get("production_partner_id"), "ad": x.get("partner_name"), "ulke": x.get("location")} for x in partners]
    except Exception as exc:  # Etsy bağlantısı/yetki hatası: kısmi sonucu yine de döndür
        out["uyari"] = f"Etsy'den bazı seçenekler alınamadı: {str(exc)[:160]}"
    return out


def workspace_status(ctx: Ctx, a: dict) -> dict:
    """Yayınlanmamış yerel değişiklikler/taslaklar ve senkronizasyon durumları."""
    rows = ctx.db.scalars(select(ListingLocal).where(ListingLocal.shop_id == ctx.shop.id).order_by(ListingLocal.updated_at.desc())).all()
    limit = max(1, min(int(a.get("limit") or 15), 40))
    new_rows = [r for r in rows if r.listing_id < 0]
    edited = [r for r in rows if r.listing_id >= 0]

    def brief(r: ListingLocal) -> dict:
        d = json.loads(r.data_json)
        return {"listing_id": r.listing_id, "baslik": d.get("title") or "(başlıksız)", "guncellendi": r.updated_at.isoformat(timespec="minutes"), "duzenleyici": f"/listings/{r.listing_id}/edit"}

    total = ctx.db.scalar(select(func.count()).select_from(ListingCache).where(ListingCache.shop_id == ctx.shop.id)) or 0
    prog = listing_sync.get_progress(ctx.shop.id)
    osync = orders_service.sync_status(ctx.db, ctx.shop)
    fsync = fin.sync_status(ctx.db, ctx.shop)
    ctx.cards.append({
        "type": "status", "title": tr("Çalışma durumu", "Workspace status"),
        "rows": [
            {"label": tr("Yayınlanmamış yeni listing", "Unpublished new listings"), "value": len(new_rows)},
            {"label": tr("Yayınlanmamış düzenleme", "Unpublished edits"), "value": len(edited)},
            {"label": tr("Yerelde listing", "Local listings"), "value": total},
        ],
    })
    return {
        "yerel_listing_sayisi": total,
        "yayinlanmamis_yeni_listing": len(new_rows), "yayinlanmamis_duzenleme": len(edited),
        "yeni_listingler": [brief(r) for r in new_rows[:limit]], "duzenlenenler": [brief(r) for r in edited[:limit]],
        "listing_senkronizasyonu": {"calisiyor": listing_sync.is_syncing(ctx.shop.id), "ilerleme": list(prog) if prog else None},
        "siparis_senkronizasyonu": {"yerel": osync.local, "etsy_toplam": osync.remote_total, "gecmis_iniyor": osync.backfilling},
        "finans_senkronizasyonu": {"calisiyor": fsync["running"], "kayit": fsync["entries"], "son_kayit": fsync["last_entry"], "hata": fsync["error"]},
        "not": "Yayınlanmamış değişiklikler Etsy'de görünmez; listing düzenleyicisinde ya da Listing'ler sayfasında 'Etsy'de yayınla' ile gönderilir.",
    }


def bulk_update_listings(ctx: Ctx, a: dict) -> dict:
    """Birden çok listing'e AYNI değişiklikleri YEREL TASLAK olarak uygular (Etsy'ye göndermez)."""
    ids = [int(i) for i in (a.get("listing_ids") or [])]
    if a.get("title_contains"):
        q = select(ListingCache.listing_id).where(ListingCache.shop_id == ctx.shop.id, ListingCache.title.like(f"%{str(a['title_contains']).strip()}%"))
        ids += [i for i in ctx.db.scalars(q.limit(200)).all() if i not in ids]
    ids = ids[:100]
    if not ids:
        return {"error": "Listing belirtilmedi (listing_ids ya da title_contains ver)."}
    ch: dict = {}
    if a.get("price_change_percent") is not None:
        ch["price"] = bulk.PriceOp(mode="percent", value=float(a["price_change_percent"]), rounding=a.get("price_rounding") or "none")
    elif a.get("price_change_amount") is not None:
        ch["price"] = bulk.PriceOp(mode="amount", value=float(a["price_change_amount"]), rounding=a.get("price_rounding") or "none")
    if a.get("add_tags") or a.get("remove_tags"):
        ch["tags"] = bulk.TagsOp(add=list(a.get("add_tags") or []), remove=list(a.get("remove_tags") or []))
    if a.get("title_find") is not None:
        ch["title"] = bulk.TextOp(mode="find_replace", find=str(a["title_find"]), replace=str(a.get("title_replace") or ""))
    elif a.get("title_prefix"):
        ch["title"] = bulk.TextOp(mode="prefix", text=str(a["title_prefix"]))
    elif a.get("title_suffix"):
        ch["title"] = bulk.TextOp(mode="suffix", text=str(a["title_suffix"]))
    ch.update(_ref_changes(a))
    if not ch:
        return {"error": "Değişiklik belirtilmedi."}
    results = bulk.bulk_stage(ctx.db, ctx.shop, bulk.BulkStageIn(listing_ids=ids, changes=bulk.BulkChanges(**ch)))
    ok = [r for r in results if r["ok"] and r["changed"]]
    same = [r for r in results if r["ok"] and not r["changed"]]
    bad = [r for r in results if not r["ok"]]
    ctx.cards.append({
        "type": "status", "title": tr("Toplu taslak", "Bulk draft"),
        "rows": [{"label": tr("Taslağa alınan", "Drafted"), "value": len(ok)}, {"label": tr("Zaten aynı", "Already the same"), "value": len(same)}, {"label": tr("Atlanan", "Skipped"), "value": len(bad)}],
    })
    return {
        "taslaga_alinan": len(ok), "zaten_ayni": len(same), "atlanan": [{"listing_id": r["id"], "neden": r["error"]} for r in bad][:10],
        "uygulanan_degisiklik": list(ch), "not": "Hepsi yalnızca yerel taslak; Etsy'ye gitmedi. Kullanıcı Listing'ler sayfasında 'Yayınlanmamışları seç' → 'Seçilenleri Etsy'de yayınla' ile gönderir.",
    }


def orders_overview(ctx: Ctx, a: dict) -> dict:
    """Sipariş sayfasındaki sekme sayıları ve gönderilecek siparişlerin dökümü."""
    base = (OrderCache.shop_id == ctx.shop.id,)

    def count(*c) -> int:
        return ctx.db.scalar(select(func.count()).select_from(OrderCache).where(*base, *c)) or 0

    to_ship = (OrderCache.is_paid.is_(True), OrderCache.is_shipped.is_(False), OrderCache.is_canceled.is_(False))
    today = dt.datetime.combine(ctx.today, dt.time.min)
    rows = ctx.db.execute(select(OrderCache.country_iso, func.count()).where(*base, *to_ship).group_by(OrderCache.country_iso).order_by(func.count().desc()).limit(8)).all()
    out = {
        "gonderilecek": count(*to_ship), "gecikmis": count(*to_ship, OrderCache.expected_ship_date < today),
        "bugun_gonderilmeli": count(*to_ship, OrderCache.expected_ship_date >= today, OrderCache.expected_ship_date < today + dt.timedelta(days=1)),
        "tamamlandi": count(OrderCache.is_shipped.is_(True), OrderCache.is_canceled.is_(False)),
        "iptal_iade": count(OrderCache.is_canceled.is_(True)), "toplam": count(),
        "gonderilecekler_icinde": {
            "kisisellestirmeli": count(*to_ship, OrderCache.has_personalization.is_(True)), "hediye": count(*to_ship, OrderCache.is_gift.is_(True)),
            "alici_notlu": count(*to_ship, OrderCache.has_note.is_(True)), "kargo_yukseltmeli": count(*to_ship, OrderCache.has_upgrade.is_(True)),
            "ulkelere_gore": {c or "?": n for c, n in rows},
        },
    }
    ctx.cards.append({"type": "status", "title": tr("Sipariş özeti", "Order summary"), "rows": [
        {"label": tr("Gönderilecek", "To ship"), "value": out["gonderilecek"]}, {"label": tr("Gecikmiş", "Overdue"), "value": out["gecikmis"]},
        {"label": tr("Tamamlandı", "Completed"), "value": out["tamamlandi"]}, {"label": tr("İptal / iade", "Canceled / refunded"), "value": out["iptal_iade"]}]})
    return out


def order_detail(ctx: Ctx, a: dict) -> dict:
    """Tek sipariş: kalemler, kişiselleştirme cevapları, hediye/alıcı notu, kargo ve maliyet."""
    rid = int(a["receipt_id"])
    row = ctx.db.scalars(select(OrderCache).where(OrderCache.shop_id == ctx.shop.id, OrderCache.receipt_id == rid)).one_or_none()
    if row is None:
        return {"error": "Sipariş yerelde yok (senkronize edilmemiş olabilir)."}
    o = orders_service._serialize_order(row).model_dump()
    items = [{"urun": i["title"], "adet": i["quantity"], "sku": i["sku"], "secenekler": [{"ad": v["name"], "deger": v["value"], "kisisellestirme": v["personalization"]} for v in i["variations"]]} for i in o["items"]]
    data = fin.orders_costs(ctx.db, ctx.shop, dt.date(2000, 1, 1), ctx.today, q=str(rid), per_page=5)
    c = next((x for x in data["orders"] if x["receipt_id"] == rid), None)
    return {
        "siparis_no": rid, "durum": o["status"], "alici": o["buyer_name"], "ulke": o["address"]["country_iso"], "tutar": o["total"], "tarih": o["created_at"][:10],
        "gonderim_tarihi": (o["expected_ship_date"] or "")[:10] or None, "gonderildi": o["is_shipped"], "urunler": items,
        "alici_notu": o["buyer_note"], "hediye": o["is_gift"], "hediye_mesaji": o["gift_message"], "hediye_gonderen": o["gift_sender"],
        "kargo_yontemi": o["shipping_method"], "kargo_yukseltme": o["shipping_upgrade"], "takip_kodlari": o["tracking_codes"], "kupon": o["coupon"],
        "kargo_faturasi": [{"tur": l["kind"], "kalem": l["description"], "fatura_no": l["invoice_no"], "tarih": l["invoice_date"], "tutar": l["amount"]} for l in invoices.order_lines(ctx.db, ctx.shop, rid)],
        "maliyet": None if c is None else {"otomatik": _r(c["auto_cost"]), "elle_girilen": c["override"], "tanimli": c["auto_defined"], "kazanc": _r(c["earned"]), "para_birimi": data["currency"]},
    }


def orders_missing_costs(ctx: Ctx, a: dict) -> dict:
    """Ürün/seçenek maliyeti tanımlı olmayan ve elle de girilmemiş siparişler (kâr hesabı eksik kalır)."""
    start = _d(a.get("start_date"), ctx.today - dt.timedelta(days=90))
    end = _d(a.get("end_date"), ctx.today)
    data = fin.orders_costs(ctx.db, ctx.shop, start, end, per_page=1000)
    miss = [x for x in data["orders"] if x["override"] is None and not x["auto_defined"]]
    titles = Counter(i["title"][:60] for x in miss for i in x["items"] if not i["defined"])
    limit = max(1, min(int(a.get("limit") or 15), 30))
    return {
        "donem": [start.isoformat(), end.isoformat()], "toplam_siparis": len(data["orders"]), "maliyeti_eksik": len(miss), "para_birimi": data["currency"],
        "en_cok_eksik_urunler": [{"urun": t, "siparis_kalemi": n} for t, n in titles.most_common(10)],
        "siparisler": [{"siparis_no": x["receipt_id"], "tarih": x["date"], "alici": x["buyer"], "tutar": _r(x["total"])} for x in miss[:limit]],
        "not": "Ürün/seçenek maliyetini kullanıcı söylerse set_product_cost ile sen kaydedebilirsin; tek siparişin özel maliyeti Finans > Sipariş maliyetleri'nden girilir.",
    }


def shipping_invoices(ctx: Ctx, a: dict) -> dict:
    """Kayıtlı kargo/gümrük faturaları (gönderi başına): tutar, kalemler, uyarılar; siparişe bağlanmamış olanlar."""
    data = invoices.query_invoices(
        ctx.db, ctx.shop, q=str(a.get("query") or ""), kind=str(a.get("kind") or ""), inv_start=str(a.get("start_date") or ""), inv_end=str(a.get("end_date") or ""),
        sort=str(a.get("sort") or "inv_date"), per_page=200,
    )
    items = data["items"]
    limit = max(1, min(int(a.get("limit") or 10), 25))
    unmatched = [x for x in items if not x["receipt_id"]]
    warned = [x for x in items if x["warnings"]]
    brief = lambda x: {  # noqa: E731
        "siparis_no": x["receipt_id"], "alici": x["buyer"], "takip_no": x["tracking_no"], "firma": x["vendor"], "tutar": x["total"], "agirlik_kg": x["weight_kg"],
        "son_fatura_tarihi": x["last_invoice_date"], "kalemler": [f"{l['kind']}: {l['description']} {l['amount']}" for l in x["lines"]][:6], "uyarilar": x["warnings"],
    }
    ctx.cards.append({"type": "status", "title": tr("Kargo faturaları", "Shipping invoices"), "rows": [
        {"label": tr("Gönderi", "Shipments"), "value": len(items)}, {"label": tr("Siparişe bağlanmamış", "Not linked to an order"), "value": len(unmatched)},
        {"label": tr("Uyarılı", "With warnings"), "value": len(warned)}]})
    return {
        "gonderi_sayisi": len(items), "toplam_tutar": data["total_amount"], "siparise_baglanmamis": len(unmatched), "uyarili": len(warned),
        "gonderiler": [brief(x) for x in items[:limit]], "baglanmamislar": [brief(x) for x in unmatched[:limit]], "uyarililar": [brief(x) for x in warned[:limit]],
        "not": "Faturaları Finans > Kargo faturaları sayfasından kullanıcı yükler/siler; sen ekleyemez ya da silemezsin.",
    }


def keyword_pool(ctx: Ctx, a: dict) -> dict:
    """Etsy etiket havuzu: kendi başarılı listing'lerinin ve rakiplerin etiketleri. Var olan listing için listing_id, yeni ürün için query + taxonomy_id ver."""
    if a.get("listing_id"):
        row = ctx.db.scalars(select(ListingCache).where(ListingCache.shop_id == ctx.shop.id, ListingCache.listing_id == int(a["listing_id"]))).one_or_none()
        if row is None:
            return {"error": "Listing yerelde yok."}
        listing = json.loads(row.raw_json)
    elif a.get("query"):
        listing = {"title": str(a["query"]), "tags": [], "taxonomy_id": int(a["taxonomy_id"]) if a.get("taxonomy_id") else None}
    else:
        return {"error": "listing_id ya da query ver."}
    pool = keyword_service.build_keyword_pool(ctx.db, ctx.shop, listing)
    limit = max(5, min(int(a.get("limit") or 25), 40))
    return {
        "etiketler": [{
            "etiket": p["tag"], "kaynak": {"own": "kendi", "etsy": "etsy_verisi", "research": "arastirma"}.get(p["source"], "rakip"), "puan": p.get("score"),
            **({"etsy_aylik_arama": p["etsy_searches"], "etsy_donusum": p.get("etsy_conversion"), "etsy_degisim_yuzde": p.get("etsy_trend_pct"),
                "etsy_arama_sonucu": p.get("etsy_results")} if p.get("etsy_searches") else {}),
        } for p in pool[:limit]],
        "not": ("Puan: kendi etiketlerin için satışa göre, rakip etiketleri için ilk 50 rakip listing'de geçme sayısına göre, etsy_verisi için "
                "listing'i getiren sipariş/tıklama, arastirma için Etsy'de aylık arama. etsy_donusum çok düşük olan geniş aramaları ana öbek yapma. "
                "Etiket en fazla 20 karakter olmalı; hepsini kopyalama, ürüne uyanları seç."),
    }


# ------------------------------------------------------------------ fotoğraf araçları (küple/mesafe seçiciyle AYNI hazır
# cümleler — bkz. frontend CameraCube.tsx / DistancePicker.tsx; serbest metne bırakılırsa tutarlılık/kalite düşüyor)

_AZIMUTH_PHRASE = {
    "front": "ürünü tam önden", "front_right": "ürünü ön-sağ 3/4 açıdan", "right": "ürünü tam sağ yandan (profilden)",
    "back_right": "ürünü arka-sağ açıdan, arkaya yakın bir açıdan", "back": "ürünü arkadan",
    "back_left": "ürünü arka-sol açıdan, arkaya yakın bir açıdan", "left": "ürünü tam sol yandan (profilden)",
    "front_left": "ürünü ön-sol 3/4 açıdan",
}
_ELEVATION_PHRASE = {
    "low": "alçak açıdan, aşağıdan yukarıya bakan bir kamerayla", "eye": "göz hizasında, düz bir kamerayla",
    "high": "yüksek açıdan, yukarıdan aşağıya bakan bir kamerayla",
}
_DISTANCE_PHRASE = {
    "close": "Yakın çekim (close-up) kadrajla, ürünü ve dokusunu/detayını doldurarak çek; arka plan hafifçe bulanıklaşsın (sığ alan derinliği), odak tamamen üründe olsun.",
    "medium": "Orta plan kadrajla çek: ürün net ve öne çıkmış olsun, etrafındaki sahne de bir miktar görünsün, dengeli bir odak-bağlam dengesi kur.",
    "wide": "Geniş plan/kadrajla çek: ürünü bulunduğu ortamla/mekânla birlikte, biraz uzaktan göster; sahnenin tamamı kadrajda olsun.",
}


def _draft_work(ctx: Ctx, listing_id: int) -> dict:
    """Ekrandaki güncel çalışma kopyası: taslak varsa o, yoksa kaydedilmiş yerel sürüm, o da yoksa canlı Etsy
    hâli (bkz. frontend useListingWorkingCopy: work = draft ?? local ?? live). Fotoğraf araçları hep bunun
    üstünde çalışır ki editördeki ekranla birebir aynı kaynaktan gitsinler."""
    d = drafts.get_draft(ctx.db, ctx.shop, listing_id)
    if d["exists"] and d["data"]:
        return d["data"]
    loc = drafts.get_local(ctx.db, ctx.shop, listing_id)
    if loc["exists"] and loc["data"]:
        return loc["data"]
    return listing_service.get_listing_for_edit(ctx.db, ctx.shop, listing_id).model_dump()


def _save_draft_work(ctx: Ctx, listing_id: int, work: dict) -> None:
    drafts.save_draft(ctx.db, ctx.shop, listing_id, work)


def _draft_file_url(shop_id: int, listing_id: int, file_id: str) -> str:
    from app.core.config import settings

    return f"{settings.api_public_url}/api/shops/{shop_id}/listings/{listing_id}/draft/files/{file_id}"


def _draft_entry_id(file_id: str) -> int:
    return -(abs(hash(file_id)) % 900_000_000) - 1  # benzersiz negatif kimlik (Etsy id'leri hep pozitif)


def _image_entry(shop_id: int, listing_id: int, file_id: str, alt_text: str | None, rank: int) -> dict:
    url = _draft_file_url(shop_id, listing_id, file_id)
    return {"listing_image_id": _draft_entry_id(file_id), "draft_file_id": file_id, "rank": rank,
            "url_170x135": url, "url_570xN": url, "url_fullxfull": url, "alt_text": alt_text}


def _camera_prompts(a: dict) -> tuple[str | None, str | None, str | None]:
    """Kamera açısı ve mesafe seçeneklerini görsel üretim talimatına çevirir: (kamera, mesafe, hata)."""
    camera = distance = None
    if a.get("azimuth") or a.get("elevation"):
        az, el = a.get("azimuth", "front"), a.get("elevation", "eye")
        if az not in _AZIMUTH_PHRASE or el not in _ELEVATION_PHRASE:
            return None, None, "azimuth front/front_right/right/back_right/back/back_left/left/front_left; elevation low/eye/high olmalı."
        camera = f"Kamera açısı: {_AZIMUTH_PHRASE[az]}, {_ELEVATION_PHRASE[el]} çek."
    if a.get("distance"):
        if a["distance"] not in _DISTANCE_PHRASE:
            return None, None, "distance close/medium/wide olmalı."
        distance = _DISTANCE_PHRASE[a["distance"]]
    return camera, distance, None


def regenerate_listing_image(ctx: Ctx, a: dict) -> dict:
    """Bir listing fotoğrafını AI ile yeniden oluşturur — kamera açısı/mesafe/sahne talimatı/özne referansı
    (bkz. frontend'deki kamera küpü/kadraj seçici/ürün referansı ile birebir aynı mekanizma). Kaynak piksel
    HER ZAMAN fotoğrafın kendi zincir kökü (orijinal ya da ilk üretilen kare) olur, ekrandaki sürüm değil —
    art arda üretimlerde sapma birikmesin diye (bkz. drafts.regenerate_image). Yalnızca taslağa yazar."""
    from app.ai.image_gen import ImageGenError

    lid = int(a["listing_id"])
    work = _draft_work(ctx, lid)
    images = work.get("images") or []
    if a.get("photo_number"):  # "birinci resim" = sıra numarası (1'den başlar, get_listing.fotograflar.sira ile aynı)
        ordered = sorted(images, key=lambda x: x.get("rank") or 0)
        n = int(a["photo_number"])
        img = ordered[n - 1] if 1 <= n <= len(ordered) else None
        image_id = img.get("listing_image_id") if img else None
    elif a.get("image_id"):
        image_id = int(a["image_id"])
        img = next((i for i in images if i.get("listing_image_id") == image_id), None)
    else:
        return {"error": "Hangi fotoğraf? photo_number (1'den başlayan sıra) ya da image_id ver."}
    if img is None:
        return {"error": f"Fotoğraf bulunamadı; listing'de {len(images)} fotoğraf var. get_listing'in fotograflar listesine bak."}
    camera_prompt, distance_prompt, bad = _camera_prompts(a)
    if bad:
        return {"error": bad}
    try:
        result = drafts.regenerate_image(
            ctx.db, ctx.shop, lid, image_id, img.get("draft_file_id"), a.get("prompt"),
            None, camera_prompt, distance_prompt,
            int(a["subject_image_id"]) if a.get("subject_image_id") else None, a.get("subject_draft_file_id"),
            int(a["model_id"]) if a.get("model_id") else None, a.get("variant"),
        )
    except (ImageGenError, ValueError) as exc:
        return {"error": str(exc)}
    new_entry = _image_entry(ctx.shop.id, lid, result["file_id"], img.get("alt_text"), img.get("rank", 0))
    work["images"] = [new_entry if i.get("listing_image_id") == image_id else i for i in images]
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["photo"])
    return {"ok": True, "not": "Yeni görsel taslağa kaydedildi; Etsy'ye gitmesi için yayınlanması gerekiyor."}


def edit_chat_image(ctx: Ctx, a: dict) -> dict:
    """AI ile YENİ bir görsel üretir: kaynak sohbetteki bir resim (image_id) ya da bir listing fotoğrafı (listing_id + photo_number).
    Sonuç sohbette gösterilir; kaynak olduğu gibi kalır. Listing'e YALNIZCA add_to_listing=true ise eklenir (yeni fotoğraf olarak,
    yalnızca taslak, Etsy'ye gitmez); kullanıcı görmeden eklenmez."""
    from app.ai.image_gen import ImageGenError, guess_extension, regenerate_image
    from app.assistant import service as chat_service
    from app.assistant.models import ChatImage

    if not (a.get("prompt") or a.get("azimuth") or a.get("elevation") or a.get("distance")):
        return {"error": "Resimde ne yapılacağını yaz (ör. arka planı beyaz yap, oturma odasında göster)."}
    camera_prompt, distance_prompt, bad = _camera_prompts(a)
    if bad:
        return {"error": bad}
    lid = int(a["listing_id"]) if a.get("listing_id") else None
    source_chat_id = source_photo = None
    try:
        if a.get("image_id"):
            img = ctx.db.get(ChatImage, str(a["image_id"]))
            if img is None or img.shop_id != ctx.shop.id or not img.path or not img.content_type.startswith("image/"):
                return {"error": "Resim bulunamadı; sistem mesajındaki resim listesinden bir kimlik ver."}
            source, source_chat_id = (blobstore.read(img.path), img.content_type), img.id
        elif lid is not None and a.get("photo_number"):
            work, err = _work_or_error(ctx, lid)
            if err:
                return err
            ordered, photo = _photo_at(work, int(a["photo_number"]))
            if photo is None:
                return {"error": f"Fotoğraf bulunamadı; listing'de {len(ordered)} fotoğraf var."}
            source, source_photo = drafts._source_image_bytes(ctx.db, ctx.shop, lid, photo["listing_image_id"], photo.get("draft_file_id")), int(a["photo_number"])
        else:
            return {"error": "Kaynak belirt: sohbetteki resim için image_id, listing fotoğrafı için listing_id + photo_number."}
        add = bool(a.get("add_to_listing"))
        if add:
            lid = lid if lid is not None else _latest_new_draft(ctx)
            err = _photo_slot_error(ctx, lid) if lid is not None else "Eklenecek bir listing taslağı yok; listing_id ver."
            if err:
                return {"error": err}
        new_bytes, mime = regenerate_image(
            source[0], source[1], a.get("prompt"), None, camera_prompt, distance_prompt, None,
            int(a["model_id"]) if a.get("model_id") else None, a.get("variant"),
        )
    except (ImageGenError, ValueError, FileNotFoundError) as exc:
        return {"error": str(exc)}
    name = f"ai-edit{guess_extension(mime)}"
    saved = chat_service.save_image(ctx.db, ctx.shop, ctx.session_id, name, mime, new_bytes)
    photo_id = None
    if add and lid is not None:
        _bad, photo_id = _add_photo(ctx, lid, name, mime, new_bytes, a.get("alt_text"))
    added = photo_id is not None
    ctx.cards.append({
        "type": "chat_image_edited", "image_id": saved["id"], "image_url": saved["url"], "prompt": str(a.get("prompt") or "")[:200],
        "source_image_id": source_chat_id, "source_listing_id": lid if source_photo else None, "source_photo": source_photo,
        "listing_id": lid, "added": added, "edit_url": f"/listings/{lid}/edit" if added else None, "listing_image_id": photo_id,
    })
    return {
        "ok": True, "yeni_resim_id": saved["id"], "listinge_eklendi": added,
        "not": "Yeni görsel sohbette gösterildi (kartta yeniden üret / sil / listing'e ekle simgeleri var); kaynak yerinde duruyor."
               + (" Listing taslağına yeni fotoğraf olarak eklendi (Etsy'ye gitmedi)." if added else " Listing'e EKLENMEDİ: kullanıcı 'ekle' derse ya da karttaki düğmeye basarsa add_chat_image_to_listing'i yeni resim kimliğiyle çağır (yeniden üretme)."),
    }


def _photo_slot_error(ctx: Ctx, listing_id: int) -> str | None:
    """Taslağa yeni fotoğraf eklenebilir mi? Hata metni ya da None."""
    try:
        work = _draft_work(ctx, listing_id)
    except Exception:  # noqa: BLE001 - listing bulunamadı gibi durumlar kullanıcıya düz hata olarak döner
        return "Listing bulunamadı."
    if len(work.get("images") or []) >= creation.MAX_LISTING_IMAGES:
        return f"Listing'de zaten {creation.MAX_LISTING_IMAGES} fotoğraf var (Etsy sınırı)."
    return None


def _add_photo(ctx: Ctx, listing_id: int, filename: str, mime: str, content: bytes, alt_text: str | None = None) -> tuple[str | None, int | None]:
    """Resmi listing taslağına yeni (son sıradaki) fotoğraf olarak ekler (Etsy'ye gitmez). Döner: (hata metni ya da None, eklenen fotoğrafın kimliği)."""
    err = _photo_slot_error(ctx, listing_id)
    if err:
        return err, None
    work = _draft_work(ctx, listing_id)
    images = work.get("images") or []
    file = drafts.save_file(ctx.db, ctx.shop, listing_id, "image", filename, mime, content)
    alt = " ".join(str(alt_text or "").split())[:500] or None
    entry = _image_entry(ctx.shop.id, listing_id, file["file_id"], alt, len(images) + 1)
    work["images"] = images + [entry]
    _save_draft_work(ctx, listing_id, work)
    return None, entry["listing_image_id"]


def move_listing_photo(ctx: Ctx, a: dict) -> dict:
    """Listing taslağındaki bir fotoğrafı başka bir sıraya taşır (ana fotoğraf = 1. sıra). Yalnızca taslağa yazar."""
    lid = int(a["listing_id"])
    try:
        work = _draft_work(ctx, lid)
    except Exception:  # noqa: BLE001
        return {"error": "Listing bulunamadı."}
    ordered = sorted(work.get("images") or [], key=lambda i: i.get("rank") or 0)
    n, to = int(a["photo_number"]), int(a.get("to_position") or 1)
    if not (1 <= n <= len(ordered)) or not (1 <= to <= len(ordered)):
        return {"error": f"Listing'de {len(ordered)} fotoğraf var; sıra 1 ile {len(ordered)} arasında olmalı."}
    moved = ordered.pop(n - 1)
    ordered.insert(to - 1, moved)
    for rank, img in enumerate(ordered, start=1):
        img["rank"] = rank
    work["images"] = ordered
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["photo_order"])
    return {"ok": True, "yeni_sira": [{"sira": r, "image_id": i.get("listing_image_id")} for r, i in enumerate(ordered, start=1)],
            "not": "Fotoğraf sırası yalnızca yerel taslakta değişti; Etsy'ye gitmedi."}


def _crop_in_work(ctx: Ctx, lid: int, work: dict, number: int, spec: dict) -> str | None:
    """`work` içindeki number. fotoğrafı kırpıp yerine koyar (kaydetmez); hata metni ya da None. crop_listing_photo ve yeni taslak ortak kullanır."""
    from app.assistant import crop

    ordered, photo = _photo_at(work, number)
    if photo is None:
        return f"Fotoğraf bulunamadı; listing'de {len(ordered)} fotoğraf var."
    try:
        source, _mime = drafts._source_image_bytes(ctx.db, ctx.shop, lid, photo["listing_image_id"], photo.get("draft_file_id"))
        data, mime = crop.crop_image(source, spec.get("ratio") or "1:1", spec.get("zoom") or 1.0, spec.get("center_x", 0.5), spec.get("center_y", 0.5))
    except (ValueError, FileNotFoundError, OSError) as exc:
        return f"Kırpılamadı: {exc}"
    saved = drafts.save_file(ctx.db, ctx.shop, lid, "image", "kirpilmis.jpg", mime, data)
    old_id = photo["listing_image_id"]
    entry = _image_entry(ctx.shop.id, lid, saved["file_id"], photo.get("alt_text"), photo.get("rank") or 0)
    work["images"] = [entry if i.get("listing_image_id") == old_id else i for i in work["images"]]
    links = work.get("variation_links")
    if links and links.get("images"):  # varyasyona bağlı fotoğraf kırpıldıysa bağ yeni görsele geçer
        links["images"] = {k: (entry["listing_image_id"] if v == old_id else v) for k, v in links["images"].items()}
    return None


def crop_listing_photo(ctx: Ctx, a: dict) -> dict:
    """Bir listing fotoğrafını kırpar (oran + yakınlaştırma + odak noktası); düzenleyicideki Kırp ile aynı: kırpılan görsel o fotoğrafın
    yerine yeni taslak dosyası olarak girer (alt metin ve sıra korunur). Küçük resim ana fotoğraftan üretildiği için ana fotoğrafı kırpmak yeter."""
    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    bad = _crop_in_work(ctx, lid, work, int(a["photo_number"]), a)
    if bad:
        return {"error": bad}
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["photo"])
    return {"ok": True, "not": "Kırpılan görsel yerel taslağa kaydedildi (Etsy'ye gitmedi); eski sürüm düzenleyicide dosya olarak durur. Sonucu kullanıcıya kartta göster."}


def _category_defs(taxonomy_id: int) -> list[dict]:
    """Etsy'nin bir kategori için tanımladığı özellikler (önbellekli; düzenleyici aynı veriyi kullanır)."""
    return cached(("tax", "props", taxonomy_id), lambda: taxonomy_service.get_properties_by_taxonomy_id(taxonomy_id))


def _save_fields(ctx: Ctx, lid: int, work: dict, changed: list[str], errors: list[str], **extra) -> dict:
    """Alan araçlarının ortak sonucu: değişen alanlar yazılır, güncel kart gösterilir, hatalar olduğu gibi döner."""
    if changed:
        _save_draft_work(ctx, lid, work)
        _show_listing(ctx, lid, work, changed)
    out = {"degisenler": changed, "hatalar": errors, **extra}
    if errors:
        out["not"] = "Hatalı olanlar YAZILMADI; hataları kullanıcıya olduğu gibi söyle, olmayan bir şeyi yaptım deme."
    elif changed:
        out["not"] = "Yalnızca yerel taslağa yazıldı; Etsy'ye gitmedi."
    else:
        out["not"] = "Değişiklik yok (değerler zaten böyleydi)."
    return out


def _work_or_error(ctx: Ctx, lid: int) -> tuple[dict | None, dict | None]:
    try:
        return _draft_work(ctx, lid), None
    except Exception:  # noqa: BLE001 - listing bulunamadı gibi durumlar kullanıcıya düz hata olarak döner
        return None, {"error": "Listing bulunamadı."}


def get_category_attributes(ctx: Ctx, a: dict) -> dict:
    """Listing'in kategorisinin özellikleri (renk, malzeme, kullanım yeri…): zorunlu olanlar, izin verilen değerler ve şu anki seçimler."""
    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    tid = work.get("taxonomy_id")
    if not tid:
        return {"error": "Listing'in kategorisi yok; önce set_listing_fields ile kategori seç (find_category)."}
    try:
        defs = _category_defs(int(tid))
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Kategori özellikleri alınamadı: {exc}"}
    return {"kategori": _taxonomy().get(int(tid)), **fields.describe(defs, work)}


def set_listing_fields(ctx: Ctx, a: dict) -> dict:
    """Listing taslağının malzeme, stil, kategori, kim yaptı/ne zaman, tedarik, vergi, boyut/ağırlık, SKU ve kişiselleştirme
    alanlarını doğrulayarak yazar (yalnızca yerel taslak)."""
    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    given = {k: v for k, v in a.items() if k != "listing_id" and v is not None}
    if not given:
        return {"error": "Değişiklik belirtilmedi."}
    names = None
    if "taxonomy_id" in given:
        try:
            names = _taxonomy()
        except Exception as exc:  # noqa: BLE001
            return {"error": f"Kategori ağacı alınamadı: {exc}"}
    changed, errors = fields.apply_fields(work, given, category_names=names, leaf_ids=_taxonomy_leaves if names is not None else None)
    extra: dict = {}
    if "taxonomy_id" in changed:
        try:
            dropped = fields.keep_applicable_properties(work, _category_defs(int(work["taxonomy_id"])))
        except Exception as exc:  # noqa: BLE001 - özellikler alınamazsa mevcutlar korunur, kullanıcıya söylenir
            extra["uyari"] = f"Yeni kategorinin özellikleri alınamadı ({exc}); eski özellikler duruyor, düzenleyiciden kontrol et."
        else:
            if dropped:
                extra["kaldirilan_ozellikler"] = dropped
            extra["sonraki_adim"] = "Yeni kategorinin zorunlu özelliklerini get_category_attributes ile kontrol et."
    return _save_fields(ctx, lid, work, changed, errors, **extra)


def set_listing_attributes(ctx: Ctx, a: dict) -> dict:
    """Kategorinin özelliklerini (renk, malzeme, kullanım yeri…) izin verilen değerlere göre yazar. Boş values özelliği kaldırır."""
    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    tid = work.get("taxonomy_id")
    if not tid:
        return {"error": "Listing'in kategorisi yok; önce kategori seç."}
    try:
        defs = _category_defs(int(tid))
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Kategori özellikleri alınamadı: {exc}"}
    changed, errors = fields.apply_attributes(work, defs, list(a.get("attributes") or []))
    return _save_fields(ctx, lid, work, changed, errors, **{k: v for k, v in fields.describe(defs, work).items() if k == "eksik_zorunlu"})


def _photo_at(work: dict, number: int) -> tuple[list[dict], dict | None]:
    ordered = sorted(work.get("images") or [], key=lambda i: i.get("rank") or 0)
    return ordered, (ordered[number - 1] if 1 <= number <= len(ordered) else None)


def edit_personalization_question(ctx: Ctx, a: dict) -> dict:
    """Tek bir kişiselleştirme sorusunu sıra numarasıyla düzenler, siler ya da taşır (kimlikleri korunur). Yalnızca yerel taslak."""
    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    edits = {k: v for k, v in a.items() if k not in ("listing_id", "number") and v is not None}
    if not edits:
        return {"error": "Değişiklik belirtilmedi."}
    changed, errors = fields.edit_question(work, int(a["number"]), edits)
    return _save_fields(ctx, lid, work, changed, errors, kisisellestirme=[listing_view.question_view(q) for q in (work.get("personalization") or {}).get("questions", [])])


def delete_listing_photo(ctx: Ctx, a: dict) -> dict:
    """Listing taslağından bir fotoğrafı kaldırır (sıra numarasıyla). Etsy'deki fotoğraf yayınlayınca silinir."""
    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    if a.get("image_id") is not None:  # sohbetteki karttan: sıra numarası değişmiş olabilir, fotoğraf kimliğiyle bulunur
        ordered = sorted(work.get("images") or [], key=lambda i: i.get("rank") or 0)
        img = next((i for i in ordered if i.get("listing_image_id") == int(a["image_id"])), None)
    elif a.get("photo_number") is not None:
        ordered, img = _photo_at(work, int(a["photo_number"]))
    else:
        return {"error": "photo_number ya da image_id ver."}
    if img is None:
        return {"error": f"Fotoğraf bulunamadı; listing'de {len(ordered)} fotoğraf var."}
    ordered.remove(img)
    for rank, kept in enumerate(ordered, start=1):
        kept["rank"] = rank
    work["images"] = ordered
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["photo"])
    return {"ok": True, "kalan_fotograf": len(ordered), "not": "Fotoğraf yalnızca yerel taslaktan kaldırıldı; Etsy'deki, yayınlayınca silinir." + (" Listing'de hiç fotoğraf kalmadı; aktif edilemez." if not ordered else "")}


def set_photo_alt_text(ctx: Ctx, a: dict) -> dict:
    """Taslak fotoğrafın alt metnini yazar. Etsy yayındaki fotoğrafların alt metnini API'den değiştirtmez; yalnızca yeni/taslak fotoğraflar."""
    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    ordered, img = _photo_at(work, int(a["photo_number"]))
    if img is None:
        return {"error": f"Fotoğraf bulunamadı; listing'de {len(ordered)} fotoğraf var."}
    if (img.get("listing_image_id") or 0) > 0:
        return {"error": "Bu fotoğraf Etsy'de yayında; Etsy yayındaki fotoğrafın alt metnini API'den değiştirmeye izin vermiyor. Yeni eklenen (taslak) fotoğraflarda çalışır."}
    img["alt_text"] = " ".join(str(a.get("alt_text") or "").split())[:500] or None
    work["images"] = ordered
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["photo"])
    return {"ok": True, "not": "Alt metin yerel taslağa yazıldı."}


def _option_rows(options: dict) -> list[dict]:
    """kind_options çıktısını modelin okuyacağı kısa listeye çevirir (kredi birim başınadır: görselde bir görsel, videoda bir saniye)."""
    return [
        {"model_id": m["id"], "model": m["label"], "varsayilan_model": m["id"] == options["default_model"],
         **({"sureler_sn": m["durations"]} if "durations" in m else {}),
         "kaliteler": [{"variant": v["key"], "ad": tr(v["label_tr"], v["label_en"]), "kredi_birim_basina": v["credits"], "varsayilan": v["is_default"]} for v in m["variants"]]}
        for m in options["models"]
    ]


def _video_alternatives() -> list[dict]:
    return _option_rows(generation.kind_options("video", generation.video_durations))


def generation_options(ctx: Ctx, a: dict) -> dict:
    """Görsel ve video için seçilebilir modeller, kalite/çözünürlük seçenekleri ve kredi bedelleri. 'Kaç kredi', 'hangi kaliteler var',
    '4K olur mu' gibi sorularda ve üretimden önce seçenek sunarken kullan."""
    from app.billing import settings as credit_settings

    return {
        "krediler_acik": credit_settings.enabled(),
        "gorsel": _option_rows(generation.kind_options("image")),
        "video": _video_alternatives(),
        "not": "Kredi 'birim başına': görselde bir görsel, videoda bir saniye. Etsy en az ~2000 piksel önerir; görselde 2K bu yüzden uygun varsayılandır, daha yüksek çözünürlük yalnızca kullanıcı isterse.",
    }


def generate_listing_video(ctx: Ctx, a: dict) -> dict:
    """Bir fotoğraftan (listing fotoğrafı ya da sohbetteki resim) ürün videosu üretmeye başlar. Önce ücret söylenir ve onay istenir
    (confirm=true); onaydan sonra iş arka planda sürer, sohbette ilerleme ve oynatıcı olan bir kart görünür. Video önce taslak dosyası
    olarak kaydedilir; listing'e add_video_to_listing ile eklenir."""
    from app.assistant.models import ChatImage

    lid = int(a["listing_id"]) if a.get("listing_id") else _latest_new_draft(ctx)
    if lid is None:
        return {"error": "Videonun ekleneceği listing taslağı yok; önce taslak oluştur ya da listing_id ver."}
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    duration = int(a.get("duration") or 5)
    model_id = int(a["model_id"]) if a.get("model_id") else None
    try:
        model, variant, price = generation.quote_video(duration, model_id, a.get("variant"))
    except (ValueError, catalog.NotConfigured) as exc:
        return {"error": str(exc)}
    image = ref = None
    if a.get("chat_image_id"):
        img = ctx.db.get(ChatImage, str(a["chat_image_id"]))
        if img is None or img.shop_id != ctx.shop.id or not img.path or not img.content_type.startswith("image/"):
            return {"error": "Resim bulunamadı; sistem mesajındaki resim listesinden bir kimlik ver."}
        image, source = (blobstore.read(img.path), img.content_type), "chat"
    else:
        ordered, photo = _photo_at(work, int(a.get("photo_number") or 1))
        if photo is None:
            return {"error": f"Fotoğraf bulunamadı; listing'de {len(ordered)} fotoğraf var."}
        ref, source = generation.Reference(image_id=photo["listing_image_id"], image_draft_file_id=photo.get("draft_file_id")), "listing"
    if not a.get("confirm"):
        return {"pending_confirmation": True, "kredi": price.credits, "sure_sn": duration, "listing_id": lid,
                "secilen": {"model": model.label, "model_id": model.id, "kalite": tr(variant.label_tr, variant.label_en) if variant else None, "variant": variant.key if variant else None},
                "diger_secenekler": _video_alternatives(),
                "not": "Kullanıcıya SEÇİLEN modeli, kaliteyi ve KREDİ bedelini söyle; kullanıcı model/kalite belirtmediyse diger_secenekler'i kısaca sun ve hangisini istediğini sor (ya da varsayılanla devam). AÇIKÇA onay iste (evet/yap/onaylıyorum). Onaylarsa seçilen model_id ve variant ile confirm=true çağır; onaylamadıysa asla çağırma."}
    try:
        job = generation.start_video(
            ctx.db, ctx.shop, lid, str(a.get("prompt") or "").strip() or generation.DEFAULT_VIDEO_PROMPT, duration, ref or generation.Reference(),
            model_id, a.get("variant"), image=image,
        )
    except generation.InsufficientCredits as exc:
        return {"error": tr(f"Bu video için {exc.needed} kredi gerekiyor; bakiye yetmiyor.", f"This video needs {exc.needed} credits; the balance is not enough.")}
    except (video_gen.VideoGenError, ValueError) as exc:
        return {"error": str(exc)}
    ctx.cards.append({"type": "video_job", "job": job["job"], "listing_id": lid, "credits": job["credits"], "prompt": str(a.get("prompt") or "")[:200], "duration": duration, "started_at": int(time.time() * 1000), "source": source})
    return {"ok": True, "uretiliyor": True, "kredi": job["credits"],
            "not": "Video üretimi başladı; sohbette ilerleme gösteren bir kart var, video hazır olunca orada oynatılır ve kredi o zaman düşer. Bekleme, kullanıcıya kısaca söyle. Hazır olunca kullanıcı 'listing'e ekle' derse add_video_to_listing'i çağır (video dosya kimliğini kullanıcı mesajı verir)."}


def _attach_video(ctx: Ctx, lid: int, work: dict, file) -> str | None:
    """Taslak video dosyasını (DraftFile) listing'in çalışma kopyasına ekler; hata metni ya da None. Kaydetmez."""
    videos = work.get("videos") or []
    if any(v.get("draft_file_id") == file.id for v in videos):
        return None
    if len(videos) >= generation.MAX_LISTING_VIDEOS:
        return f"Listing'de zaten {generation.MAX_LISTING_VIDEOS} video var (Etsy sınırı); önce birini kaldır."
    work["videos"] = videos + [{
        "video_id": _draft_entry_id(file.id), "draft_file_id": file.id, "height": 0, "width": 0, "thumbnail_url": "",
        "video_url": _draft_file_url(ctx.shop.id, lid, file.id), "video_state": "draft",
    }]
    return None


def _chat_video_file(ctx: Ctx, lid: int, chat_video_id: str):
    """Kullanıcının sohbete yüklediği videoyu listing'in taslak dosyasına kopyalar (DraftFile) ya da (None, hata) döner."""
    from app.assistant.models import ChatImage
    from app.assistant.service import VIDEO_TYPES

    vid = ctx.db.get(ChatImage, str(chat_video_id))
    if vid is None or vid.shop_id != ctx.shop.id or not vid.path or vid.content_type not in VIDEO_TYPES:
        return None, "Video bulunamadı; sistem mesajındaki KULLANICI VİDEOLARI listesinden bir kimlik ver."
    saved = drafts.save_file(ctx.db, ctx.shop, lid, "video", vid.filename, vid.content_type, blobstore.read(vid.path))
    from app.listings.models import DraftFile

    return ctx.db.get(DraftFile, saved["file_id"]), None


def add_video_to_listing(ctx: Ctx, a: dict) -> dict:
    """Listing taslağına video ekler: üretilmiş video (file_id) ya da kullanıcının sohbete yüklediği video (chat_video_id)."""
    from app.listings.models import DraftFile

    lid = int(a["listing_id"]) if a.get("listing_id") else _latest_new_draft(ctx)
    if lid is None:
        return {"error": "Eklenecek bir listing taslağı yok; listing_id ver."}
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    if a.get("chat_video_id"):
        if len(work.get("videos") or []) >= generation.MAX_LISTING_VIDEOS:
            return {"error": f"Listing'de zaten {generation.MAX_LISTING_VIDEOS} video var (Etsy sınırı); önce birini kaldır."}
        file, bad = _chat_video_file(ctx, lid, a["chat_video_id"])
        if bad:
            return {"error": bad}
    else:
        file = ctx.db.get(DraftFile, str(a.get("file_id") or ""))
        if file is None or file.shop_id != ctx.shop.id or file.listing_id != lid or file.kind != "video":
            return {"error": "Video dosyası bulunamadı (bu listing'e ait olmalı)."}
        if any(v.get("draft_file_id") == file.id for v in work.get("videos") or []):
            return {"ok": True, "not": "Video zaten listing'de."}
    bad = _attach_video(ctx, lid, work, file)
    if bad:
        return {"error": bad}
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["video"])
    return {"ok": True, "not": "Video yerel taslağa eklendi; Etsy'ye gitmedi."}


def _locked(ctx: Ctx, lid: int, edit) -> tuple[dict | None, dict | None]:
    """Envanter gibi bütünlüğü bozulmaması gereken düzenlemeler: kopya üzerinde denenir, hata varsa HİÇBİR ŞEY yazılmaz."""
    work, err = _work_or_error(ctx, lid)
    if err:
        return None, err
    trial = copy.deepcopy(work)
    return trial, edit(trial)


def edit_inventory(ctx: Ctx, a: dict) -> dict:
    """Seçilen kombinasyonların (where) ya da tüm listing'in stok, fiyat, SKU ve açık/kapalı durumunu değiştirir; varyasyonsuz listing'de
    where verilmez. Hata varsa hiçbir şey yazılmaz."""
    lid = int(a["listing_id"])
    if not any(a.get(k) is not None for k in ("quantity", "price", "sku", "enabled", "auto_sku")):
        return {"error": "Değişiklik belirtilmedi (quantity, price, sku, auto_sku ya da enabled)."}
    result: dict = {}

    def run(trial: dict):
        changed, errors, count = inventory_edit.apply_inventory(
            trial, where={str(k): str(v) for k, v in (a.get("where") or {}).items()}, quantity=a.get("quantity"), price=a.get("price"), sku=a.get("sku"), enabled=a.get("enabled"),
            auto_sku=a.get("auto_sku"),
        )
        result.update(changed=changed, errors=errors, count=count)

    trial, err = _locked(ctx, lid, run)
    if err:
        return err
    if result["errors"]:
        return {"degisenler": [], "hatalar": result["errors"], "not": "Hiçbir şey yazılmadı; hatayı kullanıcıya olduğu gibi söyle."}
    return _save_fields(ctx, lid, trial, result["changed"], [], etkilenen_kombinasyon=result["count"])


def add_variation_option(ctx: Ctx, a: dict) -> dict:
    """Var olan varyasyona yeni seçenek ekler (ör. Size: "15x20 cm"); mevcut stok/SKU/fotoğraf bağları korunur. Hata varsa hiçbir şey yazılmaz."""
    lid = int(a["listing_id"])
    result: dict = {}

    def run(trial: dict):
        std_values = None
        pid = inventory_edit.property_id(trial, str(a["variation"]))
        if pid is not None and pid not in inventory_edit.CUSTOM_PROPERTY_IDS and trial.get("taxonomy_id"):
            try:  # Etsy'nin tanımlı değerleriyle kurulu varyasyon: izin verilen değerler kategorinin özelliklerinden gelir
                std_values = next((d["possible_values"] for d in _category_defs(int(trial["taxonomy_id"])) if d["property_id"] == pid), None)
            except Exception:  # noqa: BLE001 - değerler alınamazsa seçenek özel değer olarak eklenir
                std_values = None
        added, error = inventory_edit.add_option(trial, str(a["variation"]), str(a["option"]), a.get("price"), a.get("quantity"), a.get("copy_from"), std_values)
        total = len(trial["inventory"]["products"])
        if not error and total > MAX_COMBOS:
            error = f"Kombinasyon sayısı çok fazla ({total}); en fazla {MAX_COMBOS}."
        result.update(added=added, error=error)

    trial, err = _locked(ctx, lid, run)
    if err:
        return err
    if result["error"]:
        return {"degisenler": [], "hatalar": [result["error"]], "not": "Hiçbir şey yazılmadı; hatayı kullanıcıya olduğu gibi söyle."}
    return _save_fields(ctx, lid, trial, ["variations"], [], eklenen_kombinasyon=result["added"], toplam_kombinasyon=len(trial["inventory"]["products"]))


def remove_variation_option(ctx: Ctx, a: dict) -> dict:
    """Bir varyasyon seçeneğini ve onu içeren tüm kombinasyonları kaldırır (ör. Renk: Kırmızı). Hata varsa hiçbir şey yazılmaz."""
    lid = int(a["listing_id"])
    result: dict = {}

    def run(trial: dict):
        removed, error = inventory_edit.remove_option(trial, str(a["variation"]), str(a["option"]))
        result.update(removed=removed, error=error)

    trial, err = _locked(ctx, lid, run)
    if err:
        return err
    if result["error"]:
        return {"degisenler": [], "hatalar": [result["error"]], "not": "Hiçbir şey yazılmadı; hatayı kullanıcıya olduğu gibi söyle."}
    return _save_fields(ctx, lid, trial, ["variations"], [], kaldirilan_kombinasyon=result["removed"])


def set_variation_photo(ctx: Ctx, a: dict) -> dict:
    """Varyasyon seçeneğine listing fotoğrafı bağlar (ör. Renk: Kırmızı → 3. fotoğraf); photo_number verilmezse bağı kaldırır.
    Etsy yalnızca tek bir varyasyona fotoğraf bağlamaya izin verir."""
    lid = int(a["listing_id"])
    result: dict = {}

    def run(trial: dict):
        image_id = None
        if a.get("photo_number"):
            ordered, img = _photo_at(trial, int(a["photo_number"]))
            if img is None:
                result["error"] = f"Fotoğraf bulunamadı; listing'de {len(ordered)} fotoğraf var."
                return
            image_id = img["listing_image_id"]
        result["error"] = inventory_edit.link_photo(trial, str(a["variation"]), str(a["option"]), image_id)

    trial, err = _locked(ctx, lid, run)
    if err:
        return err
    if result["error"]:
        return {"degisenler": [], "hatalar": [result["error"]], "not": "Hiçbir şey yazılmadı; hatayı kullanıcıya olduğu gibi söyle."}
    return _save_fields(ctx, lid, trial, ["variation_photo"], [])


def remove_listing_video(ctx: Ctx, a: dict) -> dict:
    """Listing taslağından bir videoyu sıra numarasıyla (1'den başlar) kaldırır. Etsy'deki video yayınlayınca silinir."""
    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    videos = work.get("videos") or []
    n = int(a["video_number"])
    if not 1 <= n <= len(videos):
        return {"error": f"Listing'de {len(videos)} video var."}
    work["videos"] = [v for i, v in enumerate(videos, start=1) if i != n]
    return _save_fields(ctx, lid, work, ["video"], [], kalan_video=len(videos) - 1)


def copy_listing(ctx: Ctx, a: dict) -> dict:
    """Var olan bir listing'in yerel kopyasını yeni taslak olarak oluşturur (fotoğraflar, varyasyonlar, özellikler dahil; Etsy'ye gitmez)."""
    try:
        created = creation.create_local_new(ctx.db, ctx.shop, int(a["source_listing_id"]))
    except ValueError as exc:
        return {"error": str(exc)}
    lid = created["listing_id"]
    _show_listing(ctx, lid, _draft_work(ctx, lid), ["copied"])
    return {"ok": True, "yeni_listing_id": lid, "uyarilar": created["warnings"],
            "not": "Kopya yerel taslak (başlığa ' (kopya)' eklendi). Etsy'de aynı başlık ve etiketler tekrar olmasın: başlığı, etiketleri ve açıklamayı ürüne göre değiştir."}


def _confirmation(ctx: Ctx, lid: int, text: str) -> dict:
    work, _ = _work_or_error(ctx, lid)
    return {"pending_confirmation": True, "listing_id": lid, "baslik": (work or {}).get("title"),
            "not": f"{text} Kullanıcıya NET söyle ve AÇIKÇA onay iste (evet/yap/onaylıyorum); onaylarsa confirm=true ile TEKRAR çağır, onaylamadıysa asla çağırma."}


def discard_listing_changes(ctx: Ctx, a: dict) -> dict:
    """Etsy'de yayında olan bir listing'deki yayınlanmamış yerel değişiklikleri atar; listing Etsy'deki hâline döner. confirm gerekir."""
    lid = int(a["listing_id"])
    if lid < 0:
        return {"error": "Bu henüz Etsy'ye gitmemiş yeni bir taslak; değişiklikleri atmak yerine silmek için delete_listing'i kullan."}
    if not a.get("confirm"):
        return _confirmation(ctx, lid, "Bu listing'deki YAYINLANMAMIŞ tüm yerel değişiklikler (fotoğraf, varyasyon, metin…) silinir; listing Etsy'deki hâline döner. Etsy'ye bir şey gitmez.")
    drafts.discard_local(ctx.db, ctx.shop, lid)
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    _show_listing(ctx, lid, work, ["discarded"])
    return {"ok": True, "not": "Yerel değişiklikler atıldı; listing Etsy'deki hâlinde."}


def delete_listing(ctx: Ctx, a: dict) -> dict:
    """Listing'i siler: henüz Etsy'ye gitmemiş yeni taslak yalnızca yerelden; Etsy'deki listing Etsy'den KALICI. confirm gerekir."""
    from app.etsy.client import EtsyApiError, EtsyAuthError

    lid = int(a["listing_id"])
    if not a.get("confirm"):
        text = ("Bu yeni taslak (Etsy'de yok) silinir." if lid < 0 else "Bu listing Etsy'den KALICI olarak silinir ve GERİ ALINAMAZ.")
        return _confirmation(ctx, lid, text)
    try:
        bulk.delete_listing(ctx.db, ctx.shop, lid)
    except (EtsyApiError, EtsyAuthError) as exc:
        return {"error": str(exc)}
    ctx.cards.append({"type": "listing_deleted", "listing_id": lid})
    return {"ok": True, "not": "Listing silindi."}


def personalization_library(ctx: Ctx, a: dict) -> dict:
    """Mağazanın diğer listing'lerinde daha önce kullanılan kişiselleştirme (Özel seçenekler) soruları, kullanım sayısına göre. Kullanıcı
    kişiselleştirme isterse buradan öner; seçilenleri set_listing_fields'ın add_personalization_questions alanıyla ekle."""
    rows = listing_service.get_personalization_library(ctx.db, ctx.shop)
    return {"sorular": [{**listing_view.question_view(q), "kullanim_sayisi": q["count"]} for q in rows[:20]],
            "not": "En fazla 5 soru eklenebilir. Önerini kullanıcıya göster; onaylarsa add_personalization_questions ile ekle."}


def _latest_new_draft(ctx: Ctx) -> int | None:
    """Henüz Etsy'ye gitmemiş en son yerel listing taslağı (sohbette "az önce oluşturduğumuz listing")."""
    row = ctx.db.scalars(select(ListingLocal).where(ListingLocal.shop_id == ctx.shop.id, ListingLocal.listing_id < 0).order_by(ListingLocal.updated_at.desc())).first()
    return row.listing_id if row is not None else None


def add_chat_image_to_listing(ctx: Ctx, a: dict) -> dict:
    """Sohbetteki bir resmi (ör. az önce düzenlenmiş olanı) bir listing taslağına yeni fotoğraf olarak ekler. Yeniden üretmez, kredi
    harcamaz. listing_id verilmezse sohbetteki en son oluşturulan yeni taslak kullanılır."""
    from app.assistant.models import ChatImage

    img = ctx.db.get(ChatImage, str(a.get("image_id") or ""))
    if img is None or img.shop_id != ctx.shop.id or not img.path or not img.content_type.startswith("image/"):
        return {"error": "Resim bulunamadı; sistem mesajındaki resim listesinden bir kimlik ver."}
    lid = int(a["listing_id"]) if a.get("listing_id") else _latest_new_draft(ctx)
    if lid is None:
        return {"error": "Eklenecek bir listing taslağı yok; önce taslak oluştur ya da listing_id ver."}
    try:
        err, _photo_id = _add_photo(ctx, lid, img.filename, img.content_type, blobstore.read(img.path), a.get("alt_text"))
    except FileNotFoundError:
        return {"error": "Resim depoda bulunamadı."}
    if err:
        return {"error": err}
    _show_listing(ctx, lid, _draft_work(ctx, lid), ["photo"])
    return {"ok": True, "listing_id": lid, "not": "Resim listing taslağına yeni fotoğraf olarak eklendi (Etsy'ye gitmedi)."}


def generate_missing_alt_texts(ctx: Ctx, a: dict) -> dict:
    """Alt metni olmayan (yalnızca YENİ/taslak) fotoğraflar için yapay zekâyla alt metin yazar. Etsy zaten
    yayındaki fotoğrafların alt metnini değiştirtmiyor, bu yüzden yalnızca taslak fotoğraflarda çalışır."""
    from app.ai import vision

    lid = int(a["listing_id"])
    work = _draft_work(ctx, lid)
    images = work.get("images") or []
    missing = [i for i in images if (i.get("listing_image_id") or 0) < 0 and i.get("draft_file_id") and not i.get("alt_text")]
    if not missing:
        return {"ok": True, "not": "Eksik alt metin yok."}
    files = [(i, drafts.get_file(ctx.db, ctx.shop, lid, i["draft_file_id"])) for i in missing]
    files = [(i, f) for i, f in files if f is not None]
    if not files:
        return {"error": "Taslak fotoğraf dosyaları bulunamadı; sayfayı yenile."}
    try:
        texts = vision.generate_alt_texts([{"path": f.path, "content_type": f.content_type} for _, f in files], work.get("title") or "")
    except vision.VisionError as exc:
        return {"error": str(exc)}
    by_file_id = {i["draft_file_id"]: t for (i, _), t in zip(files, texts)}
    work["images"] = [{**i, "alt_text": by_file_id.get(i.get("draft_file_id"), i.get("alt_text"))} for i in images]
    _save_draft_work(ctx, lid, work)
    ctx.cards.append({"type": "alt_texts_generated", "listing_id": lid, "count": len(texts), "edit_url": f"/listings/{lid}/edit"})
    return {"ok": True, "yazilan_sayisi": len(texts), "not": "Alt metinler taslağa kaydedildi."}


def _health_dict(h) -> dict:
    return {
        "listing_id": h.listing_id, "durum": h.stage, "darbogaz": h.bottleneck, "not": h.note,
        "deneme_sayisi": h.attempts, "son_degerlendirme": h.evaluated_at.isoformat() if h.evaluated_at else None,
    }


def listing_health_status(ctx: Ctx, a: dict) -> dict:
    """Listing'in optimizasyon/performans durumu (bkz. listings/health.py) — 'bu listing'e dokunma zamanı
    geldi mi, geldiyse hangi alan zayıf' sorusunun kural tabanlı cevabı. listing_id verilmezse mağazada
    dikkat isteyen (öneri var / durdurmayı değerlendir) tüm listing'leri döner."""
    from app.listings import health

    if a.get("listing_id"):
        h = health.get_listing_health(ctx.db, ctx.shop, int(a["listing_id"]))
        return {"saglik": _health_dict(h) if h else None, "not": None if h else "Henüz sağlık verisi yok (yeterli veri birikmemiş olabilir, ya da hiç değerlendirilmemiş)."}
    rows = health.get_shop_health(ctx.db, ctx.shop)
    flagged = [h for h in rows if h.stage in ("flagged", "kill_candidate")]
    return {"dikkat_isteyenler": [_health_dict(h) for h in flagged], "toplam_izlenen": len(rows)}


def keep_watching_listing(ctx: Ctx, a: dict) -> dict:
    """'Durdurmayı değerlendir' önerisini reddeder: sayaç sıfırlanır, yeni bir gözlem penceresi başlar. Etsy'ye hiçbir şey gitmez."""
    from app.listings import health

    try:
        health.keep_watching(ctx.db, ctx.shop, int(a["listing_id"]))
    except ValueError as exc:
        return {"error": str(exc)}
    return {"ok": True, "not": "İzlemeye devam ediliyor, sayaç sıfırlandı."}


# ------------------------------------------------------------------ ONAY GEREKTİREN araçlar: bunlar Etsy'ye GERÇEKTEN
# gider, görünür ve geri alması zor. confirm=true verilmeden yalnızca ne yapılacağını özetler, YAPMAZ — bkz. SYSTEM_PROMPT.

def _stage_activation(ctx: Ctx, lid: int) -> str | None:
    """Listing'i yayınlanınca AKTİF olacak şekilde yerel sürümde işaretler (Etsy'de taslak olan ya da yeni listing).
    Aktif etmek için gerekenler eksikse hiçbir şey değiştirmeden eksikleri yazan hata metnini döner."""
    work = _current_work(ctx, lid)
    if work is None:
        return "Listing bulunamadı."
    problems = creation.validate_new(work, activate=True)
    if problems:
        return " ".join(problems)
    if work.get("state") == "active":
        return None
    work["state"] = "active"
    live = None
    if lid > 0 and drafts._local_row(ctx.db, ctx.shop, lid) is None:
        live = listing_service.get_listing_for_edit(ctx.db, ctx.shop, lid).model_dump()
    drafts.save_local(ctx.db, ctx.shop, lid, work, live)
    return None


def publish_listing_draft(ctx: Ctx, a: dict) -> dict:
    """Bir listing'in taslağını/yerel değişikliklerini Etsy'ye yayınlar — canlıya yansır. confirm=true
    gerekir; aksi halde yalnızca ne yayınlanacağını özetler. activate=true ise listing aynı işlemde AKTİF edilir
    (satışa açılır, 0,20 $ listing ücreti); verilmezse yeni listing Etsy'de taslak olarak kalır."""
    lid = int(a["listing_id"])
    activate = bool(a.get("activate"))
    if not a.get("confirm"):
        d = drafts.get_draft(ctx.db, ctx.shop, lid)
        loc = drafts.get_local(ctx.db, ctx.shop, lid)
        if not (d["exists"] and d["data"]) and not (loc["exists"] and loc["data"]) and not activate:
            return {"error": "Yayınlanacak bir değişiklik yok."}
        out = {"pending_confirmation": True, "listing_id": lid, "aktif_edilecek": activate,
               "not": "Bu, listing'i GERÇEKTEN Etsy'ye yayınlar (canlıya yansır, geri dönüşü zor). Kullanıcı sohbette AÇIKÇA onaylarsa (evet/yap/onaylıyorum vb.) confirm=true ile TEKRAR çağır; onaylamadıysa asla çağırma."}
        if activate:
            work = _current_work(ctx, lid)
            problems = creation.validate_new(work, activate=True) if work is not None else ["Listing bulunamadı."]
            out["aktif_etmek_icin_eksikler"] = problems
            out["not"] += " Aktif edilecek: satışa açılır ve Etsy 0,20 $ listing ücreti alır. Eksik varsa onay isteme, önce eksikleri kullanıcıya söyle."
        return out
    if lid > 0:
        d = drafts.get_draft(ctx.db, ctx.shop, lid)
        if d["exists"] and d["data"]:  # UI'daki "Yayınla" da aynısını yapar: taslağı önce yerel sürüme yükseltir
            live = listing_service.get_listing_for_edit(ctx.db, ctx.shop, lid).model_dump()
            drafts.save_local(ctx.db, ctx.shop, lid, d["data"], live)
    if activate:
        err = _stage_activation(ctx, lid)
        if err:
            return {"error": f"Aktif edilemedi, önce şunlar tamamlanmalı: {err}"}
    result = drafts.publish_local(ctx.db, ctx.shop, ctx.user_id, lid, bool(a.get("force")))
    new_id = result.get("listing_id", lid)
    ctx.cards.append({"type": "listing_published", "listing_id": new_id, "ok": result.get("ok"), "edit_url": f"/listings/{new_id}/edit", "activated": activate and bool(result.get("ok"))})
    return result


def deactivate_listing(ctx: Ctx, a: dict) -> dict:
    """Listing'i Etsy'de INACTIVE yapar (satışa kapanır, tekrar active edilebilir). confirm=true gerekir."""
    from app.listings import health

    lid = int(a["listing_id"])
    if not a.get("confirm"):
        return {"pending_confirmation": True, "listing_id": lid,
                "not": "Bu, listing'i Etsy'de INACTIVE yapar (satışa kapanır, görünür bir değişiklik). Kullanıcı sohbette AÇIKÇA onaylarsa confirm=true ile TEKRAR çağır; onaylamadıysa asla çağırma."}
    health.kill_listing(ctx.db, ctx.shop, lid)
    ctx.cards.append({"type": "listing_deactivated", "listing_id": lid, "edit_url": f"/listings/{lid}/edit"})
    return {"ok": True, "not": "Listing Etsy'de inactive yapıldı."}


def mark_order_shipped(ctx: Ctx, a: dict) -> dict:
    """Siparişi Etsy'de kargoya verildi işaretler — alıcıya bildirim gidebilir. confirm=true gerekir."""
    rid = int(a["receipt_id"])
    if not a.get("confirm"):
        return {"pending_confirmation": True, "receipt_id": rid,
                "not": "Bu, siparişi Etsy'de KARGOYA VERİLDİ işaretler, alıcıya bildirim gidebilir. Kullanıcı sohbette AÇIKÇA onaylarsa confirm=true ile (varsa takip no/kargo firmasıyla) TEKRAR çağır; onaylamadıysa asla çağırma."}
    try:
        orders_service.mark_shipped(ctx.db, ctx.shop, rid, a.get("tracking_code"), a.get("carrier_name"))
    except orders_service.OrderNotFound as exc:
        return {"error": str(exc)}
    ctx.cards.append({"type": "order_shipped", "receipt_id": rid})
    return {"ok": True, "not": "Sipariş kargoya verildi olarak işaretlendi."}


# ------------------------------------------------------------------ araç tanımları

def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


DATE = {"type": "string", "description": "YYYY-MM-DD"}

# Uzun süren (resim/video üreten) araçlar: sohbet bekleme sırasında buna göre ilerleme kartı gösterir.
TOOL_KIND = {"edit_chat_image": "image", "regenerate_listing_image": "image"}

# Görsel/video model ve kalite seçimi (generation_options'taki id ve key değerleri). Verilmezse yönetim panelindeki varsayılan.
_QUALITY_SCHEMA = {
    "model_id": {"type": "integer", "description": "Model kimliği (generation_options). Yalnızca kullanıcı seçtiyse; yoksa varsayılan"},
    "variant": {"type": "string", "description": "Kalite/çözünürlük seçeneği anahtarı (generation_options, ör. 2K). Yalnızca kullanıcı istediyse; yoksa varsayılan"},
}

# Kamera açısı seçenekleri: regenerate_listing_image ve edit_chat_image ortak kullanır.
_CAMERA_SCHEMA = {
    "azimuth": {"type": "string", "enum": ["front", "front_right", "right", "back_right", "back", "back_left", "left", "front_left"]},
    "elevation": {"type": "string", "enum": ["low", "eye", "high"]},
    "distance": {"type": "string", "enum": ["close", "medium", "wide"]},
}

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
    {"name": "search_listings", "description": "Mağazadaki listing'lerde başlığa göre arar (en çok görüntülenenden başlar). state ile durumuna göre süzer (draft = Etsy'de yayında olmayan taslaklar, ayrıca henüz Etsy'ye hiç gitmemiş yeni taslaklar da gelir). Sonuçta durum_sayilari de döner: \"kaç taslak var\" sorusu için bunu kullan.", "input_schema": _obj({"query": {"type": "string"}, "limit": {"type": "integer"}, "state": {"type": "string", "enum": ["active", "inactive", "draft", "sold_out", "expired"]}})},
    {"name": "get_listing", "description": "Bir listing'in mevcut başlığı, etiketleri, açıklaması ve fiyatı (düzenlemeden önce bakmak için).", "input_schema": _obj({"listing_id": {"type": "integer"}}, ["listing_id"])},
    {"name": "shop_defaults", "description": "Yeni listing için mağazanın en çok kullanılan kategorileri, kargo profili ve iade politikası.", "input_schema": _obj({})},
    {"name": "similar_listings", "description": "Mağazadaki benzer listing'leri bulur (İngilizce anahtar kelimelerle): fiyatlarını, etiketlerini, başlık üslubunu ve açıklama örneğini verir. Yeni listing'de fiyat ve üslup için MUTLAKA bak.", "input_schema": _obj({"query": {"type": "string", "description": "İngilizce ürün anahtar kelimeleri, ör. 'mountain metal wall art'"}, "limit": {"type": "integer"}}, ["query"])},
    {"name": "find_category", "description": "Etsy kategori ağacında ada göre arar ve kategori kimliği (taxonomy_id) bulur.", "input_schema": _obj({"query": {"type": "string"}}, ["query"])},
    {"name": "create_listing_draft", "description": "Yeni listing YEREL TASLAĞI oluşturur (Etsy'ye göndermez). Kullanıcının verdiği bilgileri ve sohbete yüklediği resimleri (image_ids) kullanır; verilmeyen adet mağazanın tipik değeriyle doldurulur; verilmeyen fiyat BOŞ kalır ve taslak yayına hazır sayılmaz. Kullanıcı SEO uyumlu yazmanı isterse ya da bilgi kabaysa başlık, 13 etiket ve açıklamayı sen üret; ürünün gerçek özelliklerini uydurma.", "input_schema": _obj({
        "title": {"type": "string", "description": "En fazla 140 karakter, doğal okunan, ilk 40 karakterde ana anahtar kelime"},
        "description": {"type": "string", "description": "YALNIZCA ürüne özel kısım (satış paragrafı + özellik maddeleri). Mağazanın sabit bölümleri otomatik eklenir; onları yazma"},
        "tags": {"type": "array", "items": {"type": "string"}, "description": "En fazla 13 etiket, her biri en fazla 20 karakter"},
        "price": {"type": "number", "description": "Mağaza para biriminde birim fiyat. YALNIZCA kullanıcı söylediyse ver; söylemediyse BOŞ BIRAK (tahmin etme, benzer listing'lerden çıkarma). Boşsa taslak 'Fiyat gir.' eksiğiyle oluşur ve yayınlanamaz."},
        "dimensions": _obj({"length": {"type": "number"}, "width": {"type": "number"}, "height": {"type": "number"}, "unit": {"type": "string", "enum": ["mm", "cm", "m", "in", "ft"]}}),
        "description_template_id": {"type": "integer", "description": "Kullanılacak hazır açıklama metni. Verilmezse mağazanın VARSAYILAN şablonu kullanılır; 0 = şablon kullanma. Şablon kullanılırken description'a kargo/garanti/iletişim gibi sabit kısımları YAZMA."},
        "use_standard_sections": {"type": "boolean", "description": "Mağazanın sabit açıklama bölümlerini (iletişim, işleme/teslimat, garanti, yasal uyarı) açıklamaya otomatik ekle. Varsayılan true"},
        "quantity": {"type": "integer", "description": "Stok adedi. Kullanıcı vermediyse BOŞ BIRAK: mağazanın tipik adedi kullanılır"},
        "materials": {"type": "array", "items": {"type": "string"}},
        "variations": {"type": "array", "description": "En fazla 3 varyasyon. Fiyat yalnızca bir varyasyona göre değişebilir. Kullanıcı seçenek başına stok verdiyse (100 cm: 10 adet, 50 cm: 5 adet) her seçeneğe quantity yaz.", "items": _obj({"name": {"type": "string"}, "values": {"type": "array", "items": _obj({"value": {"type": "string"}, "price": {"type": "number", "description": "Bu seçeneğin fiyatı (isteğe bağlı)"}, "quantity": {"type": "integer", "description": "Bu seçeneğin stoğu (isteğe bağlı; yoksa genel quantity)"}}, ["value"])}}, ["name", "values"])},
        "image_ids": {"type": "array", "items": {"type": "string"}, "description": "Sohbete yüklenen resimlerin kimlikleri (sistem mesajındaki listeden)"},
        "image_alt_texts": {"type": "array", "items": {"type": "string"}, "description": "Her resim için, image_ids ile AYNI SIRADA alt metin: resimde gerçekten görünenin tek cümlelik betimlemesi (en fazla 125 karakter, 'image of' ile başlama, anahtar kelime doldurma), başlıkla aynı dilde"},
        "taxonomy_id": {"type": "integer", "description": "Kategori kimliği (shop_defaults'tan)"},
        "attributes": {"type": "array", "description": "Kategori özellikleri (malzeme, kullanım yeri/occasion, renk, kişiselleştirilebilir mi…): [{name, values, unit?}]. İzin verilen değerler get_category_attributes'tedir; bilmiyorsan ver, sonuçtaki hata/eksik listesine göre set_listing_attributes ile tamamla.", "items": _obj({"name": {"type": "string"}, "values": {"type": "array", "items": {"type": "string"}}, "unit": {"type": "string"}}, ["name"])},
        "personalization_questions": {"type": "array", "description": "Kullanıcı kişiselleştirme (isim/yazı vb.) istediyse sorular, en fazla 5: {question_text, question_type (text_input|dropdown), required, max_allowed_characters, instructions, options}", "items": _obj({"question_text": {"type": "string"}, "instructions": {"type": "string"}, "question_type": {"type": "string", "enum": list(fields.QUESTION_TYPES)}, "required": {"type": "boolean"}, "max_allowed_characters": {"type": "integer"}, "options": {"type": "array", "items": {"type": "string"}}}, ["question_text"])},
        "video_ids": {"type": "array", "items": {"type": "string"}, "description": "Kullanıcının sohbete yüklediği VİDEOLARIN kimlikleri (sistem mesajındaki KULLANICI VİDEOLARI listesinden), en fazla 2. Kullanıcı video yüklediyse mutlaka ver."},
        "crop_photos": {"type": "array", "description": "Kullanıcı kırpma istediyse (ör. ana resmi 1:1 kırp): [{photo_number, ratio 1:1|4:3|3:4|original, zoom, center_x, center_y}]; taslakla birlikte uygulanır.", "items": _obj({"photo_number": {"type": "integer"}, "ratio": {"type": "string", "enum": ["1:1", "4:3", "3:4", "original"]}, "zoom": {"type": "number"}, "center_x": {"type": "number"}, "center_y": {"type": "number"}}, ["photo_number"])},
        "wanted_image_count": {"type": "integer", "description": "Kullanıcı 'N resim olsun / N farklı resim oluştur' dediyse N (en çok 20). Yüklenen resim bundan azsa sonuçta eksik_resim döner ve sen o kadarını edit_chat_image ile üretip eklersin."},
        "who_made": {"type": "string", "enum": ["i_did", "someone_else", "collective"]},
        "when_made": {"type": "string"},
    }, ["title"])},
    {"name": "shop_options", "description": "Mağazanın bölüm (section), kargo profili, iade politikası ve hazırlık süresi seçenekleri: kimlik ve adlarıyla. update_listing/bulk_update_listings'te bu kimlikleri kullanmadan önce çağır.", "input_schema": _obj({})},
    {"name": "workspace_status", "description": "Yayınlanmamış yeni listing'ler ve yerel düzenlemeler, listing/sipariş/finans senkronizasyon durumu. 'Kaç taslağım var', 'hangileri yayınlanmadı', 'senkronizasyon ne durumda' soruları için.", "input_schema": _obj({"limit": {"type": "integer"}})},
    {"name": "orders_overview", "description": "Sipariş sayfasındaki sayılar: gönderilecek, gecikmiş, bugün gönderilmesi gereken, tamamlanan, iptal/iade, toplam; gönderilecekler arasında kişiselleştirmeli, hediye, alıcı notlu ve ülke dağılımı.", "input_schema": _obj({})},
    {"name": "order_detail", "description": "Tek siparişin ayrıntısı: kalemler ve seçenekler, kişiselleştirme cevapları, alıcı/hediye notu, kargo yöntemi, takip kodu ve maliyet. Sipariş numarasını list_orders'tan al.", "input_schema": _obj({"receipt_id": {"type": "integer"}}, ["receipt_id"])},
    {"name": "orders_missing_costs", "description": "Ürün maliyeti tanımlı olmadığı için kârı eksik hesaplanan siparişler ve en çok eksik kalan ürünler. Tarih verilmezse son 90 gün.", "input_schema": _obj({"start_date": DATE, "end_date": DATE, "limit": {"type": "integer"}})},
    {"name": "shipping_invoices", "description": "Kayıtlı kargo/gümrük faturaları (gönderi başına): toplam tutar, kalemler (nakliye/gümrük/ek hizmet), aynı gönderiye fazla kesilmiş kalem uyarıları ve siparişe bağlanamayanlar. Alıcı adı, takip no, ürün ya da fatura no ile aranabilir.", "input_schema": _obj({"query": {"type": "string"}, "kind": {"type": "string", "enum": ["nakliye", "gümrük", "ek hizmet", "diğer"]}, "start_date": DATE, "end_date": DATE, "sort": {"type": "string", "enum": ["inv_date", "order_date", "buyer", "amount"]}, "limit": {"type": "integer"}})},
    {"name": "keyword_pool", "description": "Etiket/anahtar kelime havuzu (kendi satan listing'lerinin ve rakiplerin etiketleri). Var olan listing için listing_id; yeni ürün için İngilizce query ve taxonomy_id (find_category'den) ver. Başlık/etiket yazmadan önce bak.", "input_schema": _obj({"listing_id": {"type": "integer"}, "query": {"type": "string"}, "taxonomy_id": {"type": "integer"}, "limit": {"type": "integer"}})},
    {"name": "bulk_update_listings", "description": "Birden çok listing'e AYNI değişikliği YEREL TASLAK olarak uygular (Etsy'ye göndermez; en fazla 100 listing). Listing'leri listing_ids ile ya da başlığında geçen ifadeyle (title_contains) seç. Fiyat yüzdesi/tutarı, etiket ekle/çıkar, başlıkta bul-değiştir/önek/sonek, bölüm/kargo/iade/hazırlık süresi. Kullanıcı kapsamı (kaç listing, ne değişecek) net söylemediyse önce sor.", "input_schema": _obj({
        "listing_ids": {"type": "array", "items": {"type": "integer"}}, "title_contains": {"type": "string"},
        "price_change_percent": {"type": "number", "description": "10 = %10 zam, -5 = %5 indirim"}, "price_change_amount": {"type": "number"}, "price_rounding": {"type": "string", "enum": ["none", "x.99", "x.00"]},
        "add_tags": {"type": "array", "items": {"type": "string"}}, "remove_tags": {"type": "array", "items": {"type": "string"}},
        "title_find": {"type": "string"}, "title_replace": {"type": "string"}, "title_prefix": {"type": "string"}, "title_suffix": {"type": "string"},
        "shop_section_id": {"type": "integer"}, "shipping_profile_id": {"type": "integer"}, "return_policy_id": {"type": "integer"}, "readiness_state_id": {"type": "integer"},
        "production_partner_ids": {"type": "array", "items": {"type": "integer"}}, "should_auto_renew": {"type": "boolean"},
        "description_template_id": {"type": "integer", "description": "Hazır açıklama metni (list_description_templates). Eski sabit kısım (kargo/garanti vb.) çıkarılır, bu şablon ürün yazısının etrafına konur."},
    })},
    {"name": "update_listing", "description": "Var olan bir listing'in ya da daha önce oluşturduğun taslağın (negatif listing_id) başlık, açıklama, etiket, fiyat, VARYASYONLAR (boyut/renk vb.), bölüm, kargo profili, iade politikası, hazırlık süresi, üretim ortağı veya otomatik yenilemesini YEREL TASLAK olarak değiştirir (Etsy'ye göndermez). Kullanıcı sohbette konuşulan listing'e/taslağa bir şey eklemek ya da değiştirmek isterse HER ZAMAN bunu kullan; create_listing_draft ile yeni taslak AÇMA. Önce get_listing ile mevcut hâline bak.", "input_schema": _obj({
        "listing_id": {"type": "integer"}, "new_title": {"type": "string"}, "new_description": {"type": "string"},
        "set_tags": {"type": "array", "items": {"type": "string"}, "description": "Etiketlerin tamamını bununla değiştirir (en fazla 13)"},
        "add_tags": {"type": "array", "items": {"type": "string"}}, "remove_tags": {"type": "array", "items": {"type": "string"}},
        "set_price": {"type": "number"}, "price_change_percent": {"type": "number", "description": "Örn. 10 = %10 zam, -5 = %5 indirim"},
        "shop_section_id": {"type": "integer"}, "shipping_profile_id": {"type": "integer"}, "return_policy_id": {"type": "integer"}, "readiness_state_id": {"type": "integer"},
        "production_partner_ids": {"type": "array", "items": {"type": "integer"}}, "should_auto_renew": {"type": "boolean"},
        "description_template_id": {"type": "integer", "description": "Hazır açıklama metni (list_description_templates). Eski sabit kısım (kargo/garanti vb.) çıkarılır, bu şablon ürün yazısının etrafına konur."},
        "set_variations": {"type": "array", "description": "Varyasyonları bununla BAŞTAN kurar (mevcutlar silinir). En fazla 3 varyasyon; fiyat yalnızca birine göre değişebilir. Örn. [{name: 'Size', values: [{value: 'L - 120x50', price: 150}, {value: 'M - 50x50', price: 90}]}, {name: 'Color', values: [{value: 'Black'}, {value: 'Gold'}]}]",
                           "items": _obj({"name": {"type": "string"}, "values": {"type": "array", "items": _obj({"value": {"type": "string"}, "price": {"type": "number"}}, ["value"])}}, ["name", "values"])},
        "quantity": {"type": "integer", "description": "set_variations ile birlikte: her kombinasyonun stoğu (verilmezse mevcut stok korunur)"},
    }, ["listing_id"])},
    {"name": "regenerate_listing_image", "description": "Bir listing fotoğrafını AI ile yeniden oluşturur (yalnızca taslağa yazar, Etsy'ye göndermez). Kamera açısı ve/veya mesafe/kadraj ve/veya serbest sahne talimatı verilebilir, hepsi birlikte uygulanır. subject_image_id: sahnede birden fazla obje olduğunda 'ürün bu' diye işaret eden, aynı listing'in başka bir fotoğrafı.", "input_schema": _obj({
        "listing_id": {"type": "integer"}, "photo_number": {"type": "integer", "description": "Değiştirilecek fotoğrafın sırası, 1'den başlar (kullanıcı 'birinci/ikinci resim' derse bunu ver)"},
        "image_id": {"type": "integer", "description": "Alternatif: fotoğrafın listing_image_id'si (get_listing.fotograflar.image_id)"},
        **_CAMERA_SCHEMA,
        "prompt": {"type": "string", "description": "Sahne talimatı, ör. 'oturma odasında göster', 'arka planı beyaz yap'"},
        "subject_image_id": {"type": "integer"},
        **_QUALITY_SCHEMA,
    }, ["listing_id"])},
    {"name": "get_category_attributes", "description": "Listing'in kategorisinin özelliklerini (renk, malzeme, kullanım yeri, ölçü…) verir: hangileri ZORUNLU, izin verilen değerler, birimler ve şu anki seçimler. Özellik yazmadan ve kategori değişince çağır; kullanıcının söylediklerinden (ör. 'metal') ve varyasyon renklerinden uygun olanları set_listing_attributes ile kendin doldur, yalnızca bilmediğin ZORUNLU olanları kullanıcıya sor.", "input_schema": _obj({"listing_id": {"type": "integer"}}, ["listing_id"])},
    {"name": "set_listing_attributes", "description": "Kategori özelliklerini izin verilen değerlere göre yazar (yerel taslak). attributes: [{name: 'Primary color', values: ['Black']}, {name: 'Width', values: ['30'], unit: 'cm'}]. İzin verilen listede olmayan değer yazılmaz ve hata olarak döner (uydurma). Boş values özelliği kaldırır. Önce get_category_attributes'e bak.", "input_schema": _obj({"listing_id": {"type": "integer"}, "attributes": {"type": "array", "items": _obj({"name": {"type": "string"}, "values": {"type": "array", "items": {"type": "string"}}, "unit": {"type": "string", "description": "Yalnızca ölçü özelliklerinde (cm, in…)"}}, ["name"])}}, ["listing_id", "attributes"])},
    {"name": "set_listing_fields", "description": "Listing taslağının şu alanlarını doğrulayarak yazar: malzemeler, stil, kategori (taxonomy_id; find_category'den), kim yaptı / ne zaman yapıldı, tedarik ürünü mü, vergilendirme, ağırlık ve boyutlar (birimleriyle), SKU (varyasyonsuz listing) ve kişiselleştirme soruları. Yalnızca yerel taslak; Etsy'ye gitmez. Sonuçtaki hatalar yazılmamıştır: kullanıcıya olduğu gibi söyle.", "input_schema": _obj({
        "listing_id": {"type": "integer"},
        "materials": {"type": "array", "items": {"type": "string"}, "description": "En fazla 13; yalnızca harf, rakam, boşluk"},
        "style": {"type": "array", "items": {"type": "string"}, "description": "En fazla 2, her biri en fazla 45 karakter"},
        "taxonomy_id": {"type": "integer", "description": "En alttaki (alt kategorisi olmayan) kategori kimliği"},
        "who_made": {"type": "string", "enum": list(fields.WHO_MADE)},
        "when_made": {"type": "string", "enum": list(fields.WHEN_MADE)},
        "is_supply": {"type": "boolean"}, "is_taxable": {"type": "boolean"},
        "weight": {"type": "number"}, "weight_unit": {"type": "string", "enum": list(fields.WEIGHT_UNITS)},
        "length": {"type": "number"}, "width": {"type": "number"}, "height": {"type": "number"}, "dimensions_unit": {"type": "string", "enum": list(fields.DIMENSION_UNITS)},
        "sku": {"type": "string"},
        "featured_rank": {"type": "integer", "description": "Mağaza vitrinindeki sıra (1 en başta)"},
        "ecgt_garan_brand": {"type": "string"}, "ecgt_garan_model": {"type": "string"}, "ecgt_garan_years": {"type": "integer", "description": "3–99"}, "ecgt_garan_guarantee_details": {"type": "string"},
        "ecgt_other_commercial_guarantee_details": {"type": "string"}, "ecgt_after_sales_service_info": {"type": "string"}, "ecgt_software_update_details": {"type": "string"},
        "add_personalization_questions": {"type": "array", "description": "Mevcut kişiselleştirme sorularına EKLER (en fazla 5 toplam); 'daha önce kullanılanlar'dan (personalization_library) seçilenler için bunu kullan. Aynı metinli soru atlanır.", "items": _obj({
            "question_text": {"type": "string"}, "instructions": {"type": "string"}, "question_type": {"type": "string", "enum": list(fields.QUESTION_TYPES)},
            "required": {"type": "boolean"}, "max_allowed_characters": {"type": "integer"}, "options": {"type": "array", "items": {"type": "string"}},
        }, ["question_text"])},
        "personalization_questions": {"type": "array", "description": "Kişiselleştirme (Custom options) sorularının TAMAMI (mevcutları değiştirir); en fazla 5. Boş liste hepsini kaldırır. Eklemek için add_personalization_questions.", "items": _obj({
            "question_text": {"type": "string"}, "instructions": {"type": "string"}, "question_type": {"type": "string", "enum": list(fields.QUESTION_TYPES)},
            "required": {"type": "boolean"}, "max_allowed_characters": {"type": "integer"}, "options": {"type": "array", "items": {"type": "string"}, "description": "Yalnızca dropdown için"},
        }, ["question_text"])},
    }, ["listing_id"])},
    {"name": "edit_personalization_question", "description": "Listing'deki TEK bir kişiselleştirme (Özel seçenekler) sorusunu sıra numarasıyla (get_listing.kisisellestirme sırası, 1'den başlar) düzenler: metni, açıklamasını, zorunlu/isteğe bağlı olmasını, en fazla karakterini, seçenek listesi seçeneklerini değiştirir; delete=true siler; move_to ile sırasını değiştirir. Diğer sorulara dokunmaz ve kimlikleri korur; sorular için personalization_questions (hepsini baştan yazar) KULLANMA. Yeni soru eklemek için set_listing_fields.add_personalization_questions.", "input_schema": _obj({"listing_id": {"type": "integer"}, "number": {"type": "integer"}, "question_text": {"type": "string"}, "instructions": {"type": "string"}, "required": {"type": "boolean"}, "max_allowed_characters": {"type": "integer"}, "options": {"type": "array", "items": {"type": "string"}, "description": "Yalnızca seçenek listesi sorusunda: seçeneklerin TAMAMI, istenen sırayla"}, "delete": {"type": "boolean"}, "move_to": {"type": "integer"}}, ["listing_id", "number"])},
    {"name": "delete_listing_photo", "description": "Listing taslağından bir fotoğrafı kaldırır: sıra numarasıyla (photo_number, 1'den başlar) ya da fotoğraf kimliğiyle (image_id; sohbetteki resim kartından). Etsy'deki fotoğraf yayınlayınca silinir.", "input_schema": _obj({"listing_id": {"type": "integer"}, "photo_number": {"type": "integer"}, "image_id": {"type": "integer"}}, ["listing_id"])},
    {"name": "set_photo_alt_text", "description": "Taslak (henüz Etsy'ye yüklenmemiş) bir fotoğrafın alt metnini yazar; sıra numarasıyla. Etsy'de yayındaki fotoğrafların alt metni değiştirilemez.", "input_schema": _obj({"listing_id": {"type": "integer"}, "photo_number": {"type": "integer"}, "alt_text": {"type": "string", "description": "Resimde görüneni anlatan tek cümle, en fazla 125 karakter önerilir"}}, ["listing_id", "photo_number", "alt_text"])},
    {"name": "edit_inventory", "description": "Stok, fiyat, SKU ve açık/kapalı durumunu değiştirir. Varyasyonsuz listing'de where verme ('stok 50 olsun' = quantity 50). Varyasyonlu listing'de where ile kombinasyon seç ({'Size': 'XL', 'Color': 'Red'}; kısmi seçim eşleşen TÜM kombinasyonları etkiler) ya da where vermeden hepsini değiştir. quantity 1–999; kombinasyonu satıştan kaldırmak için enabled=false. Fiyat aynı anda yalnızca tek varyasyona göre değişebilir (Etsy). Önce get_listing ile mevcut seçeneklere bak. Hata varsa hiçbir şey yazılmaz.", "input_schema": _obj({"listing_id": {"type": "integer"}, "where": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Varyasyon adı → seçenek"}, "quantity": {"type": "integer"}, "price": {"type": "number"}, "sku": {"type": "string"}, "auto_sku": {"type": "string", "description": "Seçilen TÜM kombinasyonlara okunur SKU üretir (önek + seçenekler, ör. önek GLS → GLS-15X20CM). Önek boş string de olabilir. 'Otomatik SKU ekle' için bunu kullan; tek tek sku verme."}, "enabled": {"type": "boolean"}}, ["listing_id"])},
    {"name": "add_variation_option", "description": "Var olan bir varyasyona YENİ SEÇENEK ekler (ör. Size varyasyonuna '15x20 cm'); mevcut stok, SKU, fiyat ve fotoğraf bağları korunur. Seçenek eklemek için set_variations ile baştan kurma. Yeni satırlar copy_from seçeneğinin (verilmezse ilkinin) satırlarından kopyalanır; varyasyon fiyata göre değişiyorsa price ver. Etsy'nin hazır değerleriyle kurulu (standart) varyasyonlarda da çalışır: ad hazır listedekilerden biriyse standart değer olarak, değilse özel değer olarak eklenir. Önce get_listing ile mevcut seçeneklere bak. Hata varsa hiçbir şey yazılmaz.", "input_schema": _obj({"listing_id": {"type": "integer"}, "variation": {"type": "string"}, "option": {"type": "string"}, "price": {"type": "number"}, "quantity": {"type": "integer"}, "copy_from": {"type": "string", "description": "Hangi mevcut seçeneğin ayarları kopyalansın"}}, ["listing_id", "variation", "option"])},
    {"name": "remove_variation_option", "description": "Bir varyasyon seçeneğini ve onu içeren tüm kombinasyonları kaldırır (ör. variation 'Color', option 'Red'). Diğer seçenekler ve fiyatlar korunur; set_variations gibi baştan kurmaz.", "input_schema": _obj({"listing_id": {"type": "integer"}, "variation": {"type": "string"}, "option": {"type": "string"}}, ["listing_id", "variation", "option"])},
    {"name": "set_variation_photo", "description": "Bir varyasyon seçeneğine listing fotoğrafı bağlar (ör. Color: Red → 3. fotoğraf). photo_number vermezsen bağı kaldırır. Etsy yalnızca TEK bir varyasyona fotoğraf bağlamaya izin verir.", "input_schema": _obj({"listing_id": {"type": "integer"}, "variation": {"type": "string"}, "option": {"type": "string"}, "photo_number": {"type": "integer"}}, ["listing_id", "variation", "option"])},
    {"name": "remove_listing_video", "description": "Listing taslağından bir videoyu sıra numarasıyla (1'den başlar) kaldırır. Etsy'deki video yayınlayınca silinir.", "input_schema": _obj({"listing_id": {"type": "integer"}, "video_number": {"type": "integer"}}, ["listing_id", "video_number"])},
    {"name": "copy_listing", "description": "Var olan bir listing'in kopyasını yeni yerel taslak olarak oluşturur (fotoğraflar, varyasyonlar, özellikler dahil). Sonra başlığı/etiketleri ürüne göre değiştir; Etsy'ye gitmez.", "input_schema": _obj({"source_listing_id": {"type": "integer"}}, ["source_listing_id"])},
    {"name": "discard_listing_changes", "description": "ONAY GEREKİR. Etsy'de yayındaki bir listing'deki yayınlanmamış yerel değişiklikleri atar (listing Etsy'deki hâline döner). confirm=true verilmeden yalnızca ne olacağını özetler.", "input_schema": _obj({"listing_id": {"type": "integer"}, "confirm": {"type": "boolean"}}, ["listing_id"])},
    {"name": "delete_listing", "description": "ONAY GEREKİR. Listing'i siler: Etsy'deki listing Etsy'den KALICI silinir ve GERİ ALINAMAZ; henüz Etsy'ye gitmemiş yeni taslak yalnızca yerelden silinir. confirm=true verilmeden yalnızca ne olacağını özetler.", "input_schema": _obj({"listing_id": {"type": "integer"}, "confirm": {"type": "boolean"}}, ["listing_id"])},
    {"name": "personalization_library", "description": "Mağazanın diğer listing'lerinde daha önce kullanılan kişiselleştirme (Özel seçenekler / 'Recently used') soruları, kullanım sayısına göre. Kullanıcı kişiselleştirme isterse ya da ürün kişiselleştirilebilir görünüyorsa buradan öneri sun.", "input_schema": _obj({})},
    {"name": "generation_options", "description": "Görsel ve video üretimi için seçilebilir modeller, kalite/çözünürlük seçenekleri (1K/2K/4K gibi) ve kredi bedelleri. Kullanıcı kredi/kalite sorarsa ya da üretimden önce seçenek sunarken çağır.", "input_schema": _obj({})},
    {"name": "generate_listing_video", "description": "Bir fotoğraftan ürün videosu üretir (5–15 sn, kredi harcar). photo_number: listing'in o sıradaki fotoğrafı (varsayılan 1) ya da chat_image_id: sohbetteki bir resim (ör. az önce ürettiğin). Model TEK resimden video üretir; 'listedeki 4 resimden video' istenirse tek bir fotoğrafı seç ya da her fotoğraf için ayrı video önerip maliyeti söyle. confirm vermeden yalnızca kredi bedelini döner: kullanıcıya söyle, AÇIKÇA onay al, onaylarsa confirm=true ile tekrar çağır. listing_id verilmezse sohbetteki en son yeni taslak kullanılır.", "input_schema": _obj({"listing_id": {"type": "integer"}, "photo_number": {"type": "integer"}, "chat_image_id": {"type": "string"}, "prompt": {"type": "string", "description": "Hareket tarifi, İngilizce (ör. 'slow camera move around the product'); verilmezse sakin bir ürün videosu"}, "duration": {"type": "integer", "description": "Saniye, 5 ile 15 arası (varsayılan 5)"}, **_QUALITY_SCHEMA, "confirm": {"type": "boolean"}}, [])},
    {"name": "add_video_to_listing", "description": "Listing taslağına video ekler: ÜRETİLMİŞ video için file_id (kullanıcının 'listing'e ekle' mesajında yazar) ya da kullanıcının sohbete YÜKLEDİĞİ kendi videosu için chat_video_id (KULLANICI VİDEOLARI listesinden). Ya biri ya öbürü. listing_id verilmezse sohbetteki en son yeni taslak. Bir listing'e en fazla 2 video.", "input_schema": _obj({"file_id": {"type": "string"}, "chat_video_id": {"type": "string"}, "listing_id": {"type": "integer"}}, [])},
    {"name": "crop_listing_photo", "description": "Listing fotoğrafını kırpar: ratio 1:1 (kare, küçük resim için ideal), 4:3, 3:4 ya da original; zoom 1–4 (1 = tam kadraj, büyüdükçe yakınlaşır); center_x/center_y 0–1 odak noktası (0.5, 0.5 = orta; sol-üst 0,0). 'Ana resmi kırp, ürün ortada olsun' = photo_number 1, ratio 1:1. Resim kırpmak için edit_chat_image KULLANMA (o yeni görsel üretir, kredi harcar); kırpma ücretsizdir. Yalnızca yerel taslağa yazar.", "input_schema": _obj({"listing_id": {"type": "integer"}, "photo_number": {"type": "integer"}, "ratio": {"type": "string", "enum": ["1:1", "4:3", "3:4", "original"]}, "zoom": {"type": "number"}, "center_x": {"type": "number"}, "center_y": {"type": "number"}}, ["listing_id", "photo_number"])},
    {"name": "move_listing_photo", "description": "Listing taslağındaki bir fotoğrafın sırasını değiştirir. 'Üçüncü resmi ana resim yap' = photo_number 3, to_position 1 (ana fotoğraf birinci sıradadır). Fotoğraf sırası için update_listing KULLANMA.", "input_schema": _obj({"listing_id": {"type": "integer"}, "photo_number": {"type": "integer", "description": "Taşınacak fotoğrafın şimdiki sırası (1'den başlar)"}, "to_position": {"type": "integer", "description": "Hedef sıra (varsayılan 1 = ana fotoğraf)"}}, ["listing_id", "photo_number"])},
    {"name": "edit_chat_image", "description": "AI ile YENİ bir görsel üretir (arka plan temizle/değiştir, 'ürünü kullanımda / oturma odasında göster', kamera açısı). Kaynak: sohbetteki bir resim (image_id) YA DA bir listing fotoğrafı (listing_id + photo_number). Sonuç sohbette simgeli bir kartla gösterilir, kaynak değişmez. Listing'e YALNIZCA kullanıcı 'ekle' dediyse add_to_listing=true ver; vermezsen sadece gösterilir ve kullanıcı beğenirse ekler ya da yeniden ürettirir. Etsy'ye hiçbir şey göndermez; kredi harcar.", "input_schema": _obj({
        "image_id": {"type": "string", "description": "Kaynak: sohbete eklenen resmin kimliği (sistem mesajındaki listeden)"},
        "photo_number": {"type": "integer", "description": "Kaynak: listing_id ile birlikte, listing'in o sıradaki fotoğrafı (1'den başlar)"},
        "alt_text": {"type": "string", "description": "add_to_listing=true ise eklenen fotoğrafın alt metni: görselde görünenin tek cümlelik betimlemesi (en fazla 125 karakter), başlıkla aynı dil. MUTLAKA ver."}, "add_to_listing": {"type": "boolean", "description": "Yalnızca kullanıcı açıkça eklenmesini istediyse true"},
        "prompt": {"type": "string", "description": "Ne yapılacağı, ör. 'arka planı beyaz yap', 'oturma odasında duvara asılı göster'"},
        **_CAMERA_SCHEMA,
        **_QUALITY_SCHEMA,
        "listing_id": {"type": "integer", "description": "Kaynak fotoğrafın listing'i; add_to_listing ile sonucun ekleneceği listing de budur (vermezsen en son yeni taslak)"},
    }, ["image_id"])},
    {"name": "add_chat_image_to_listing", "description": "Sohbetteki mevcut bir resmi (ör. edit_chat_image'ın ürettiği, yeni_resim_id) listing taslağına yeni fotoğraf olarak ekler; yeniden üretmez, kredi harcamaz. listing_id verilmezse sohbetteki en son oluşturulan yeni taslak kullanılır ('az önce oluşturduğumuz listeye ekle').", "input_schema": _obj({"image_id": {"type": "string"}, "alt_text": {"type": "string", "description": "Eklenen fotoğrafın alt metni (görselde görünenin tek cümlelik betimlemesi)"}, "listing_id": {"type": "integer"}}, ["image_id"])},
    {"name": "generate_missing_alt_texts", "description": "Bir listing'in alt metni olmayan (yalnızca YENİ/taslak) fotoğrafları için yapay zekâyla alt metin yazar.", "input_schema": _obj({"listing_id": {"type": "integer"}}, ["listing_id"])},
    {"name": "listing_health_status", "description": "Listing'in optimizasyon durumu: yeterli veri var mı, performansı mağaza medyanına göre nasıl, hangi alan zayıf, durdurmayı değerlendirmeli mi. listing_id vermezsen dikkat isteyen tüm listing'leri döner.", "input_schema": _obj({"listing_id": {"type": "integer"}})},
    {"name": "keep_watching_listing", "description": "Bir listing için 'durdurmayı değerlendir' önerisini reddedip izlemeye devam eder (sayaç sıfırlanır). Etsy'ye hiçbir şey göndermez.", "input_schema": _obj({"listing_id": {"type": "integer"}}, ["listing_id"])},
    {"name": "publish_listing_draft", "description": "ONAY GEREKİR. Bir listing'in taslağını/yerel değişikliklerini GERÇEKTEN Etsy'ye yayınlar (canlıya yansır). confirm=true verilmeden yalnızca ne yayınlanacağını özetler.", "input_schema": _obj({"listing_id": {"type": "integer"}, "confirm": {"type": "boolean"}, "force": {"type": "boolean", "description": "Etsy'de sonradan değişen alanları da ezer (çakışma varsa)"}, "activate": {"type": "boolean", "description": "true: listing aynı işlemde AKTİF edilir (satışa açılır, 0,20 $ ücret). Yeni listing'i ya da Etsy'deki taslağı canlıya almak için. Verilmezse yeni listing Etsy'de taslak olarak kalır."}}, ["listing_id"])},
    {"name": "deactivate_listing", "description": "ONAY GEREKİR. Listing'i Etsy'de INACTIVE yapar (satışa kapanır). confirm=true verilmeden yalnızca ne olacağını özetler.", "input_schema": _obj({"listing_id": {"type": "integer"}, "confirm": {"type": "boolean"}}, ["listing_id"])},
    {"name": "listing_diagnosis", "description": "Bir listing'in satış teşhisi: neden düştüğü (mağaza geneli mi listing'e özel mi, fiyat, içerik değişikliği, yorumlar, görünürlük/dönüşüm), düşüşün başladığı ay, mevsim (zirveye kaç hafta) ve önerilen tek hamle. 'Bu listing neden satmıyor/düştü' sorularında ve bir listing'i iyileştirmeden önce MUTLAKA kullan.", "input_schema": _obj({"listing_id": {"type": "integer"}}, ["listing_id"])},
    {"name": "track_keywords", "description": "Bir listing'in Etsy aramalarındaki sırasını takip etmeyi yönetir: arama ekle (add), çıkar (remove), measure_now=true ile hemen ölç. Argümansız çağrılırsa mevcut takibi ve önerileri döner. Listing başına en fazla 3 arama, mağaza başına 25 listing.", "input_schema": _obj({
        "listing_id": {"type": "integer"}, "add": {"type": "array", "items": {"type": "string"}}, "remove": {"type": "array", "items": {"type": "string"}}, "measure_now": {"type": "boolean"},
    }, ["listing_id"])},
    {"name": "read_etsy_keyword_data", "description": "Kullanıcının Etsy panelinden kopyaladığı arama verisini okur: Marketplace Insights (aylık arama, rekabet), listing'i getiren arama terimleri ya da Etsy Ads arama terimleri raporu. KAYDETMEZ; onay kartı gösterir. Tablo mesaja yapıştırıldıysa file_id verme; ekran görüntüsüyse file_id ver. Veri belirli bir listing'e aitse listing_id ver. Kargo faturasıyla karıştırma.", "input_schema": _obj({
        "file_id": {"type": "string"}, "listing_id": {"type": "integer"},
    })},
    {"name": "read_shipping_invoice", "description": "Kargo/gümrük faturasını okur ve her gönderi satırını siparişlerle eşleştirir; KAYDETMEZ, kullanıcıya onay kartı gösterir. Kullanıcı sohbete fatura PDF'i/fotoğrafı/Excel/CSV/HTML eklediyse file_id ver; fatura metnini mesaja yapıştırdıysa file_id verme (mesajın kendisi okunur). Ürün fotoğrafını fatura sanma.", "input_schema": _obj({
        "file_id": {"type": "string", "description": "Sohbete eklenen dosyanın/resmin id'si"},
    })},
    {"name": "list_description_templates", "description": "Kullanıcının kaydettiği hazır açıklama metinlerini (şablonları) metinleriyle listeler; hangisinin varsayılan olduğunu gösterir.", "input_schema": _obj({})},
    {"name": "save_description_template", "description": "Hazır açıklama metni (şablon) oluşturur ya da template_id verilirse düzenler; is_default=true ile varsayılan yapar (diğerlerinin varsayılanlığı kalkar). Metinde {product} satırı ürüne özel yazının yeridir; {title}, {shop_name}, {materials}, {sizes}, {colors}, {variations} yer tutucuları listing bilgisiyle dolar. Kullanıcı ne istediğini net söylediyse sormadan yap, sonra ne kaydettiğini özetle.", "input_schema": _obj({
        "template_id": {"type": "integer", "description": "Düzenlenecek şablon; boşsa yeni şablon"}, "name": {"type": "string"}, "body": {"type": "string"}, "is_default": {"type": "boolean"},
    })},
    {"name": "delete_description_templates", "description": "Hazır açıklama metinlerini siler (listing'lere daha önce eklenmiş metinlere dokunmaz). Silmeden önce hangi şablonların silineceğini kullanıcıya söyleyip onay al.", "input_schema": _obj({"template_ids": {"type": "array", "items": {"type": "integer"}}}, ["template_ids"])},
    {"name": "mark_order_shipped", "description": "ONAY GEREKİR. Siparişi Etsy'de kargoya verildi işaretler (alıcıya bildirim gidebilir). confirm=true verilmeden yalnızca ne olacağını özetler.", "input_schema": _obj({"receipt_id": {"type": "integer"}, "confirm": {"type": "boolean"}, "tracking_code": {"type": "string"}, "carrier_name": {"type": "string"}}, ["receipt_id"])},
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
    "shop_options": "Mağaza seçeneklerine bakıyor",
    "workspace_status": "Taslak ve senkronizasyon durumuna bakıyor",
    "orders_overview": "Sipariş sayılarını çıkarıyor",
    "order_detail": "Siparişi açıyor",
    "orders_missing_costs": "Maliyeti eksik siparişleri tarıyor",
    "keyword_pool": "Anahtar kelime havuzuna bakıyor",
    "shipping_invoices": "Kargo faturalarına bakıyor",
    "bulk_update_listings": "Toplu taslak hazırlıyor",
    "regenerate_listing_image": "Fotoğrafı yeniden oluşturuyor",
    "edit_chat_image": "Resmi düzenliyor",
    "move_listing_photo": "Fotoğraf sırasını değiştiriyor",
    "crop_listing_photo": "Fotoğrafı kırpıyor",
    "generate_listing_video": "Video üretimini başlatıyor",
    "generation_options": "Üretim seçeneklerine bakıyor",
    "edit_inventory": "Stok ve fiyatı güncelliyor",
    "remove_variation_option": "Varyasyon seçeneğini kaldırıyor",
    "add_variation_option": "Varyasyon seçeneği ekliyor",
    "set_variation_photo": "Varyasyon fotoğrafını bağlıyor",
    "remove_listing_video": "Videoyu kaldırıyor",
    "copy_listing": "Listing'i kopyalıyor",
    "discard_listing_changes": "Değişiklikleri atıyor",
    "delete_listing": "Listing'i siliyor",
    "personalization_library": "Önceki kişiselleştirmelere bakıyor",
    "add_video_to_listing": "Videoyu listing'e ekliyor",
    "get_category_attributes": "Kategori özelliklerine bakıyor",
    "set_listing_attributes": "Özellikleri yazıyor",
    "set_listing_fields": "Listing alanlarını güncelliyor",
    "edit_personalization_question": "Kişiselleştirme sorusunu düzenliyor",
    "delete_listing_photo": "Fotoğrafı kaldırıyor",
    "set_photo_alt_text": "Alt metni yazıyor",
    "add_chat_image_to_listing": "Resmi listing'e ekliyor",
    "generate_missing_alt_texts": "Alt metinleri yazıyor",
    "listing_health_status": "Listing sağlığına bakıyor",
    "keep_watching_listing": "İzlemeye devam ediyor",
    "publish_listing_draft": "Etsy'ye yayınlıyor",
    "deactivate_listing": "Listing'i pasife alıyor",
    "mark_order_shipped": "Siparişi kargoya verildi işaretliyor",
    "listing_diagnosis": "Listing'in satış teşhisini çıkarıyor",
    "track_keywords": "Arama sırası takibini güncelliyor",
    "read_etsy_keyword_data": "Etsy arama verisini okuyor",
    "read_shipping_invoice": "Faturayı okuyup siparişlerle eşleştiriyor",
    "list_description_templates": "Hazır açıklama metinlerine bakıyor",
    "save_description_template": "Açıklama şablonunu kaydediyor",
    "delete_description_templates": "Açıklama şablonlarını siliyor",
}

# Arayüz İngilizce olduğunda gösterilen ilerleme metinleri (TOOL_LABELS ile aynı anahtarlar).
TOOL_LABELS_EN = {
    "finance_summary": "Checking finance data",
    "monthly_pnl": "Building the monthly profit and loss table",
    "top_products": "Comparing top products",
    "compare_periods": "Comparing with the same period last year",
    "listing_performance": "Checking listing performance",
    "stale_listings": "Scanning listings that have not been updated",
    "save_ad_report": "Calculating ad data",
    "ad_reports": "Loading ad reports",
    "ads_summary": "Reviewing ad spend",
    "list_orders": "Loading orders",
    "search_listings": "Searching listings",
    "get_listing": "Reading the listing",
    "shop_defaults": "Checking shop defaults",
    "find_category": "Looking up the category",
    "similar_listings": "Reviewing similar listings",
    "create_listing_draft": "Creating the draft",
    "update_listing": "Updating the draft",
    "shop_options": "Checking shop options",
    "workspace_status": "Checking draft and sync status",
    "orders_overview": "Counting orders",
    "order_detail": "Opening the order",
    "orders_missing_costs": "Finding orders with missing costs",
    "keyword_pool": "Checking the keyword pool",
    "shipping_invoices": "Checking shipping invoices",
    "bulk_update_listings": "Preparing bulk drafts",
    "regenerate_listing_image": "Regenerating the photo",
    "edit_chat_image": "Editing the image",
    "move_listing_photo": "Reordering the photos",
    "crop_listing_photo": "Cropping the photo",
    "generate_listing_video": "Starting the video",
    "generation_options": "Checking the generation options",
    "edit_inventory": "Updating stock and price",
    "remove_variation_option": "Removing the variation option",
    "add_variation_option": "Adding a variation option",
    "set_variation_photo": "Linking the variation photo",
    "remove_listing_video": "Removing the video",
    "copy_listing": "Copying the listing",
    "discard_listing_changes": "Discarding the changes",
    "delete_listing": "Deleting the listing",
    "personalization_library": "Checking earlier personalization options",
    "add_video_to_listing": "Adding the video to the listing",
    "get_category_attributes": "Checking the category attributes",
    "set_listing_attributes": "Setting attributes",
    "set_listing_fields": "Updating listing fields",
    "edit_personalization_question": "Editing a personalization question",
    "delete_listing_photo": "Removing the photo",
    "set_photo_alt_text": "Writing the alt text",
    "add_chat_image_to_listing": "Adding the image to the listing",
    "generate_missing_alt_texts": "Writing alt texts",
    "listing_health_status": "Checking listing health",
    "keep_watching_listing": "Keeping the listing under watch",
    "publish_listing_draft": "Publishing to Etsy",
    "deactivate_listing": "Deactivating the listing",
    "mark_order_shipped": "Marking the order as shipped",
    "listing_diagnosis": "Diagnosing the listing's sales",
    "track_keywords": "Updating search rank tracking",
    "read_etsy_keyword_data": "Reading the Etsy search data",
    "read_shipping_invoice": "Reading the invoice and matching orders",
    "list_description_templates": "Checking description templates",
    "save_description_template": "Saving the description template",
    "delete_description_templates": "Deleting description templates",
}

EXECUTORS = {
    "finance_summary": finance_summary, "monthly_pnl": monthly_pnl, "top_products": top_products, "listing_performance": listing_performance, "stale_listings": stale_listings, "save_ad_report": save_ad_report, "ad_reports": ad_reports, "compare_periods": compare_periods, "ads_summary": ads_summary, "list_orders": list_orders,
    "search_listings": search_listings, "get_listing": get_listing, "shop_defaults": shop_defaults, "find_category": find_category, "similar_listings": similar_listings,
    "create_listing_draft": create_listing_draft, "update_listing": update_listing,
    "shop_options": shop_options, "workspace_status": workspace_status, "orders_overview": orders_overview, "order_detail": order_detail,
    "orders_missing_costs": orders_missing_costs, "keyword_pool": keyword_pool, "shipping_invoices": shipping_invoices, "bulk_update_listings": bulk_update_listings,
    "regenerate_listing_image": regenerate_listing_image, "edit_chat_image": edit_chat_image, "move_listing_photo": move_listing_photo, "crop_listing_photo": crop_listing_photo, "generate_listing_video": generate_listing_video, "generation_options": generation_options, "edit_inventory": edit_inventory, "remove_variation_option": remove_variation_option, "add_variation_option": add_variation_option,
    "set_variation_photo": set_variation_photo, "remove_listing_video": remove_listing_video, "copy_listing": copy_listing,
    "discard_listing_changes": discard_listing_changes, "delete_listing": delete_listing, "personalization_library": personalization_library, "add_video_to_listing": add_video_to_listing, "get_category_attributes": get_category_attributes, "set_listing_attributes": set_listing_attributes,
    "set_listing_fields": set_listing_fields, "delete_listing_photo": delete_listing_photo, "edit_personalization_question": edit_personalization_question, "set_photo_alt_text": set_photo_alt_text, "add_chat_image_to_listing": add_chat_image_to_listing, "generate_missing_alt_texts": generate_missing_alt_texts,
    "listing_health_status": listing_health_status, "keep_watching_listing": keep_watching_listing,
    "publish_listing_draft": publish_listing_draft, "deactivate_listing": deactivate_listing, "mark_order_shipped": mark_order_shipped,
    "read_shipping_invoice": read_shipping_invoice, "listing_diagnosis": listing_diagnosis, "track_keywords": track_keywords, "read_etsy_keyword_data": read_etsy_keyword_data,
    "list_description_templates": list_description_templates, "save_description_template": save_description_template,
    "delete_description_templates": delete_description_templates,
}

# Ayrı modüllerdeki araçlar (bkz. toolsets/__init__.py). Sıra sabit kalmalı: araç listesi istem önbelleğinin parçasıdır.
for _mod in toolsets.MODULES:
    TOOLS += _mod.TOOLS
    EXECUTORS.update(_mod.EXECUTORS)
    TOOL_LABELS.update(_mod.LABELS)
    TOOL_LABELS_EN.update(_mod.LABELS_EN)


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

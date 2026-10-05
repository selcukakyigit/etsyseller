"""Ürün maliyetleri (Finans > Ürün kârlılığı ile aynı veri). Yerel veridir, Etsy'ye hiçbir şey gitmez.

Maliyetin sürümü yoktur: girilen değer o ürünün GEÇMİŞ dahil tüm siparişlerinin kâr hesabında kullanılır. Seçenek (ör.
"Size: 24 inch") maliyeti varsa ilan maliyetinin yerine geçer. Belirtilmeyen alanlar (ör. yalnızca kargo verildiyse birim
maliyet) mevcut değerinden korunur."""
import datetime as dt

from sqlalchemy import select

from app.core.i18n import tr
from app.finance import service as fin
from app.finance.models import ListingCost, VariantCost

MAX_LISTINGS = 50
REPORT_DAYS = 730  # seçenek anahtarları satılmış siparişlerden gelir; son iki yıl
_FIELDS = ("unit_cost", "shipping_cost", "cost_pct")


def _r(x) -> float | None:
    return None if x is None else round(float(x), 2)


def _products(ctx) -> tuple[list[dict], str]:
    rep = fin.report(ctx.db, ctx.shop, ctx.today - dt.timedelta(days=REPORT_DAYS), ctx.today)
    return rep["products"], rep["currency"]


def _cost(row: dict) -> dict | None:
    if all(row.get(f) is None for f in _FIELDS):
        return None
    return {"birim": _r(row.get("unit_cost")), "kargo": _r(row.get("shipping_cost")), "satis_yuzdesi": _r(row.get("cost_pct"))}


def product_costs(ctx, a: dict) -> dict:
    """Ürünlerin girilmiş maliyetleri ve satılmış seçeneklerinin anahtarları (set_product_cost'ta kullanılır)."""
    products, currency = _products(ctx)
    if a.get("listing_id"):
        products = [p for p in products if p["listing_id"] == int(a["listing_id"])]
    elif a.get("query"):
        words = str(a["query"]).lower().split()
        products = [p for p in products if all(w in (p.get("title") or "").lower() for w in words)]
    elif a.get("missing_only", True):
        products = [p for p in products if _cost(p) is None and not any(_cost(v) for v in p["variants"])]
    limit = max(1, min(int(a.get("limit") or 10), 30))
    return {
        "para_birimi": currency,
        "eslesen": len(products),
        "urunler": [
            {
                "listing_id": p["listing_id"], "urun": (p.get("title") or "")[:80], "satilan_adet_2yil": p["units"], "maliyet": _cost(p),
                "secenekler": [{"anahtar": v["key"], "adet": v["units"], "maliyet": _cost(v)} for v in p["variants"] if v.get("key")][:15],
            }
            for p in products[:limit]
        ],
        "not": "Seçenek maliyeti için 'anahtar'ı AYNEN kullan. Maliyetler satış başına (adet başına), mağaza para biriminde.",
    }


def _number(a: dict, field: str) -> float | None:
    v = a.get(field)
    if v is None or v == "":
        return None
    v = float(v)
    top = 1000.0 if field == "cost_pct" else 1_000_000.0
    if not 0 <= v <= top:
        raise ValueError(f"{field} 0 ile {top:,.0f} arasında olmalı.")  # tools.execute modele hata olarak döner
    return v


def set_product_cost(ctx, a: dict) -> dict:
    """İlan ya da seçenek maliyetini kaydeder; verilmeyen alanlar mevcut değerden korunur."""
    given = {f: _number(a, f) for f in _FIELDS}
    if all(v is None for v in given.values()):
        return {"error": "En az bir değer ver: unit_cost, shipping_cost ya da cost_pct."}
    ids = [int(x) for x in (a.get("listing_ids") or [])][:MAX_LISTINGS]
    if not ids:
        return {"error": "listing_ids boş. Ürünü önce product_costs ile bul."}
    variant = str(a.get("variant_key") or "").strip()
    db, shop = ctx.db, ctx.shop

    if variant:
        if len(ids) != 1:
            return {"error": "Seçenek maliyeti tek ilan için girilir (listing_ids'te tek kimlik)."}
        products, _ = _products(ctx)
        keys = {v["key"] for p in products if p["listing_id"] == ids[0] for v in p["variants"]}
        if variant not in keys:
            return {"error": "Bu seçenek anahtarı bulunamadı; product_costs'taki 'anahtar'ı aynen kullan.", "gecerli_anahtarlar": sorted(keys)[:15]}
        row = db.scalar(select(VariantCost).where(VariantCost.shop_id == shop.id, VariantCost.listing_id == ids[0], VariantCost.variant_key == variant))
        merged = {f: given[f] if given[f] is not None else (getattr(row, f) if row else 0.0) for f in _FIELDS}
        fin.set_variant_cost(db, shop, ids[0], variant, merged["unit_cost"], merged["shipping_cost"], merged["cost_pct"])
        saved = [{"listing_id": ids[0], "secenek": variant, **merged}]
    else:
        existing = {c.listing_id: c for c in db.scalars(select(ListingCost).where(ListingCost.shop_id == shop.id, ListingCost.listing_id.in_(ids)))}
        saved = []
        for lid in ids:
            row = existing.get(lid)
            merged = {f: given[f] if given[f] is not None else (getattr(row, f) if row else 0.0) for f in _FIELDS}
            fin.set_cost(db, shop, lid, merged["unit_cost"], merged["shipping_cost"], merged["cost_pct"])
            saved.append({"listing_id": lid, **merged})

    ctx.cards.append({"type": "status", "title": tr("Maliyet kaydedildi", "Cost saved"), "rows": [
        {"label": tr("Ürün", "Products"), "value": len(saved)},
    ]})
    return {
        "kaydedilen": saved,
        "not": "Yerel kayıt, Etsy'ye gitmedi. Maliyet bu ürünlerin GEÇMİŞ dahil tüm siparişlerinin kâr hesabına uygulanır; kullanıcıya söyle. Finans > Ürün kârlılığı'ndan değiştirilebilir.",
    }


_OBJ = lambda props, req=None: {"type": "object", "properties": props, "required": req or []}  # noqa: E731
_COST_PROPS = {
    "unit_cost": {"type": "number", "description": "Adet başına ürün maliyeti (malzeme, üretim)"},
    "shipping_cost": {"type": "number", "description": "Adet başına kargo maliyeti"},
    "cost_pct": {"type": "number", "description": "Satış fiyatının yüzdesi olarak ek maliyet (ör. 5 = %5)"},
}

TOOLS: list[dict] = [
    {
        "name": "product_costs",
        "description": "Ürünlerin girilmiş maliyetleri ve satılmış seçeneklerinin (boyut/renk) anahtarları. listing_id ya da başlık sorgusu (query) ver; ikisi de yoksa maliyeti hiç girilmemiş, en çok satan ürünleri döner. set_product_cost'tan ÖNCE çağır.",
        "input_schema": _OBJ({"listing_id": {"type": "integer"}, "query": {"type": "string"}, "limit": {"type": "integer"}}),
    },
    {
        "name": "set_product_cost",
        "description": "Ürün maliyetini kaydeder (YEREL; Etsy'ye gitmez). Bir ya da birden çok ilana (en fazla 50) aynı maliyet; variant_key verilirse tek ilanın o seçeneğine. Verilmeyen alanlar korunur. Maliyet geçmiş siparişler dahil tüm kâr hesabına uygulanır. Kullanıcı tutarı ve ürünü net söylemediyse önce sor.",
        "input_schema": _OBJ({"listing_ids": {"type": "array", "items": {"type": "integer"}}, "variant_key": {"type": "string"}, **_COST_PROPS}, ["listing_ids"]),
    },
]
EXECUTORS = {"product_costs": product_costs, "set_product_cost": set_product_cost}
LABELS = {"product_costs": "Ürün maliyetlerine bakıyor", "set_product_cost": "Maliyeti kaydediyor"}
LABELS_EN = {"product_costs": "Checking product costs", "set_product_cost": "Saving the cost"}

"""Fiyat önerisi: maliyet + Etsy ücretleri + hedef marjdan satış fiyatı hesaplar.
Ücret oranı mağazanın gerçek siparişlerinden (Etsy ücretleri + reklam / satış, son 365 gün) alınır; yeterli veri yoksa Etsy'nin standart ücretleri kullanılır.
Hesap sunucuda yapılır, model sayı hesaplamaz."""
import datetime as dt

from app.finance import service as fin

# Etsy standart ücretleri (ABD): işlem %6,5 + ödeme işleme %3 + 0,25 sabit; listing ücreti 0,20 (satış başına dağıtılır).
DEFAULT_FEE_RATE = 0.095
FIXED_PER_SALE = 0.25 + 0.20
MIN_SALES_FOR_SHOP_RATE = 500.0  # bu kadar satış tutarı yoksa mağaza oranı güvenilmez sayılır


def _fee_rate(ctx) -> tuple[float, str, str]:
    """(oran, kaynak, para birimi)."""
    today = dt.date.today()
    try:
        r = fin.report(ctx.db, ctx.shop, today - dt.timedelta(days=364), today)
        k = r["kpi"]
        if k["sales"] >= MIN_SALES_FOR_SHOP_RATE and k["fees"] > 0:
            return round(k["fees"] / k["sales"], 4), "mağazanın son 365 gün gerçek ücretleri (Etsy ücretleri + reklam)", r["currency"]
        return DEFAULT_FEE_RATE, "Etsy standart ücretleri (mağazada yeterli satış verisi yok)", r["currency"]
    except Exception:  # noqa: BLE001 - finans verisi okunamazsa standart oran
        return DEFAULT_FEE_RATE, "Etsy standart ücretleri", "USD"


def suggest_price(ctx, a: dict) -> dict:
    try:
        cost = float(a["cost"])
    except (KeyError, TypeError, ValueError):
        return {"error": "Ürün maliyeti (cost) gerekli: bir sayı ver (üretim + ambalaj, mağaza para biriminde)."}
    if cost <= 0:
        return {"error": "Maliyet 0'dan büyük olmalı."}
    shipping = max(float(a.get("shipping_cost_paid_by_seller") or 0), 0.0)
    extra = max(float(a.get("extra_fixed_costs") or 0), 0.0)
    rate, source, currency = _fee_rate(ctx)
    margins = [float(a["target_margin_percent"])] if a.get("target_margin_percent") else [20.0, 30.0, 40.0]
    rows = []
    for m in margins:
        share = rate + m / 100
        if share >= 0.95:
            return {"error": "Hedef marj ve ücret oranı toplamı %95'i aşıyor; daha düşük bir marj seç."}
        price = (cost + shipping + extra + FIXED_PER_SALE) / (1 - share)
        fees = price * rate + FIXED_PER_SALE
        rows.append({"hedef_marj_yuzde": m, "satis_fiyati": round(price, 2), "etsy_ucretleri": round(fees, 2), "net_kar": round(price - cost - shipping - extra - fees, 2)})
    out = {
        "para_birimi": currency, "maliyet": cost, "kargo_satici_oduyor": shipping, "diger_sabit_maliyet": extra,
        "ucret_orani_yuzde": round(rate * 100, 1), "ucret_kaynagi": source, "sabit_ucret_satis_basina": round(FIXED_PER_SALE, 2), "secenekler": rows,
        "formul": "fiyat = (maliyet + kargo + diğer + sabit ücret) / (1 - ücret oranı - hedef marj)",
        "not": "Rakamları aynen aktar, kendin hesaplama. Piyasa fiyatı için market_research'ün fiyat medyanıyla karşılaştır; kargo ücretsizse kargo maliyetini ver.",
    }
    if a.get("current_price"):
        cp = float(a["current_price"])
        fees = cp * rate + FIXED_PER_SALE
        out["mevcut_fiyat_analizi"] = {"fiyat": cp, "net_kar": round(cp - cost - shipping - extra - fees, 2), "marj_yuzde": round((cp - cost - shipping - extra - fees) / cp * 100, 1)}
    return out


TOOLS: list[dict] = [
    {
        "name": "suggest_price",
        "description": "Satış fiyatı önerisi: ürün maliyeti + Etsy ücretleri (mağazanın gerçek ücret oranı) + hedef marjdan hesaplar ('bu ürünü kaça satmalıyım', 'şu fiyatta kârım ne'). cost mağaza para biriminde ürün maliyetidir; hedef marj verilmezse %20/30/40 seçenekleri döner. current_price verilirse o fiyattaki net kâr ve marj da hesaplanır. Rakamları sunucu hesaplar.",
        "input_schema": {"type": "object", "properties": {
            "cost": {"type": "number", "description": "Ürün maliyeti (üretim + ambalaj)"},
            "target_margin_percent": {"type": "number", "description": "Hedef net kâr marjı (satış fiyatının %'si)"},
            "shipping_cost_paid_by_seller": {"type": "number", "description": "Ücretsiz kargoda satıcının ödediği kargo"},
            "extra_fixed_costs": {"type": "number"}, "current_price": {"type": "number"},
        }, "required": ["cost"]},
    },
]
EXECUTORS = {"suggest_price": suggest_price}
LABELS = {"suggest_price": "Fiyatı hesaplıyor"}
LABELS_EN = {"suggest_price": "Calculating the price"}

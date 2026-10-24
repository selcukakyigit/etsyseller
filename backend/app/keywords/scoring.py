"""Anahtar kelime puanlama ve rolleri (saf işlevler; veri toplamayı `service`/`competition`, yerleşimi `app/listing_plan` yapar).

İlke: eldeki GERÇEK veri neyse puan onunla kurulur, olmayan sinyal "sıfır" sayılmaz, hesaptan çıkar ve güven etiketi düşer.
- ölçülü: aylık arama + toplam sonuç sayısı biliniyor (fırsat oranı = arama ÷ sonuç)
- kısmi: yalnızca sonuç sayısı (rekabet), dönüşüm bandı ya da senin gerçek satışın var
- tahmin: yalnızca rakip kullanım sayısı / kelime yapısı (talep bilinmiyor; puan düşük güvenlidir)

Alaka puanın parçası DEĞİLDİR: kelimenin ürüne uyup uymadığına `listing_plan.fit` karar verir (puan yalnızca uyanları sıralar).
Ağırlıklar sezgiseldir, ölçülerek ayarlanır; değiştirmek için yalnızca WEIGHTS."""
import math


WEIGHTS = {"proven": 0.30, "opportunity": 0.30, "competition": 0.15, "usage": 0.05, "conversion": 0.15, "trend": 0.05, "specificity": 0.10, "google_demand": 0.10, "uniqueness": 0.10}
CONVERSION = {"very_low": 0.0, "low": 0.25, "medium": 0.5, "high": 0.75, "very_high": 1.0}
SHRINK = {"measured": 1.0, "partial": 0.8, "estimate": 0.5}  # güven → puana ne kadar güvenilir

# Etiket dağılımı (13): her etiket farklı bir alıcı niyetini karşılasın, hepsi aynı geniş ifadenin varyasyonu olmasın.
ROLE_TARGETS = {"head": 2, "mid": 3, "long": 4, "occasion": 2, "style": 2}
_OCCASION = {
    "gift", "gifts", "birthday", "christmas", "xmas", "halloween", "thanksgiving", "easter", "valentine", "valentines", "mother", "mothers", "father", "fathers",
    "mom", "dad", "grandma", "grandpa", "wife", "husband", "boyfriend", "girlfriend", "friend", "teacher", "wedding", "anniversary", "housewarming", "graduation",
    "retirement", "baby", "shower", "holiday", "him", "her", "men", "women", "kids", "couple", "bridal", "bridesmaid", "groomsmen",
}
_STYLE = {
    "rustic", "vintage", "modern", "farmhouse", "industrial", "minimalist", "boho", "retro", "antique", "geometric", "handmade", "steel", "metal", "wood", "wooden",
    "brass", "copper", "iron", "leather", "ceramic", "glass", "cotton", "silver", "gold", "personalized", "custom", "engraved",
}


def _scale(x: float, lo: float, hi: float) -> float:
    """Logaritmik 0–1 ölçek: lo ve altı 0, hi ve üstü 1."""
    if x <= lo:
        return 0.0
    return min(1.0, (math.log10(x) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)))


def role_of(tag: str, title_words: set[str]) -> str:
    words = tag.lower().split()
    if any(w in _OCCASION for w in words):
        return "occasion"
    if len(words) >= 3:
        return "long"
    if any(w in _STYLE for w in words):
        return "style"
    return "head" if set(words) <= title_words else "mid"


def score(item: dict) -> tuple[float, str]:
    """(0–1 puan, güven: measured | partial | estimate). Olmayan sinyal hesaptan çıkar (ağırlıklar kalan sinyallere yeniden dağılır)."""
    parts: dict[str, float] = {}
    searches, results = item.get("etsy_searches"), item.get("etsy_results")
    if searches and results:
        parts["opportunity"] = _scale(searches / results, 0.001, 0.5)
    elif results:
        parts["competition"] = 1 - _scale(results, 500, 2_000_000)
    elif item.get("source") == "competitor" and item.get("sample_size"):
        parts["usage"] = 1 - 0.5 * min(1.0, item.get("score", 0) / item["sample_size"])  # çok kullanılan = doygunluk işareti, hafif düşürür
    units, orders = item.get("units") or 0, item.get("etsy_orders") or 0
    if units or orders:
        parts["proven"] = max(_scale(units + 1, 1, 30), _scale(orders + 1, 1, 10))
    if item.get("etsy_conversion") in CONVERSION:
        parts["conversion"] = CONVERSION[item["etsy_conversion"]]
    if item.get("etsy_trend_pct") is not None:
        parts["trend"] = max(0.0, min(1.0, 0.5 + item["etsy_trend_pct"] / 100))
    n = len(item["tag"].split())
    parts["specificity"] = {1: 0.2, 2: 0.5, 3: 0.9, 4: 1.0}.get(n, 0.8)
    if item.get("google_volume"):  # Google aylık arama (araştırma havuzu): Etsy hacmi DEĞİL, talebin yardımcı göstergesi
        parts["google_demand"] = _scale(item["google_volume"], 10, 100_000)
    if item.get("crowd") is not None:  # 0–1 kalabalık (çok mağazaya önerilmiş ifade): herkes aynı kelimeyle yarışmasın; yoksa hesaba girmez
        parts["uniqueness"] = 1 - item["crowd"]
    total = sum(WEIGHTS[k] for k in parts)
    value = sum(WEIGHTS[k] * v for k, v in parts.items()) / total
    confidence = "measured" if "opportunity" in parts else "partial" if parts.keys() & {"competition", "proven", "conversion", "google_demand"} else "estimate"
    # Az sinyalli kelime yalnızca kelime yapısından yüksek çıkmasın: güvene göre nötr puana (0.5) çekilir.
    trust = SHRINK[confidence]
    return round(value * trust + 0.5 * (1 - trust), 3), confidence


def rank(pool: list[dict], title: str = "") -> list[dict]:
    """Havuzdaki her kelimeye `rank_score`, `confidence`, `role` ekler ve puana göre sıralı YENİ liste döner (havuz değişmez)."""
    title_words = {w for w in title.lower().split()}
    out = []
    for p in pool:
        s, conf = score(p)
        out.append({**p, "rank_score": s, "confidence": conf, "role": role_of(p["tag"], title_words)})
    out.sort(key=lambda p: (-p["rank_score"], p["tag"]))
    return out

"""Anahtar kelime puanlama ve rol dağıtımı (saf işlevler; veri toplamayı `service`/`competition` yapar).

İlke: eldeki GERÇEK veri neyse puan onunla kurulur, olmayan sinyal "sıfır" sayılmaz, hesaptan çıkar ve güven etiketi düşer.
- ölçülü: aylık arama + toplam sonuç sayısı biliniyor (fırsat oranı = arama ÷ sonuç)
- kısmi: yalnızca sonuç sayısı (rekabet), dönüşüm bandı ya da senin gerçek satışın var
- tahmin: yalnızca rakip kullanım sayısı / kelime yapısı (talep bilinmiyor; puan düşük güvenlidir)

Alaka puanın parçası DEĞİLDİR: kelimenin ürüne uyup uymadığına model karar verir (puan yalnızca uyanları sıralar).
Ağırlıklar sezgiseldir, ölçülerek ayarlanır; değiştirmek için yalnızca WEIGHTS."""
import math

from app.ai import standard
from app.core.i18n import tr
from app.research import bands

_BAND_TR = {"low": "düşük", "medium": "orta", "high": "yüksek"}

WEIGHTS = {"proven": 0.30, "opportunity": 0.30, "competition": 0.15, "usage": 0.05, "conversion": 0.15, "trend": 0.05, "specificity": 0.10, "google_demand": 0.10, "uniqueness": 0.10}
CONVERSION = {"very_low": 0.0, "low": 0.25, "medium": 0.5, "high": 0.75, "very_high": 1.0}
SHRINK = {"measured": 1.0, "partial": 0.8, "estimate": 0.5}  # güven → puana ne kadar güvenilir
SATURATED_RESULTS = 500_000  # bu kadar sonuç + kanıt yok = doymuş geniş arama

# Etiket dağılımı (13): her etiket farklı bir alıcı niyetini karşılasın, hepsi aynı geniş ifadenin varyasyonu olmasın.
ROLE_TARGETS = {"head": 2, "mid": 3, "long": 4, "occasion": 2, "style": 2}
ROLE_TR = {"head": "ana ürün ifadesi", "mid": "orta kapsam", "long": "uzun kuyruk", "occasion": "vesile/alıcı", "style": "stil/malzeme"}
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


def allocate(ranked: list[dict], count: int = standard.TAG_COUNT, max_len: int = standard.TAG_MAX_LEN) -> dict[str, list[dict]]:
    """Rol hedeflerine göre dağıtım. Önce verisi olan (ölçülü/kısmi) adaylar rollere yerleşir; "tahmin" adaylar yalnızca kalan boşluğu doldurur
    (yalnızca kelime yapısına dayanan ifade, ölçülü bir ifadenin önüne geçmesin). Etiket sınırını aşanlar atlanır."""
    fits = [p for p in ranked if len(p["tag"]) <= max_len]
    chosen: dict[str, list[dict]] = {r: [] for r in ROLE_TARGETS}
    used: set[str] = set()

    def take(candidates: list[dict], per_role_limit: bool) -> None:
        for p in candidates:
            if sum(map(len, chosen.values())) >= count:
                return
            if p["tag"] in used or (per_role_limit and len(chosen[p["role"]]) >= ROLE_TARGETS[p["role"]]):
                continue
            chosen[p["role"]].append(p)
            used.add(p["tag"])

    data = [p for p in fits if p["confidence"] != "estimate"]
    take(data, True)
    take([p for p in fits if p["confidence"] == "estimate"], True)
    take(fits, False)
    return chosen


def _data_note(p: dict) -> str:
    bits = []
    if p.get("etsy_searches"):
        bits.append(tr(f"aylık {p['etsy_searches']} arama", f"{p['etsy_searches']} searches/month"))
        if p.get("etsy_trend_pct") is not None:
            bits[-1] += f" ({p['etsy_trend_pct']:+d}%)"
    band = bands.demand_band(p.get("google_volume"))
    if band:  # ham sayı değil bant (yalnızca yönetim ham sayıyı görür); Etsy hacmi değil: modelin karıştırmaması için kaynağı açıkça yazılır
        bits.append(tr(f"Google'da talep: {_BAND_TR[band]} (Etsy hacmi değil)", f"Google demand: {band} (not Etsy volume)"))
    if p.get("google_pending"):
        bits.append(tr("Google verisi hazırlanıyor (talep henüz bilinmiyor)", "Google data is being prepared (demand not known yet)"))
    if p.get("crowd", 0) >= 0.15:
        bits.append(tr("son günlerde birçok mağazaya önerildi (kalabalık)", "recently suggested to many shops (crowded)"))
    if p.get("etsy_results"):
        bits.append(tr(f"{p['etsy_results']} sonuç", f"{p['etsy_results']} results"))
    if p.get("etsy_conversion"):
        bits.append(tr(f"dönüşüm {p['etsy_conversion']}", f"conversion {p['etsy_conversion']}"))
    if p.get("units"):
        bits.append(tr(f"senin benzer listing'lerinde {p['units']} satış", f"{p['units']} sales on your similar listings"))
    if p.get("etsy_orders"):
        bits.append(tr(f"bu listing'e {p['etsy_orders']} siparişle gelmiş", f"brought {p['etsy_orders']} orders to this listing"))
    if not bits and p["source"] == "competitor" and p.get("sample_size"):
        bits.append(tr(f"ilk {p['sample_size']} rakipten {p['score']}'inde", f"in {p['score']} of the top {p['sample_size']} competitors"))
    return ", ".join(bits)


_CONF = {"measured": ("ölçülü", "measured"), "partial": ("kısmi", "partial"), "estimate": ("tahmin", "estimate")}


def brief(pool: list[dict], title: str = "", limit: int = 30) -> str:
    """Modele giden kısa, sıralı liste: roller ve veri durumu ile. Ham havuz yerine bu verilir (daha az token, daha iyi sıralama)."""
    ranked = rank(pool, title)
    chosen = allocate(ranked)
    lines = []
    shown = 0
    for role in ROLE_TARGETS:
        rows = chosen[role]
        if not rows:
            continue
        lines.append(f"[{tr(ROLE_TR[role], role)}]")
        for p in rows:
            conf = tr(*_CONF[p["confidence"]])
            lines.append(f'- "{p["tag"]}" [{tr("veri", "data")}: {conf}; {_data_note(p) or tr("yalnızca kelime yapısı", "word structure only")}]')
            shown += 1
    rest = [p for p in ranked if all(p["tag"] != c["tag"] for rows in chosen.values() for c in rows)][: max(0, limit - shown)]
    if rest:
        lines.append(f"[{tr('diğer adaylar', 'other candidates')}]")
        lines += [f'- "{p["tag"]}" [{tr(*_CONF[p["confidence"]])}; {_data_note(p) or "-"}]' for p in rest]
    return "\n".join(lines)


def coverage_feedback(tags: list[str], pool: list[dict], title: str = "") -> str | None:
    """Yazılan etiketlerin havuza göre sorunu varsa tek geri bildirim metni (yoksa None). İki durum: kanıtsız doymuş geniş arama
    kullanılmış; ya da ölçülü/kısmi veriyle belirgin biçimde daha iyi adaylar hiç kullanılmamış."""
    ranked = rank(pool, title)
    by_tag = {p["tag"]: p for p in ranked}
    mine = [by_tag[t.lower()] for t in tags if t.lower() in by_tag]
    saturated = [p["tag"] for p in mine if (p.get("etsy_results") or 0) >= SATURATED_RESULTS and not p.get("units") and not p.get("etsy_orders")]
    strong = [p for p in ranked if p["confidence"] != "estimate" and p["rank_score"] >= 0.6 and p["tag"] not in {t.lower() for t in tags} and len(p["tag"]) <= standard.TAG_MAX_LEN]
    unused_strong = strong[:5] if len(strong) >= 3 and not any(p["rank_score"] >= 0.6 for p in mine) else []
    if not saturated and not unused_strong:
        return None
    out = []
    if saturated:
        out.append(tr(
            f"Bu etiketler çok geniş ve doymuş aramalar (yüz binlerce sonuç, kanıtlanmış satış yok): {', '.join(saturated[:4])}; en fazla birini tut, yerine ürüne özgü uzun kuyruklular yaz.",
            f"These tags are broad, saturated searches (hundreds of thousands of results, no proven sales): {', '.join(saturated[:4])}; keep at most one and use product-specific long-tail phrases instead.",
        ))
    if unused_strong:
        out.append(tr(
            "Ölçülü veriye göre daha güçlü adaylar var; ürüne uyuyorsa kullan: " + ", ".join(f'"{p["tag"]}"' for p in unused_strong) + ".",
            "Measured data shows stronger candidates; use them if they fit the product: " + ", ".join(f'"{p["tag"]}"' for p in unused_strong) + ".",
        ))
    return " ".join(out)

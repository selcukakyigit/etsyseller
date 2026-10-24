"""Etsy panelinden kopyalanan metnin kural tabanlı okunması: Marketplace Insights ve Etsy Ads.

Bu iki tablonun biçimi sabittir (sayfadan kopyalanınca her hücre ayrı satıra düşer), bu yüzden yapay zekâya gerek yoktur: tür başlıklardan
belli olur, satırlar sütun sırasından okunur. Daha ucuz, hızlı ve her seferinde aynı sonucu verir; yapay zekâ yalnızca bu kalıba uymayan
metinde (ör. listing istatistikleri, farklı dil) ve ekran görüntüsünde devreye girer (`etsy_data.parse`)."""
import datetime as dt
import re

_NUM = r"\d[\d,]*(?:\.\d+)?[kKmM]?"
NUM = re.compile(rf"^{_NUM}$")
TREND = re.compile(r"^([↑↓⬆⬇▲▼])?\s*([+\-−–])?\s*(\d+(?:\.\d+)?)\s*%$")
TREND_GLUED = re.compile(rf"^({_NUM})\s+([↑↓⬆⬇▲▼]?\s*[+\-−–]?\s*\d+(?:\.\d+)?\s*%)$")
ARROWS = re.compile(r"^[↑↓⬆⬇▲▼]$")
BANDS = {"very_low", "low", "medium", "high", "very_high"}
AD_VALUE = re.compile(r"^[$€£]?\d[\d,]*(?:\.\d+)?%?$")
RELEVANT = re.compile(r"^(?:ir)?relevant keyword$", re.I)
LAST_DAYS = re.compile(r"last (\d{1,3}) days", re.I)
ADS_VALUES = 7  # ROAS, orders, spend, revenue, clicks, click rate, views


def _tokens(text: str) -> list[str]:
    """Her hücre bir parça: satır ve sekmelerden bölünür, boşluklar temizlenir; "1.3k ↓ -43.6%" gibi yapışık değer + değişim ayrılır."""
    out: list[str] = []
    arrow = ""
    for piece in re.split(r"[\r\n\t]+", text.replace(" ", " ").replace("​", "")):
        piece = piece.strip()
        if not piece:
            continue
        if ARROWS.match(piece):  # ok işareti ayrı satıra düşebilir: değişim değerine eklenir
            arrow = piece
            continue
        piece, arrow = arrow + piece, ""
        glued = TREND_GLUED.match(piece)
        out.extend(glued.groups() if glued else [piece])
    return out


def _count(tok: str) -> int:
    """"18,700" -> 18700, "1.3k" -> 1300, "1.8M" -> 1800000."""
    mult = {"k": 1_000, "m": 1_000_000}.get(tok[-1].lower(), 1)
    return round(float(tok.rstrip("kKmM").replace(",", "")) * mult)


def _trend(tok: str) -> int | None:
    m = TREND.match(tok)
    if not m:
        return None
    arrow, sign, num = m.groups()
    value = float(num)
    negative = sign in ("-", "−", "–") or (arrow in ("↓", "⬇", "▼") and not sign)
    return round(-value if negative else value)


def _band(tok: str) -> str | None:
    band = tok.strip().lower().replace(" ", "_").replace("-", "_")
    return band if band in BANDS else None


def _is_term(tok: str) -> bool:
    return len(tok) >= 2 and not NUM.match(tok) and not TREND.match(tok) and _band(tok) is None and re.search(r"[^\W\d_]", tok) is not None


def detect(text: str) -> str | None:
    """"ads", "marketplace_insights" ya da bilinmiyorsa None."""
    low = text.lower()
    if any(RELEVANT.match(t) for t in _tokens(text)) or ("targeted keyword" in low and "roas" in low):
        return "ads"
    toks = {t.lower() for t in _tokens(text)}
    if "search results" in toks and "searches" in toks:
        return "marketplace_insights"
    return None


def _insights(toks: list[str]) -> list[dict]:
    """Satır: terim, arama sayısı, (değişim %), sonuç sayısı, (dönüşüm bandı). Üstteki "Your search" satırı da aynı biçimde gelir."""
    rows: list[dict] = []
    i, n = 0, len(toks)
    while i < n:
        if not (_is_term(toks[i]) and i + 1 < n and NUM.match(toks[i + 1])):
            i += 1
            continue
        j = i + 2
        trend = None
        if j < n and TREND.match(toks[j]):
            trend = _trend(toks[j])
            j += 1
        if not (j < n and NUM.match(toks[j])):
            i += 1
            continue
        results = _count(toks[j])
        j += 1
        conversion = None
        if j < n and _band(toks[j]):
            conversion = _band(toks[j])
            j += 1
        rows.append({"keyword": toks[i], "searches": _count(toks[i + 1]), "trend_pct": trend, "listings_count": results, "conversion": conversion})
        i = j
    return rows


def _num(tok: str) -> int:
    return round(float(tok.lstrip("$€£").rstrip("%").replace(",", "")))


def _ads(toks: list[str]) -> list[dict]:
    """Her satır "Relevant keyword" etiketiyle başlar: terim, sonra 7 değer (ROAS, sipariş, harcama, gelir, tıklama, tıklama oranı, görüntülenme)."""
    rows: list[dict] = []
    for i, tok in enumerate(toks):
        if not RELEVANT.match(tok) or i + 1 >= len(toks):
            continue
        term, vals = toks[i + 1], toks[i + 2 : i + 2 + ADS_VALUES]
        if AD_VALUE.match(term) or RELEVANT.match(term) or len(vals) < ADS_VALUES or not all(AD_VALUE.match(v) for v in vals):
            continue
        rows.append({"keyword": term, "orders": _num(vals[1]), "clicks": _num(vals[4]), "views": _num(vals[6])})
    return rows


def parse_text(text: str, today: dt.date | None = None) -> dict | None:
    """{source, period_start, period_end, rows} ya da kalıba uymuyorsa None (o zaman yapay zekâ okur)."""
    kind = detect(text)
    if kind is None:
        return None
    toks = _tokens(text)
    rows = _ads(toks) if kind == "ads" else _insights(toks)
    if not rows:
        return None
    start = end = None
    days = LAST_DAYS.search(text)
    if kind == "ads" and days:
        end = today or dt.date.today()
        start = end - dt.timedelta(days=int(days.group(1)) - 1)
    return {"source": kind, "period_start": start.isoformat() if start else None, "period_end": end.isoformat() if end else None, "rows": rows}


def coerce_source(raw: dict) -> str:
    """Yapay zekânın seçtiği türü satırların biçimiyle doğrular: yalnızca arama/sonuç/dönüşüm dolu satırlar Marketplace Insights,
    tıklama ya da sipariş dolu satırlar Ads'tir. Tür tahmini yanlış çıksa da veri yanlış gruba (ve rozet dışına) düşmez."""
    rows = raw.get("rows") or []

    def has(fields: tuple[str, ...]) -> bool:
        return any(r.get(f) not in (None, "") for r in rows for f in fields)

    if has(("searches", "listings_count", "conversion", "competition")) and not has(("views", "clicks", "orders")):
        return "marketplace_insights"
    if has(("clicks", "orders")):
        return "ads"
    return raw.get("source") if raw.get("source") in ("marketplace_insights", "search_terms", "ads") else "marketplace_insights"

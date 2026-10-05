"""Etsy panelinden yapıştırılan arama verisi: Marketplace Insights, listing'i getiren arama terimleri, Etsy Ads.

Etsy bu verileri API'de vermez; kullanıcı tabloyu kopyalayıp yapıştırır ya da ekran görüntüsünü bırakır. Yapay zekâ
tabloyu satırlara ayırır (`parse`, KAYDETMEZ); kullanıcı kontrol edip kaydeder (`save`). Kaydedilen veri kelime havuzunda
rozet olur, listing'i gerçekten getiren aramalar sıra takibine eklenir ve AI önerisi bu kelimelere öncelik verir."""
import base64
import datetime as dt
import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.images import for_llm
from app.core.i18n import tr
from app.insights.models import EtsyKeywordData, TrackedKeyword
from app.shops.models import Shop

SOURCES = ("marketplace_insights", "search_terms", "ads")
MAX_ROWS = 60
MAX_TEXT = 15000
NUM_FIELDS = ("searches", "listings_count", "views", "clicks", "orders")

PROMPT = """The user copied a table from their Etsy seller dashboard (text or screenshot). Identify which one it is:
- "marketplace_insights": Etsy Marketplace Insights / keyword research (search term, searches, change %, search results, conversion rate; older versions show competition)
- "search_terms": listing or shop stats "search terms" / how shoppers found you (search term, visits or views)
- "ads": Etsy Ads search queries report (search query, views/impressions, clicks, orders, spend, revenue)
Extract every row, including the user's own search at the top and every "similar search term". Text copied from a page puts
each value on its own line in column order (e.g. term, searches, optional change %, search results, conversion rate).
Convert numbers like "17.6k" to 17600, "1.8M" to 1800000 and "1,234" to 1234.
- searches: the "Searches" number. trend_pct: the change shown next to it ("-12.8%" -> -13), only if shown for that row.
- listings_count: the "Search results" number (how many listings compete).
- conversion: the "Conversion rate" band as "very_low", "low", "medium", "high" or "very_high".
- competition: only when an older table shows "low", "medium" or "high" competition.
Today is {today}. If the page says "Last 30 days" (or another "last N days"), set period_end to today and period_start to N-1 days
before; if an explicit date range is visible, use it.
Return ONLY JSON:
{"source": "marketplace_insights|search_terms|ads", "period_start": "YYYY-MM-DD"|null, "period_end": "YYYY-MM-DD"|null,
 "rows": [{"keyword": "...", "searches": int|null, "trend_pct": int|null, "listings_count": int|null, "conversion": "very_low|low|medium|high|very_high"|null,
           "competition": "low|medium|high"|null, "views": int|null, "clicks": int|null, "orders": int|null}]}"""
CONVERSIONS = ("very_low", "low", "medium", "high", "very_high")


class EtsyDataError(ValueError):
    pass


def _ai(content_text: str | None, image: tuple[bytes, str] | None) -> dict:
    from app.ai.client import get_anthropic_client, get_openai_client
    from app.ai.vision import VisionError, text_model
    from app.billing import metering

    try:
        model = text_model("document")
    except VisionError as exc:
        raise EtsyDataError(str(exc)) from exc
    prompt = PROMPT.replace("{today}", dt.date.today().isoformat()) + (f"\n\nTable text:\n{content_text[:MAX_TEXT]}" if content_text else "")
    try:
        if model.provider == "anthropic":
            parts: list[dict] = []
            if image:
                data, ctype = for_llm(*image)
                parts.append({"type": "image", "source": {"type": "base64", "media_type": ctype, "data": base64.b64encode(data).decode()}})
            parts.append({"type": "text", "text": prompt})
            resp = get_anthropic_client().messages.create(model=model.model_id, max_tokens=4000, messages=[{"role": "user", "content": parts}])
            raw = "".join(b.text for b in resp.content if b.type == "text")
        else:
            parts = [{"type": "text", "text": prompt}]
            if image:
                data, ctype = for_llm(*image)
                parts.append({"type": "image_url", "image_url": {"url": f"data:{ctype};base64,{base64.b64encode(data).decode()}"}})
            resp = get_openai_client().chat.completions.create(model=model.model_id, messages=[{"role": "user", "content": parts}], max_tokens=4000)
            raw = resp.choices[0].message.content or ""
        metering.record_response("document", model, resp)
    except Exception as exc:  # noqa: BLE001
        raise EtsyDataError(tr(f"Yapay zekâ veriyi okuyamadı: {str(exc)[:200]}", f"The AI could not read the data: {str(exc)[:200]}")) from exc
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    try:
        return json.loads(m.group(0) if m else raw)
    except (json.JSONDecodeError, AttributeError) as exc:
        raise EtsyDataError(tr("Yapay zekâ okunabilir bir tablo döndürmedi, tekrar dene.", "The AI did not return a readable table; try again.")) from exc


def _int(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(str(v).replace(",", "")))
    except ValueError:
        return None


def _date(v) -> str | None:
    try:
        return dt.date.fromisoformat(str(v)).isoformat() if v else None
    except ValueError:
        return None


def _extras(r: dict) -> dict:
    """Marketplace Insights'ın sayı olmayan alanları, doğrulanmış biçimde."""
    comp = str(r.get("competition") or "").lower()
    conv = str(r.get("conversion") or "").lower().replace(" ", "_").replace("-", "_")
    trend = _int(r.get("trend_pct"))
    return {
        "competition": comp if comp in ("low", "medium", "high") else None,
        "conversion": conv if conv in CONVERSIONS else None,
        "trend_pct": trend if trend is not None and -100 <= trend <= 1000 else None,
    }


def parse(text: str | None = None, image: tuple[bytes, str] | None = None) -> dict:
    """Yapıştırılan tabloyu okur; KAYDETMEZ. Döner: {source, period_start, period_end, rows}."""
    if not (text and text.strip()) and not image:
        raise EtsyDataError(tr("Yapıştırılacak bir tablo ya da ekran görüntüsü yok.", "There is no table or screenshot to read."))
    raw = _ai(text.strip() if text else None, image)
    source = raw.get("source") if raw.get("source") in SOURCES else "marketplace_insights"
    rows = []
    seen: set[str] = set()
    for r in raw.get("rows") or []:
        kw = re.sub(r"\s+", " ", str(r.get("keyword") or "").strip().lower())[:100]
        if len(kw) < 2 or kw in seen:
            continue
        seen.add(kw)
        rows.append({"keyword": kw, **_extras(r), **{f: _int(r.get(f)) for f in NUM_FIELDS}})
        if len(rows) >= MAX_ROWS:
            break
    if not rows:
        raise EtsyDataError(tr("Tabloda okunabilir bir satır bulunamadı.", "No readable rows were found in the table."))
    return {"source": source, "period_start": _date(raw.get("period_start")), "period_end": _date(raw.get("period_end")), "rows": rows}


def save(db: Session, shop: Shop, listing_id: int | None, source: str, rows: list[dict], period_start: str | None = None, period_end: str | None = None) -> dict:
    """Onaylanan satırları kaydeder. Listing'e ait arama terimleri / reklam verisinde listing'i en çok getiren aramalar
    (sıra takibinde yer varsa) takibe eklenir."""
    from app.insights import rank

    if source not in SOURCES:
        raise EtsyDataError(tr("Geçersiz veri türü.", "Invalid data type."))
    ps, pe = _date(period_start), _date(period_end)
    saved = 0
    for r in rows[:MAX_ROWS]:
        kw = re.sub(r"\s+", " ", str(r.get("keyword") or "").strip().lower())[:100]
        if len(kw) < 2:
            continue
        db.add(EtsyKeywordData(
            shop_id=shop.id, listing_id=listing_id, keyword=kw, source=source, **_extras(r),
            period_start=dt.date.fromisoformat(ps) if ps else None, period_end=dt.date.fromisoformat(pe) if pe else None,
            **{f: _int(r.get(f)) for f in NUM_FIELDS},
        ))
        saved += 1
    db.commit()

    tracked: list[str] = []
    if listing_id and source in ("search_terms", "ads"):
        def weight(r: dict) -> int:
            return (_int(r.get("orders")) or 0) * 100 + (_int(r.get("clicks")) or 0) * 5 + (_int(r.get("views")) or 0)

        for r in sorted(rows, key=weight, reverse=True)[:2]:
            if weight(r) <= 0:
                continue
            try:
                rank.add_keyword(db, shop, listing_id, str(r["keyword"]), source="etsy_data")
                tracked.append(str(r["keyword"]).lower())
            except rank.RankError:
                break
    return {"saved": saved, "tracked": tracked}


def _out(r: EtsyKeywordData) -> dict:
    return {
        "id": r.id, "listing_id": r.listing_id, "keyword": r.keyword, "source": r.source, "searches": r.searches,
        "competition": r.competition, "conversion": r.conversion, "trend_pct": r.trend_pct, "listings_count": r.listings_count, "views": r.views, "clicks": r.clicks, "orders": r.orders,
        "period_start": r.period_start.isoformat() if r.period_start else None, "period_end": r.period_end.isoformat() if r.period_end else None,
        "captured_on": r.captured_on.isoformat(),
    }


def _latest(rows: list[EtsyKeywordData]) -> list[EtsyKeywordData]:
    """Kelime + kaynak başına en yeni kayıt."""
    best: dict[tuple[str, str], EtsyKeywordData] = {}
    for r in rows:
        k = (r.keyword, r.source)
        if k not in best or (r.captured_on, r.id) > (best[k].captured_on, best[k].id):
            best[k] = r
    return list(best.values())


def for_listing(db: Session, shop: Shop, listing_id: int) -> list[dict]:
    """Listing'e ait veri + listing'in etiketleri/takip edilen aramalarıyla eşleşen mağaza geneli kelime araştırması."""
    from app.listings.models import ListingCache

    row = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id, ListingCache.listing_id == listing_id)).one_or_none()
    terms = {t.lower() for t in (json.loads(row.raw_json).get("tags") or [])} if row else set()
    terms |= {k for (k,) in db.execute(select(TrackedKeyword.keyword).where(TrackedKeyword.shop_id == shop.id, TrackedKeyword.listing_id == listing_id))}
    rows = db.scalars(select(EtsyKeywordData).where(EtsyKeywordData.shop_id == shop.id).where(
        (EtsyKeywordData.listing_id == listing_id) | ((EtsyKeywordData.listing_id.is_(None)) & (EtsyKeywordData.keyword.in_(terms or {""})))
    )).all()
    latest = _latest(list(rows))
    latest.sort(key=lambda r: (r.source, -(r.orders or 0), -(r.clicks or 0), -(r.searches or 0), -(r.views or 0)))
    return [_out(r) for r in latest]


def keyword_index(db: Session, shop: Shop, keywords: set[str]) -> dict[str, dict]:
    """Kelime havuzu için: kelime -> en yeni Marketplace Insights verisi (arama, dönüşüm, değişim, rekabet)."""
    if not keywords:
        return {}
    rows = db.scalars(select(EtsyKeywordData).where(
        EtsyKeywordData.shop_id == shop.id, EtsyKeywordData.source == "marketplace_insights", EtsyKeywordData.keyword.in_(keywords)
    )).all()
    return {r.keyword: _index_out(r) for r in _latest(list(rows))}


def _index_out(r: EtsyKeywordData) -> dict:
    return {"searches": r.searches, "competition": r.competition, "conversion": r.conversion, "trend_pct": r.trend_pct,
            "listings_count": r.listings_count, "captured_on": r.captured_on.isoformat()}


def related_research(db: Session, shop: Shop, text_words: set[str], exclude: set[str], limit: int = 8) -> list[dict]:
    """Mağazanın kelime araştırmasından (Marketplace Insights, son 120 gün) bu listing'le ilgili olanlar: aramanın
    anlamlı kelimelerinin hepsi listing'in başlık/etiket/malzemelerinde geçiyor (tek eksik kelime bile çoğu zaman başka bir
    ürün türüdür: "metal address sign" ≠ garaj tabelası). Aylık aramaya göre sıralı. Havuzda olmayan fırsat kelimeleri AI
    önerisine böyle ulaşır."""
    since = dt.date.today() - dt.timedelta(days=120)
    rows = db.scalars(select(EtsyKeywordData).where(
        EtsyKeywordData.shop_id == shop.id, EtsyKeywordData.source == "marketplace_insights", EtsyKeywordData.captured_on >= since,
    )).all()
    out = []
    for r in _latest(list(rows)):
        if r.keyword in exclude or not r.searches:
            continue
        tokens = {w for w in re.findall(r"[^\W_]+(?:'[^\W_]+)?", r.keyword) if len(w) > 2}
        if tokens and tokens <= text_words:
            out.append({"keyword": r.keyword, **_index_out(r)})
    out.sort(key=lambda x: -(x["searches"] or 0))
    return out[:limit]


def delete(db: Session, shop: Shop, ids: list[int]) -> int:
    rows = db.scalars(select(EtsyKeywordData).where(EtsyKeywordData.shop_id == shop.id, EtsyKeywordData.id.in_(ids))).all()
    for r in rows:
        db.delete(r)
    db.commit()
    return len(rows)


def to_check(db: Session, shop: Shop, limit: int = 15, today: dt.date | None = None) -> list[dict]:
    """"Bu hafta Marketplace Insights'ta bak" listesi: takip edilen aramalardan son 30 günde verisi girilmemiş olanlar.
    Önce düşüşteki listing'lerin aramaları (sıra takibine otomatik seçilenler zaten düşenler ve en çok satanlardır)."""
    from app.listings.models import ListingCache

    today = today or dt.date.today()
    fresh = {k for (k,) in db.execute(select(EtsyKeywordData.keyword).where(
        EtsyKeywordData.shop_id == shop.id, EtsyKeywordData.source == "marketplace_insights", EtsyKeywordData.captured_on >= today - dt.timedelta(days=30)
    ))}
    tracked = db.scalars(select(TrackedKeyword).where(TrackedKeyword.shop_id == shop.id, TrackedKeyword.active.is_(True)).order_by(TrackedKeyword.created_at)).all()
    titles = {lid: t for lid, t in db.execute(select(ListingCache.listing_id, ListingCache.title).where(
        ListingCache.shop_id == shop.id, ListingCache.listing_id.in_({k.listing_id for k in tracked} or {0})
    ))}
    out, seen = [], set()
    for k in tracked:
        if k.keyword in fresh or k.keyword in seen:
            continue
        seen.add(k.keyword)
        out.append({"keyword": k.keyword, "listing_id": k.listing_id, "listing_title": (titles.get(k.listing_id) or "")[:80]})
        if len(out) >= limit:
            break
    return out

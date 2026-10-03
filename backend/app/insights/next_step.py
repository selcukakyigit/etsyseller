"""Sıradaki adım: her listing için TEK, somut öneri ("kapak fotoğrafını değiştir", "fiyatı dene", "dokunma, ölçülüyor"…).

Teşhisin (satış eğrisi, sebep oyları, mevsim), huni sağlığının (listings/health.py: mağaza ortancasına göre zayıf aşama),
son değişikliğin ölçülen sonucunun (insights/impact.py), daha önce denenip işe yaramamış aşamaların, rakip fiyatlarının
ve sıra takibinin ortak kararıdır; böylece "önerilen hamle" ile huni notu birbiriyle çelişmez.

Kural sırası (ilk eşleşen kazanır):
  1. Son değişiklik ölçülüyor (MIN_WINDOW günden yeni)            → bekle
  2. Son değişiklik kötüleşti (kesin ya da güvenle)                  → geri al
  3. Son değişiklik 30 günü doldurmadı                               → bekle (ön sonuç)
  4. Huni 3 denemeye rağmen zayıf                                    → durdurmayı değerlendir
  5. Satış zirvesindeyiz ve düşüş yok                                → dokunma
  6. Zayıf aşama: düşüş mağaza geneli/talepse o; değilse huni darboğazı (günlük kayıt yetersizse ömür boyu sayılarla kaba
     huni karşılaştırması), o da yoksa teşhis sebebi; hiçbir kıyas yapılamıyorsa bunu söyler (asla "sorun yok" uydurmaz)
     → aşamanın hamlesi; aynı hamle yakın zamanda denenip etki etmediyse aşamanın sıradaki hamlesi
  7. Zayıf aşama yok                                                 → dokunma (son değişiklik işe yaradıysa "koru")

Bir seferde tek hamle önerilir: 30 gün sonra neyin işe yaradığı ancak böyle anlaşılır. İstisna: eskiden satıp sönmüş
listing (satış neredeyse sıfır, korunacak bir şey yok, turlar çok yavaş kalır) için "kapsamlı yenile" tek turda başlık,
etiket, açıklama ve kapak fotoğrafını birlikte yeniler; ölçüm yenilemenin bütün olarak işe yarayıp yaramadığını söyler.
Kapsamlı yenileme denenip işe yaramadıysa tekrar önerilmez, adım adım akışa dönülür."""
import datetime as dt
import html
import json
import statistics

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.fingerprint import ResultCache
from app.core.i18n import tr
from app.insights import impact
from app.insights.models import RankSnapshot, TrackedKeyword
from app.listings.models import ListingCache, ListingChange, ListingHealth

WEAK_RATIO = 0.5  # mağaza ortancasının bu oranının altı "zayıf" (listings/health.py ile aynı)
ABS_MIN_VPD = 1.0  # günde 1 görüntülenmenin altı mağaza ortalaması ne olursa olsun az görünmektir (mağazanın tamamı zayıfsa
#                    "ortancaya yakın" yanlış bir teselli olurdu); mağaza ortancasından iyiyse uygulanmaz
MIN_LIFETIME_AGE = 30  # ömür boyu kıyasa girecek listing en az bu kadar günlük olmalı
MIN_LIFETIME_SAMPLE = 5  # ...ve mağazada en az bu kadar kıyaslanabilir listing olmalı
FADED_PEAK = 6  # bir takvim yılında en az bu kadar satmış ve…
FADED_RATIO = 0.25  # …son 12 ayda o yılın bu oranına bile ulaşamamışsa listing "sönmüş" sayılır
OVERHAUL_MAX_UNITS = 3  # kapsamlı yenileme yalnızca son 12 ayda en fazla bu kadar satan (korunacak satışı olmayan) listing'e
PRICE_HIGH = 1.3  # kendi fiyatın ilk 20 rakibin ortancasının bu katından fazlaysa fiyat hamlesi adaydır
TRIED_DAYS = 150  # bu kadar gün içinde denenip etki etmeyen hamle tekrar önerilmez

# Değişen alan → hamlenin hedeflediği aşama
_FIELD_STAGE = {
    "title": "visibility", "tags": "visibility", "text": "visibility", "category": "visibility", "properties": "visibility",
    "images": "appeal", "videos": "appeal",
    "price": "conversion", "description": "conversion", "inventory": "conversion", "personalization": "conversion",
}
# Değişen alan → hamle
_FIELD_MOVE = {
    "title": "title_tags", "tags": "title_tags", "text": "title_tags", "category": "title_tags", "properties": "title_tags",
    "images": "photo", "videos": "photo", "price": "price", "description": "description", "inventory": "description",
}
# Aşama → denenecek hamleler (sırayla; "price" yalnızca fiyat rakiplerden belirgin yüksekse aday)
_STAGE_MOVES = {
    "visibility": ["title_tags", "photo", "price"],
    "appeal": ["photo", "title_tags", "price"],
    "conversion": ["price", "description", "photo"],
}
_CAUSE_STAGE = {"visibility": "visibility", "appeal": "appeal", "conversion": "conversion"}
_BOTTLENECK_STAGE = {"seo": "visibility", "appeal": "appeal", "conversion": "conversion"}
# Hamle → AI önerisinin ve ölçümün odağı (eski "action.key" değerleri; bkz. diagnosis.prompt_brief, impact._METRIC_BY_FOCUS)
FOCUS = {
    "title_tags": "seo", "photo": "appeal", "price": "conversion", "description": "conversion", "shop": "shop", "demand": "demand",
    "track": "track", "overhaul": "seo", "watching": "keep", "keep": "keep", "keep_peak": "keep", "keep_working": "keep", "wait": "wait", "wait_data": "wait", "deactivate": "keep",
}


_lifetime_cache = ResultCache(max_items=20)


def _lifetime(db: Session, shop_id: int, idx: dict, today: dt.date) -> dict:
    """Günlük kayıt birikene kadar kaba huni: Etsy'nin ömür boyu görüntülenme/favori sayıları ve sipariş geçmişinden satış.
    Döner: {listing_id: {vpd, fav, conv}} ve mağaza ortancaları. Dönüşüm yalnızca sipariş geçmişi listing'in tüm ömrünü
    kapsıyorsa hesaplanır (daha eski listing'in satışı eksik sayılırdı)."""
    key = (shop_id, today.isoformat(), len(idx), sum(len(v) for v in idx.values()))
    hit = _lifetime_cache.get(key)
    if hit is not None:
        return hit
    history_start = min((rows[0][0] for rows in idx.values() if rows), default=today)
    per: dict[int, dict] = {}
    for lid, views, favs, raw_json in db.execute(
        select(ListingCache.listing_id, ListingCache.views, ListingCache.favorites, ListingCache.raw_json).where(ListingCache.shop_id == shop_id)
    ):
        raw = json.loads(raw_json)
        created = raw.get("original_creation_timestamp") or raw.get("creation_timestamp")
        if raw.get("state") != "active" or not created:
            continue
        born = dt.datetime.fromtimestamp(created, dt.timezone.utc).date()
        age = (today - born).days
        if age < MIN_LIFETIME_AGE or not views:
            continue
        units = sum(u for _, u, _ in idx.get(lid, []))
        per[lid] = {
            "age": age, "views": views, "vpd": views / age, "fav": (favs or 0) / views,
            "conv": units / views * 100 if born >= history_start else None, "units": units,
        }

    def med(k: str) -> float | None:
        vals = [v[k] for v in per.values() if v[k] is not None and v["views"] >= 20]
        return statistics.median(vals) if len(vals) >= MIN_LIFETIME_SAMPLE else None

    out = {"per": per, "vpd": med("vpd"), "fav": med("fav"), "conv": med("conv")}
    _lifetime_cache.set(key, out)
    return out


def _lifetime_stage(life: dict, listing_id: int) -> tuple[str | None, str, bool]:
    """(zayıf aşama, gerekçe, kıyas yapılabildi mi) — ömür boyu sayılarla."""
    me = life["per"].get(listing_id)
    if me is None or me["views"] < 20 or life["vpd"] is None:
        return None, "", False
    if me["vpd"] < life["vpd"] * WEAK_RATIO or (me["vpd"] < ABS_MIN_VPD and me["vpd"] <= life["vpd"]):
        why = tr(
            f"Etsy'ye göre ömür boyu günde {me['vpd']:.1f} görüntülenme alıyor (mağazandaki listing'lerin ortancası {life['vpd']:.1f}); çok az kişi görüyor.",
            f"Per Etsy's lifetime counts it gets {me['vpd']:.1f} views a day (your listings' median is {life['vpd']:.1f}); very few people see it.",
        )
        if life["fav"] is not None and me["fav"] >= life["fav"]:
            why += " " + tr(
                f"Görenlerin favorileme oranı %{me['fav'] * 100:.1f} (mağaza ortancası %{life['fav'] * 100:.1f}): ürün beğeniliyor, sorun görünürlük.",
                f"{me['fav'] * 100:.1f}% of viewers favorite it (shop median {life['fav'] * 100:.1f}%): buyers like it, the problem is visibility.",
            )
        return "visibility", why, True
    if life["fav"] is not None and me["fav"] < life["fav"] * WEAK_RATIO:
        return "appeal", tr(
            f"Görüntüleyenlerin favorileme oranı %{me['fav'] * 100:.1f}; mağaza ortancası %{life['fav'] * 100:.1f}.",
            f"{me['fav'] * 100:.1f}% of viewers favorite it; the shop median is {life['fav'] * 100:.1f}%.",
        ), True
    if life["conv"] is not None and me["conv"] is not None and me["views"] >= 100 and me["conv"] < life["conv"] * WEAK_RATIO:
        return "conversion", tr(
            f"{me['views']} görüntülenmeden {me['units']} satış (%{me['conv']:.1f}); mağaza ortancası %{life['conv']:.1f}.",
            f"{me['units']} sales from {me['views']} views ({me['conv']:.1f}%); the shop median is {life['conv']:.1f}%.",
        ), True
    return None, tr(
        f"Etsy'nin ömür boyu sayılarına göre görüntülenme (günde {me['vpd']:.1f}), favori oranı (%{me['fav'] * 100:.1f}) ve satış mağaza ortancasının çok altında değil.",
        f"Per Etsy's lifetime counts, views ({me['vpd']:.1f}/day), favorite rate ({me['fav'] * 100:.1f}%) and sales are not far below the shop median.",
    ), True


DUPLICATE_SIMILARITY = 0.8  # başlık kelime kümesi benzerliği; bunun üstü "neredeyse aynı başlık"
_titles_cache = ResultCache(max_items=20)


def _near_duplicates(db: Session, shop_id: int, listing_id: int, today: dt.date) -> list[dict]:
    """Mağazada başlığı neredeyse aynı olan diğer aktif listing'ler: aynı aramalarda birbirleriyle yarışırlar ve Etsy
    çoğunlukla yalnızca birini öne çıkarır."""
    from app.ai import quality

    key = (shop_id, today.isoformat())
    titles = _titles_cache.get(key)
    if titles is None:
        titles = {
            lid: (html.unescape(title or ""), quality._words(html.unescape(title or "")), views or 0)
            for lid, title, views, raw_json in db.execute(
                select(ListingCache.listing_id, ListingCache.title, ListingCache.views, ListingCache.raw_json).where(ListingCache.shop_id == shop_id)
            )
            if json.loads(raw_json).get("state") == "active"
        }
        _titles_cache.set(key, titles)
    me = titles.get(listing_id)
    if not me or not me[1]:
        return []
    out = []
    for lid, (title, words, views) in titles.items():
        if lid != listing_id and quality._jaccard(me[1], words) >= DUPLICATE_SIMILARITY:
            out.append({"listing_id": lid, "title": title, "views": views})
    return sorted(out, key=lambda x: -x["views"])[:3]


def faded(rows: list, today: dt.date) -> dict | None:
    """Eskiden satıp sönmüş listing: en iyi takvim yılı ≥ FADED_PEAK adet, son 12 ay ≤ zirvenin FADED_RATIO'su. Ömür boyu
    ortalama bunu gizler (eski satışlar oranı iyi gösterir), teşhisin 24 aylık eğrisi de göremez (son iki yılda satış yok)."""
    by_year: dict[int, int] = {}
    for day, units, _ in rows:
        by_year[day.year] = by_year.get(day.year, 0) + units
    if not by_year:
        return None
    peak_year = max(by_year, key=by_year.get)
    peak = by_year[peak_year]
    last12 = sum(u for day, u, _ in rows if day > today - dt.timedelta(days=365))
    if peak >= FADED_PEAK and last12 <= peak * FADED_RATIO and peak_year < today.year:
        return {"peak_year": peak_year, "peak": peak, "last12": last12}
    return None


def _price_info(db: Session, shop_id: int, listing_id: int, today: dt.date) -> dict | None:
    """Son 30 günün sıra ölçümlerinden: kendi fiyatın ve ilk 20 rakibin ortanca fiyatı (aynı para biriminde)."""
    rows = db.execute(
        select(RankSnapshot.own_price, RankSnapshot.top_price_median, RankSnapshot.currency, RankSnapshot.day).where(
            RankSnapshot.shop_id == shop_id, RankSnapshot.listing_id == listing_id, RankSnapshot.day >= today - dt.timedelta(days=30),
            RankSnapshot.top_price_median.is_not(None), RankSnapshot.own_price.is_not(None),
        ).order_by(RankSnapshot.day.desc())
    ).all()
    if not rows:
        return None
    own, cur = rows[0][0], rows[0][2]
    median = statistics.median(r[1] for r in rows[:10])
    out = {"current": round(own, 2), "median": round(median, 2), "currency": cur, "ratio": round(own / median, 2) if median else None}
    if median and own > median * PRICE_HIGH:
        # Önce ölçülü bir indirim: %10–25, ama rakip ortancasının %10 üstünün altına inmeden.
        low, high = max(median * 1.1, own * 0.75), own * 0.9
        if low < high:
            out["suggest_low"], out["suggest_high"] = round(low), round(high)
    return out


def _missing_searches(db: Session, shop_id: int, listing_id: int, today: dt.date) -> list[str]:
    """Takip edilen aramalardan listing'in son ölçümde ilk sonuçlarda görünmediği ya da 100'ün gerisinde kaldığı olanlar."""
    active = {k for (k,) in db.execute(select(TrackedKeyword.keyword).where(
        TrackedKeyword.shop_id == shop_id, TrackedKeyword.listing_id == listing_id, TrackedKeyword.active.is_(True),
    ))}
    latest: dict[str, tuple[dt.date, int | None]] = {}
    for kw, day, pos in db.execute(select(RankSnapshot.keyword, RankSnapshot.day, RankSnapshot.position).where(
        RankSnapshot.shop_id == shop_id, RankSnapshot.listing_id == listing_id, RankSnapshot.day >= today - dt.timedelta(days=14),
    )):
        if kw in active and (kw not in latest or day > latest[kw][0]):
            latest[kw] = (day, pos)
    return [kw for kw, (_, pos) in sorted(latest.items()) if pos is None or pos > 100][:3]


def _tried(changes: list[ListingChange], today: dt.date) -> set[str]:
    """Yakın zamanda denenip işe yaramamış (fark yok / kötüleşti) hamleler."""
    out: set[str] = set()
    for ch in changes:
        if (today - ch.published_at.date()).days > TRIED_DAYS or not ch.result_json:
            continue
        r = json.loads(ch.result_json)
        if r.get("status") == "measured" and r.get("verdict") in ("same", "worse"):
            out |= {_FIELD_MOVE[f] for f in json.loads(ch.fields or "[]") if f in _FIELD_MOVE}
    return out


def _move_for(stage: str, tried: set[str], price: dict | None) -> str:
    for move in _STAGE_MOVES[stage]:
        if move == "price" and not (price and price.get("suggest_low")):
            continue
        if move not in tried:
            return move
    return _STAGE_MOVES[stage][0]  # hepsi denendiyse en olağanı (durdurma kararını huni sağlığı verir)


def _step(key: str, text: str, why: list[str], target: str | None = None, **extra) -> dict:
    return {"key": key, "focus": FOCUS.get(key, "keep"), "text": text, "why": [w for w in why if w], "target": target, **extra}


def decide(
    db: Session, shop_id: int, listing_id: int, today: dt.date, status: str, cause: str | None, season: dict, digital: bool,
    changes: list[ListingChange], fields_text, idx: dict | None = None,
) -> dict:
    """Tek sıradaki adım. `changes`: listing'in değişiklikleri (eskiden yeniye); `fields_text`: alan listesini metne çevirir."""
    last = changes[-1] if changes else None
    r = json.loads(last.result_json) if last and last.result_json else {}
    if last is not None:
        days = (today - last.published_at.date()).days
        what = fields_text(json.loads(last.fields or "[]"))

        # 1. Ölçülüyor
        if days < impact.MIN_WINDOW:
            return _step("wait", tr(
                f"Dokunma: son değişiklik {days} gün önce yayınlandı, etkisi ölçülüyor.",
                f"Leave it: the last change was published {days} days ago and is being measured.",
            ), [tr(
                f"Değişen: {what}. İlk sonuç {impact.MIN_WINDOW - days} gün sonra, kesin sonuç {impact.MAX_WINDOW - days} gün sonra gelir. Şimdi başka bir şey değiştirirsen hangisinin işe yaradığı anlaşılmaz.",
                f"Changed: {what}. The first result comes in {impact.MIN_WINDOW - days} days, the final one in {impact.MAX_WINDOW - days} days. Changing something else now makes it impossible to tell what worked.",
            )])

        measured = r.get("status") == "measured"
        # 2. Kötüleşti
        if measured and r.get("verdict") == "worse" and (r.get("final") or r.get("confidence") == "high"):
            fields = json.loads(last.fields or "[]")
            det = json.loads(last.details or "{}")
            net = r["net"][r["metric"]] or 0
            text_fields = {"title", "tags", "text", "description", "category", "properties"} & set(fields)
            target = "ai" if text_fields else "sec-media" if "images" in fields else "sec-options" if "price" in fields else None
            why = [tr(
                f"{last.published_at.date().isoformat()} tarihli değişiklikten ({what}) sonra listing benzerlerine göre %{net:+d} geride kaldı.",
                f"After the change on {last.published_at.date().isoformat()} ({what}) the listing fell {net:+d}% behind similar listings.",
            )]
            if det.get("title_before"):
                why.append(tr(f'Önceki başlık: "{det["title_before"]}"', f'Previous title: "{det["title_before"]}"'))
            if det.get("tags_removed"):
                why.append(tr(f"O değişiklikte çıkan etiketler: {', '.join(det['tags_removed'])}", f"Tags removed in that change: {', '.join(det['tags_removed'])}"))
            if det.get("price_before") is not None and "price" in fields:
                why.append(tr(f"Önceki fiyat: {det['price_before']}", f"Previous price: {det['price_before']}"))
            return _step("revert", tr(
                "Son değişikliği geri al ya da kaybedilenleri geri getir.",
                "Revert the last change or bring back what was lost.",
            ), why, target, focus=FOCUS.get(_FIELD_MOVE.get(next((f for f in fields if f in _FIELD_MOVE), ""), ""), "seo"))

        # 3. Ön sonuç: 30 günü bekle
        if not r.get("final") and days < impact.MAX_WINDOW:
            return _step("wait", tr(
                f"Dokunma: son değişikliğin ölçümü sürüyor ({days}/{impact.MAX_WINDOW} gün).",
                f"Leave it: the last change is still being measured ({days}/{impact.MAX_WINDOW} days).",
            ), [tr(
                f"Değişen: {what}. Ön sonuç: {_verdict_text(r)}. Kesin sonuç {impact.MAX_WINDOW - days} gün sonra.",
                f"Changed: {what}. Preliminary result: {_verdict_text(r)}. Final result in {impact.MAX_WINDOW - days} days.",
            )])

    health = db.scalars(select(ListingHealth).where(ListingHealth.shop_id == shop_id, ListingHealth.listing_id == listing_id)).one_or_none()
    # 4. Durdurmayı değerlendir
    if health is not None and health.stage == "kill_candidate":
        return _step("deactivate", tr(
            "Bu listing'i durdurmayı değerlendir.",
            "Consider deactivating this listing.",
        ), [tr(
            f"{health.attempts} farklı değişiklik denendi, performans hâlâ mağaza ortancasının çok altında.",
            f"{health.attempts} different changes were tried and performance is still far below the shop median.",
        )])

    # 5. Zirvede dokunma
    if season.get("advice") == "in_peak" and status != "declining":
        return _step("keep_peak", tr(
            "Dokunma: satış zirvesindesin.",
            "Leave it: you are in your sales peak.",
        ), [tr("Zirvede yapılan değişiklik Etsy'nin listing'i yeniden değerlendirmesine yol açar; büyük değişiklikleri zirveden sonraya bırak.",
               "A change during the peak makes Etsy re-evaluate the listing; save big changes for after the peak.")])

    if status == "new":
        return _step("wait_data", tr("Yeni listing: önce veri birikmesini bekle.", "New listing: let data build up first."), [tr(
            "Satış ve görüntülenme geçmişi oluşmadan yapılan değişikliğin etkisi ölçülemez. Aramada hiç görünmüyorsa başlık ve etiketlere bakılabilir.",
            "A change made before any sales or view history cannot be measured. If it does not show up in search at all, check the title and tags.",
        )])

    # 6. Zayıf aşama
    price = _price_info(db, shop_id, listing_id, today)
    if status == "declining" and cause == "shop_wide":
        return _step("shop", tr(
            "Önce mağaza genelindeki sebebe bak; bu listing'in metni tek başına çözmez.",
            "Look at the shop-wide cause first; this listing's text alone will not fix it.",
        ), [tr(
            "Mağazanın tamamı da benzer oranda düşüyor: mağaza puanı, yorumlar, fiyatlar ve reklam ayarları." if digital else
            "Mağazanın tamamı da benzer oranda düşüyor: mağaza puanı, yorumlar, hazırlama/teslim süreleri, fiyatlar ve reklam ayarları.",
            "The whole shop is falling at a similar rate: shop rating, reviews, prices and ad settings." if digital else
            "The whole shop is falling at a similar rate: shop rating, reviews, processing/delivery times, prices and ad settings.",
        ), _price_why(price)], price=price)
    if status == "declining" and cause == "demand":
        return _step("demand", tr(
            "Bu ürüne talep düşmüş; büyük değişiklik sınırlı fayda sağlar.",
            "Demand for this product has dropped; big changes will help only a little.",
        ), [tr("Etiketlerle ürünün farklı kullanım ve alıcı aramalarını yakalamayı dene; yeni ürün fikrine de bak.",
               "Try catching other uses and buyer searches with tags; consider a new product idea too.")])

    stage, life_why, compared = None, "", False
    fade = faded(idx.get(listing_id, []), today) if idx is not None else None
    fade_line = ""
    if fade:
        life = _lifetime(db, shop_id, idx, today) if idx is not None else None
        me = (life["per"].get(listing_id) or {}) if life else {}
        fade_line = tr(
            f"Eskiden satıyordu: {fade['peak_year']} yılında {fade['peak']} satış, son 12 ayda {fade['last12']}.",
            f"It used to sell: {fade['peak']} sales in {fade['peak_year']}, {fade['last12']} in the last 12 months.",
        )
        if life and me.get("fav") and life["fav"] and me["fav"] >= life["fav"]:
            fade_line += " " + tr(
                f"Görenler hâlâ beğeniyor (favori oranı %{me['fav'] * 100:.1f}); ürün değil, büyük olasılıkla aramadaki yeri ve kullandığı dil eskidi.",
                f"Viewers still like it (favorite rate {me['fav'] * 100:.1f}%); not the item, most likely its place and wording in search have aged.",
            )
    if health is not None and health.stage == "flagged" and health.bottleneck:
        stage, compared = _BOTTLENECK_STAGE.get(health.bottleneck), True
    elif status == "declining" and cause in _CAUSE_STAGE:
        # Gerçek satış eğrisine dayanan teşhis sebebi, ömür boyu kaba kıyastan önce gelir.
        stage, compared = _CAUSE_STAGE[cause], True
    elif fade:
        # Sönmüş listing: önce aramadaki yeri (başlık/etiket); sonraki turlarda fotoğraf ve fiyat.
        stage, compared = "visibility", True
    elif health is not None and health.stage == "stable":
        compared = True
    elif idx is not None:
        # Günlük kayıt henüz kıyas için yetersiz: Etsy'nin ömür boyu sayılarıyla kaba huni.
        stage, life_why, compared = _lifetime_stage(_lifetime(db, shop_id, idx, today), listing_id)
    if stage is None and status == "declining":
        stage = _CAUSE_STAGE.get(cause or "")
        if stage is None:
            return _step("track", tr(
                "Sebep henüz net değil: listing'i sıra takibine al ve veri topla.",
                "The cause is not clear yet: add the listing to rank tracking and collect data.",
            ), [tr("Aramada mı kayboluyor, yoksa görünüp satmıyor mu, sıra takibi birkaç günde netleştirir. Etsy verisi sekmesine arama terimlerini eklemek de yardımcı olur.",
                   "Rank tracking shows within days whether it is losing search position or being seen without selling. Adding search terms on the Etsy data tab helps too.")])
    if stage is None:
        if r.get("verdict") == "better":
            return _step("keep_working", tr("Dokunma: son değişiklik işe yaradı.", "Leave it: the last change worked."), [tr(
                f"Sonuç: {_verdict_text(r)}. Hunide belirgin bir zayıf nokta görünmüyor; iyi çalışanı bozma.",
                f"Result: {_verdict_text(r)}. No clear weak spot in the funnel; do not break what works.",
            ), _season_why(season)])
        if not compared:
            return _step("watching", tr(
                "Henüz karar verecek kadar veri yok.",
                "Not enough data to decide yet.",
            ), [tr(
                "Satış geçmişi az ve bu listing için görüntülenme/favori karşılaştırması yapılamadı (çok az görüntülenme ya da mağazada kıyaslanacak yeterli listing yok). Günlük görüntülenme kaydı birikince (yaklaşık 3 hafta) huni karşılaştırması başlar. Bu sürede listing'i sıra takibine almak aramada nerede olduğunu gösterir.",
                "There is little sales history and no view/favorite comparison was possible for this listing (too few views or not enough comparable listings in the shop). The funnel comparison starts once daily view records build up (about 3 weeks). Meanwhile, rank tracking shows where it stands in search.",
            ), _season_why(season)])
        return _step("keep", tr("Dokunma: belirgin bir zayıf nokta yok.", "Leave it: no clear weak spot."), [
            life_why or tr(
                "Görüntülenme, favori ve dönüşüm son dönemde mağaza ortancasının çok altında değil.",
                "Views, favorites and conversion have recently not been far below the shop median.",
            ),
            tr("Satış düşmüyor." if status in ("stable", "growing") else "Satış geçmişi az; bu kıyas kaba bir göstergedir.",
               "Sales are not falling." if status in ("stable", "growing") else "Sales history is thin; this comparison is a rough indicator."),
            _season_why(season),
        ])

    tried = _tried(changes, today)
    if fade and fade["last12"] <= OVERHAUL_MAX_UNITS and len(tried & {"title_tags", "photo", "description"}) < 2:
        return _step("overhaul", tr(
            "Kapsamlı yenile: başlık, etiketler, açıklama ve kapak fotoğrafı bu turda birlikte; fiyatı da gözden geçir.",
            "Full refresh: title, tags, description and main photo together this round; review the price too.",
        ), [fade_line, tr(
            "Satış neredeyse sıfır: korunacak bir şey yok ve tek tek denemek (her tur 30 gün) çok yavaş kalır. Bu listing'i bugünün aramalarına göre baştan kur. Ölçüm yine yapılır ve yenilemenin bütün olarak işe yarayıp yaramadığını gösterir.",
            "Sales are close to zero: there is nothing to protect and trying one thing at a time (30 days a round) is too slow. Rebuild this listing for today's searches. It is still measured and shows whether the refresh as a whole worked.",
        ), _price_why(price) or tr(
            "Fiyatı rakiplerle kıyaslamak için listing'i sıra takibine al.",
            "Add the listing to rank tracking to compare its price with competitors.",
        ), _season_why(season)], "ai", price=price)
    move = _move_for(stage, tried, price)
    why_stage = {
        "visibility": tr("Aramada az görünüyor: günlük görüntülenme mağaza ortancasının çok altında ya da satış görünürlük kaybıyla düşüyor.",
                         "It shows up little in search: daily views are far below the shop median or sales fall with lost visibility."),
        "appeal": tr("Görülüyor ama tıklanmıyor/favorilenmiyor: favori oranı mağaza ortancasının çok altında.",
                     "It is seen but not clicked or favorited: its favorite rate is far below the shop median."),
        "conversion": tr("İlgi var ama satışa dönmüyor: favori alıyor, satış mağaza ortancasının çok altında.",
                         "There is interest but few sales: it gets favorites, but sales are far below the shop median."),
    }[stage]
    if life_why:
        why_stage = life_why + " " + tr("(Günlük kayıt yeni başladığı için ömür boyu sayılarla kaba bir kıyas.)", "(A rough comparison on lifetime counts, since daily records have only just started.)")
    if fade_line:
        why_stage = fade_line + " " + why_stage
    fade_next = tr(
        "Bu tur başlık ve etiketler; etkisi ölçülünce sıradaki turlarda kapak fotoğrafı ve fiyat gelir (rakip fiyatlarıyla kıyas için listing'i sıra takibine al).",
        "This round: title and tags; once measured, the next rounds are the main photo and the price (add the listing to rank tracking to compare with competitor prices).",
    ) if fade else ""
    tried_why = tr(
        f"Daha önce denenip etki etmeyenler atlandı: {', '.join(_MOVE_LABEL[m][0] for m in sorted(tried) if m in _MOVE_LABEL)}.",
        f"Moves already tried without effect were skipped: {', '.join(_MOVE_LABEL[m][1] for m in sorted(tried) if m in _MOVE_LABEL)}.",
    ) if tried else ""
    season_why = _season_why(season)

    if move == "title_tags":
        missing = _missing_searches(db, shop_id, listing_id, today)
        dupes = _near_duplicates(db, shop_id, listing_id, today)
        dupe_why = tr(
            "Mağazanda neredeyse aynı başlıklı aktif listing var: " + "; ".join(f'"{x["title"][:60]}" ({x["views"]} görüntülenme)' for x in dupes)
            + ". Aynı aramalarda birbirinizle yarışıyorsunuz ve Etsy çoğunlukla yalnızca birini öne çıkarır: bu listing'i farklı bir ana aramaya (boyut, kullanım yeri, stil, alıcı) yönelt ya da gerçekten aynı ürünse tek listing'te birleştir.",
            "You have active listings with almost the same title: " + "; ".join(f'"{x["title"][:60]}" ({x["views"]} views)' for x in dupes)
            + ". They compete in the same searches and Etsy usually promotes only one: steer this listing to a different main search (size, place of use, style, buyer) or merge them if they really are the same item.",
        ) if dupes else ""
        return _step("title_tags", tr(
            "Başlığı ve etiketleri güncelle (AI önerisi bu aşamaya odaklanır).",
            "Update the title and tags (the AI suggestion focuses on this stage).",
        ), [why_stage, tr(
            f"Takip edilen şu aramalarda ilk 100'de yoksun: {', '.join(missing)}." if missing else "Ana arama öbeğini başlığın başında tut; satış getiren eski etiketleri koru.",
            f"You are not in the top 100 for these tracked searches: {', '.join(missing)}." if missing else "Keep the main search phrase at the start of the title; keep the old tags that bring sales.",
        ), dupe_why, fade_next, tried_why, season_why], "ai", keywords=missing, duplicates=dupes)
    if move == "photo":
        return _step("photo", tr(
            "Kapak fotoğrafını değiştir; metne bu tur dokunma.",
            "Change the main photo; leave the text alone this round.",
        ), [why_stage, tr(
            "İlk fotoğraf aramada tıklanmayı belirleyen en büyük etken: ürün net görünsün, arka plan sade, kullanım ortamı belli olsun. Önizleme görselleri dijital üründe neyin indirileceğini göstermeli." if digital else
            "İlk fotoğraf aramada tıklanmayı belirleyen en büyük etken: ürün net ve büyük görünsün, arka plan sade, kullanım ortamı (duvarda, kapıda) belli olsun.",
            "The first photo is the biggest factor in search clicks: show clearly what buyers download." if digital else
            "The first photo is the biggest factor in search clicks: show the item clearly and large, with a simple background and its setting (on a wall, by a door).",
        ), tried_why, season_why], "sec-media")
    if move == "price":
        return _step("price", tr(
            f"Fiyatı dene: {price['current']:g} → {price['suggest_low']}–{price['suggest_high']} {price['currency']}. Metne bu tur dokunma.",
            f"Try the price: {price['current']:g} → {price['suggest_low']}–{price['suggest_high']} {price['currency']}. Leave the text alone this round.",
        ), [why_stage, _price_why(price), tr(
            "Önce ölçülü bir indirim: işe yararsa 30 gün sonra görünür; satış artmazsa sorun fiyatta değildir.",
            "Start with a moderate cut: if it works it shows within 30 days; if sales do not rise, price is not the issue.",
        ), tried_why, season_why], "sec-options", price=price)
    return _step("description", tr(
        "Açıklamayı alıcının sorularına göre yeniden yaz (AI önerisi bu aşamaya odaklanır).",
        "Rewrite the description around buyers' questions (the AI suggestion focuses on this stage).",
    ), [why_stage, tr(
        "İlk paragraf dosya biçimini, çözünürlüğü, dosya sayısını, nasıl indirileceğini ve kullanım hakkını anlatsın." if digital else
        "İlk paragraf ölçü, malzeme, kişiselleştirmenin nasıl yapıldığı ve teslim süresini net cevaplasın.",
        "The first paragraph should cover the file format, resolution, number of files, how to download and usage rights." if digital else
        "The first paragraph should clearly answer size, material, how personalization works and delivery time.",
    ), _price_why(price) or (tr(
        "Fiyatın rakiplerle kıyası için listing'i sıra takibine al; aramadaki ilk 20 rakibin fiyatı ölçülür.",
        "Add the listing to rank tracking to compare its price with the top 20 competitors in search.",
    ) if price is None else ""), tried_why, season_why], "ai", price=price)


_MOVE_LABEL = {
    "title_tags": ("başlık/etiketler", "title/tags"), "photo": ("fotoğraflar", "photos"),
    "price": ("fiyat", "price"), "description": ("açıklama", "description"),
}


def _verdict_text(r: dict) -> str:
    if r.get("status") != "measured":
        return tr("henüz yok", "none yet")
    metric = {"views": tr("görüntülenme", "views"), "favorites": tr("favori", "favorites"), "units": tr("satış", "sales")}[r["metric"]]
    net = r["net"][r["metric"]]
    pct = f" · {metric} {net:+d}%" if net is not None else ""
    return {
        "better": tr("işe yaradı", "worked"), "worse": tr("kötüleşti", "got worse"), "same": tr("fark yok", "no difference"),
        "unclear": tr("belirsiz", "unclear"), "low_data": tr("veri az", "too little data"),
    }.get(r.get("verdict"), "") + pct


def _price_why(price: dict | None) -> str:
    if not price or not price.get("ratio") or price["ratio"] < PRICE_HIGH:
        return ""
    return tr(
        f"Fiyatın ({price['current']:g} {price['currency']}) aramadaki ilk 20 rakibin ortancasının ({price['median']:g}) %{round((price['ratio'] - 1) * 100)} üstünde.",
        f"Your price ({price['current']:g} {price['currency']}) is {round((price['ratio'] - 1) * 100)}% above the median of the top 20 competitors ({price['median']:g}).",
    )


def _season_why(season: dict) -> str:
    return season.get("text", "") if season.get("advice") == "prepare" else ""

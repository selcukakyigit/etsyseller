import datetime as dt
import html
import logging
import math
import re
from collections import Counter

from sqlalchemy.orm import Session

from app.ai import quality, standard
from app.etsy import search as etsy_search
from app.keywords import competition, scoring
from app.listings import performance
from app.research import bands, exposure, policy, service as research
from app.research.terms import normalize
from app.shops.models import Shop

logger = logging.getLogger(__name__)

OWN_LISTINGS = 6  # etiketleri havuza alınacak, bu listing'e en benzer kendi listing'lerin sayısı
OWN_TAGS = 15
COMPETITOR_SAMPLE = 50
COMPETITOR_TAGS = 30  # editördeki "havuzdan seç" artık yalnızca rakip etiketleri öneri olarak gösteriyor (SENİN
# etiketleri zaten kendi listing'lerinden bilinen fikirler — çeşitlilik için rakip payını büyüttük)
POOL_SIZE = OWN_TAGS + COMPETITOR_TAGS
TITLE_PHRASES = 15  # rakip BAŞLIKLARINDA en sık geçen 2–3 kelimelik ifadeler (etiketlerde olmayan arama dili)
TITLE_PHRASE_MIN = 4  # ilk 50 başlıkta en az bu kadar geçmeli
WINNER_WINDOW_DAYS = 180
MIN_RELEVANCE = 0.12  # ağırlıklı kelime benzerliği bunun altındaysa listing "alakasız" sayılır


def _own_tag_agg(db: Session, shop: Shop, listing: dict) -> tuple[dict[str, dict], int]:
    """Senin ALAKALI listing'lerinin etiketlerini toplar, GERÇEK SATIŞA göre ağırlıklandırır. Ham toplam
    (dict[etiket] -> {units, n, from}) + kaç benzer listing seçildiği döner; üst N'e kesme `build_keyword_pool`'da
    yapılır — böylece havuzda yer almayan ama listing'de zaten kullanılan bir etiketin de gerçek sayısına
    (kesilmemiş hâliyle) ulaşılabiliyor.

    Eski yöntem, aynı kategorideki listing'leri günlük anlık görüntülerdeki görüntülenme artışıyla sıralıyordu; bu geçmiş
    çok kısa olduğunda (ör. 2 gün) rastgele sonuç veriyordu ve kategori çok geniş olduğunda (Wall Decor) alakasız ürünlerin
    etiketlerini getiriyordu. Şimdi: (1) bu listing'in başlık+etiketlerine kelime benzerliği, (2) son 180 gündeki gerçek
    satış adedi (sipariş geçmişi tam olduğu için güvenilir). Yerel veriden hesaplanır, Etsy'ye istek atmaz."""
    lid = listing.get("listing_id")
    others = quality.shop_others(db, shop.id, exclude_id=lid)
    target = quality._words(f"{listing.get('title', '')} {' '.join(listing.get('tags') or [])}")
    docs = [quality._words(f"{o['title']} {' '.join(o['tags'])}") for o in others]

    # Kelime ağırlığı (IDF): mağazadaki her listing'de geçen kelimeler (metal, wall, art, decor…) benzerliği şişirmesin;
    # ayırt edici kelimeler (geometric, chess, mirror, farm…) ağır bassın.
    df: Counter[str] = Counter(w for d in docs for w in d)
    n_docs = max(len(docs), 1)
    weight = lambda w: math.log((n_docs + 1) / (df.get(w, 0) + 1)) + 0.05  # noqa: E731

    def wjaccard(a: set[str], b: set[str]) -> float:
        union = sum(weight(w) for w in a | b)
        return sum(weight(w) for w in a & b) / union if union else 0.0

    today = dt.date.today()
    sales = performance.sales_by_listing(db, shop, today - dt.timedelta(days=WINNER_WINDOW_DAYS - 1), today)

    ranked = []
    for o, words in zip(others, docs):
        rel = wjaccard(target, words)
        if rel < MIN_RELEVANCE:
            continue
        units = sales.get(o["listing_id"], {}).get("units", 0)
        # Alaka öncelikli; satış yalnızca hafif bir çarpan (çok satan ama az alakalı ürün öne geçmesin)
        ranked.append((rel * (1 + 0.35 * math.log1p(units)), rel, units, o))
    ranked.sort(key=lambda r: -r[0])
    chosen = ranked[:OWN_LISTINGS]

    agg: dict[str, dict] = {}
    for _, _, units, o in chosen:
        for tag in o["tags"]:
            key = tag.lower()
            d = agg.setdefault(key, {"tag": key, "units": 0, "n": 0, "from": []})
            d["units"] += units
            d["n"] += 1
            if len(d["from"]) < 2:
                d["from"].append(o["title"][:60])
    return agg, len(chosen)


def _anchor_keywords(listing: dict) -> str | None:
    """A short, natural search phrase for this listing (its title up to the
    first comma/pipe) — Etsy's own docs say sort_on=score "only works when
    combined with one of the search options (keywords, region, etc.)";
    taxonomy_id alone doesn't count. Without a real keywords term, "top
    scoring in category X" can surface listings that are mis-categorized —
    sellers cross-listing unrelated products under a high-traffic category
    to farm impressions — which is exactly what taxonomy-only search returned
    in testing (unrelated mobile-game/service listings in "Wall Decor")."""
    title = (listing.get("title") or "").strip()
    if not title:
        return None
    # Metinde EN ÖNCE geçen ayırıcıyı kullan — sabit bir öncelik sırasıyla (ör. hep önce virgül) kontrol
    # etmek, ayırıcı metinde daha SONRA geçse bile onu seçip yanlış (gereksiz kısa/uzun) bir çapa üretebiliyordu.
    positions = [title.index(sep) for sep in (",", "|", "-", ":") if sep in title]
    if positions:
        title = title[: min(positions)].strip()
    return title or None


def _title_phrases(titles: list[str]) -> Counter:
    """Başlıklarda geçen 2–3 kelimelik doğal ifadeler: her ifade bir başlıkta en fazla bir kez sayılır. Parçalanmış kalıpları ("name garage" gibi,
    "custom name garage sign"dan kopan) elemek için iki süzgeç: (1) ifade, başlık parçalarının sık BİTTİĞİ bir kelimeyle bitmeli (sign, decor, gift…);
    (2) daha uzun bir ifadenin neredeyse aynı sıklıkta içinde kaldığı kısa ifade atılır. Durak sözcükle başlayan/biten ve rakam içeren ifadeler de atılır."""
    counts: Counter[str] = Counter()
    tails: Counter[str] = Counter()
    for title in titles:
        seen: set[str] = set()
        seen_tails: set[str] = set()
        for segment in re.split(r"[,|/:;()\[\]–—]+|\s-\s", html.unescape(title).lower()):
            words = re.findall(r"[^\W_]+(?:'[^\W_]+)?", segment)
            if words and words[-1] not in seen_tails:
                seen_tails.add(words[-1])
                tails[words[-1]] += 1
            for n in (2, 3):
                for i in range(len(words) - n + 1):
                    gram = words[i : i + n]
                    if gram[0] in quality._STOP or gram[-1] in quality._STOP or any(w.isdigit() for w in gram):
                        continue
                    phrase = " ".join(gram)
                    if len(phrase) <= standard.TAG_MAX_LEN and phrase not in seen:
                        seen.add(phrase)
                        counts[phrase] += 1
    endings = {w for w, n in tails.items() if n >= TITLE_PHRASE_MIN}
    kept = Counter({p: n for p, n in counts.items() if p.split()[-1] in endings})
    return Counter({p: n for p, n in kept.items() if not any(p != q and f" {p} " in f" {q} " and m >= 0.8 * n for q, m in kept.items())})


def _competitor_tags(taxonomy_id: int | None, keywords: str | None) -> tuple[Counter, int, Counter]:
    """Tag frequency among top-scoring active listings in the same category
    AND matching the listing's own anchor keyword phrase — a free proxy for
    competition level (no extra Etsy request per keyword, unlike a real
    search-volume lookup). Returns (tag -> how many of the sampled listings
    use it, how many listings were sampled)."""
    if not taxonomy_id and not keywords:
        return Counter(), 0, Counter()
    try:
        results = etsy_search.find_active_listings(
            taxonomy_id=taxonomy_id, keywords=keywords, limit=COMPETITOR_SAMPLE
        )
    except Exception:
        logger.exception("Keyword pool: competitor search failed for taxonomy %s", taxonomy_id)
        return Counter(), 0, Counter()

    counts: Counter[str] = Counter()
    for item in results:
        for tag in item.get("tags") or []:
            counts[tag.lower()] += 1
    return counts, len(results), _title_phrases([item.get("title") or "" for item in results])


def build_keyword_pool(db: Session, shop: Shop, listing: dict) -> list[dict]:
    """Aday anahtar kelime havuzu (SEO önerisine ve arayüze girdi): `OWN_TAGS` kadar senin alakalı listing'lerinden
    (gerçek satışa göre sıralı) + `COMPETITOR_TAGS` kadar rakip etiketi (ilk 50 rakip listing'te kaç kez geçtiğine göre).
    Slotlar ayrıdır, bu yüzden rakip verisi kendi etiketlerin tarafından ezilmez.

    Ayrıca: listing'in ŞU AN kullandığı her etiket, üst-N kesmesine girmese bile (ör. iyi satmayan ya da
    rakiplerde nadir geçen bir etiket) havuzda GERÇEK sayısıyla yer alır — aksi halde arayüzde renksiz/skorsuz
    görünüyordu, sanki hiç veri yokmuş gibi; oysa "0/50" ya da düşük satış da anlamlı bir sayı."""
    mine = {t.lower() for t in (listing.get("tags") or [])}
    own_agg, own_sample = _own_tag_agg(db, shop, listing)
    competitor_counts, competitor_sample, title_counts = _competitor_tags(listing.get("taxonomy_id"), _anchor_keywords(listing))

    pool: list[dict] = []
    seen: set[str] = set()

    own_sorted = sorted(own_agg.values(), key=lambda d: (-d["units"], -d["n"]))[:OWN_TAGS]
    for d in own_sorted:
        pool.append({
            "tag": d["tag"], "source": "own", "score": d["n"], "sample_size": own_sample, "units": d["units"],
            "from_listings": d["from"], "in_listing": d["tag"] in mine,
        })
        seen.add(d["tag"])

    added = 0
    for tag, score in competitor_counts.most_common():
        if tag in seen:
            continue
        seen.add(tag)
        pool.append({"tag": tag, "source": "competitor", "score": score, "sample_size": competitor_sample, "in_listing": tag in mine})
        added += 1
        if added >= COMPETITOR_TAGS:
            break

    # Rakip başlıklarında sık geçen ifadeler: etiket olarak kullanılmasalar da alıcının arama dilini gösterir.
    phrases = 0
    for phrase, count in title_counts.most_common():
        if count < TITLE_PHRASE_MIN or phrases >= TITLE_PHRASES:
            break
        if phrase in seen:
            continue
        seen.add(phrase)
        pool.append({"tag": phrase, "source": "competitor", "score": count, "sample_size": competitor_sample, "in_listing": phrase in mine, "from_title": True})
        phrases += 1

    # Havuzda yer almayan ama listing'de zaten kullanılan etiketler — gerçek sayılarıyla, sample_size 0'sa
    # (arama hiç yapılamadıysa/sonuç yoksa) o etiketi hiç eklemiyoruz; "0/0" yanıltıcı olurdu.
    for tag in mine:
        if tag in seen:
            continue
        if tag in own_agg:
            d = own_agg[tag]
            pool.append({
                "tag": tag, "source": "own", "score": d["n"], "sample_size": own_sample, "units": d["units"],
                "from_listings": d["from"], "in_listing": True,
            })
        elif competitor_sample > 0:
            pool.append({"tag": tag, "source": "competitor", "score": competitor_counts.get(tag, 0), "sample_size": competitor_sample, "in_listing": True})
        else:
            continue
        seen.add(tag)

    _add_etsy_data(db, shop, listing, pool, seen, mine)
    return pool


def _add_etsy_data(db: Session, shop: Shop, listing: dict, pool: list[dict], seen: set[str], mine: set[str]) -> None:
    """Kullanıcının Etsy'den yapıştırdığı veri: havuzdaki kelimelere Marketplace Insights arama/rekabet bilgisi eklenir;
    listing'i gerçekten getiren aramalar (arama terimleri / reklam) havuza "etsy" kaynağıyla, ürünle ilgili ama havuzda
    olmayan araştırma kelimeleri "research" kaynağıyla girer."""
    from app.insights import etsy_data

    lid = listing.get("listing_id")
    extra = [r for r in (etsy_data.for_listing(db, shop, lid) if lid else []) if r["source"] in ("search_terms", "ads") and r["listing_id"] == lid]
    for r in extra[:10]:
        if r["keyword"] in seen:
            continue
        seen.add(r["keyword"])
        pool.append({
            "tag": r["keyword"], "source": "etsy", "score": r["orders"] or r["clicks"] or r["views"] or 0, "sample_size": 0,
            "in_listing": r["keyword"] in mine, "etsy_views": r["views"], "etsy_clicks": r["clicks"], "etsy_orders": r["orders"],
        })
    # Kelime araştırmasında olup havuzda olmayan, bu ürünle ilgili aramalar ("research" kaynağı; skor = aylık arama).
    text = " ".join([str(listing.get("title") or ""), " ".join(listing.get("tags") or []), " ".join(listing.get("materials") or [])]).lower()
    words = {w for w in re.findall(r"[^\W_]+(?:'[^\W_]+)?", text) if len(w) > 2}
    for r in etsy_data.related_research(db, shop, words, seen):
        seen.add(r["keyword"])
        pool.append({"tag": r["keyword"], "source": "research", "score": r["searches"] or 0, "sample_size": 0, "in_listing": r["keyword"] in mine})
    info = etsy_data.keyword_index(db, shop, {p["tag"] for p in pool})
    for p in pool:
        if p["tag"] in info:
            i = info[p["tag"]]
            p["etsy_searches"] = i["searches"]
            p["etsy_competition"] = i["competition"]
            p["etsy_conversion"] = i["conversion"]
            p["etsy_trend_pct"] = i["trend_pct"]
            p["etsy_results"] = i["listings_count"]


def _attach_research(db: Session, shop: Shop, pool: list[dict]) -> None:
    """Ortak araştırma havuzundan Google aylık arama/CPC ve kalabalık sayacı (yalnızca okur, sağlayıcıya istek atmaz; eksik kelimeler kuyruğa girer ve
    sonraki istekte gelir, o ana kadar `google_pending` işaretlenir). Araştırma hata verse bile SEO önerisi bozulmaz."""
    tags = [p["tag"] for p in pool]
    try:
        found = research.volumes(db, tags, shop_id=shop.id)
        crowd = exposure.counts(db, tags)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("Araştırma havuzu okunamadı", exc_info=True)
        return
    for item in pool:
        key = normalize(item["tag"])
        m = found.metrics.get(key)
        if m is not None and m.search_volume is not None:
            item["google_volume"], item["google_cpc"] = m.search_volume, m.cpc
        elif m is None and found.pending:
            item["google_pending"] = True  # ölçüm sırada: "sıfır" değil, henüz bilinmiyor
        if crowd.get(key):
            item["crowd_shops"] = crowd[key]
            item["crowd"] = min(1.0, crowd[key] / max(1, int(policy.get("research_crowd_full_shops"))))


def public_pool(pool: list[dict]) -> list[dict]:
    """Kullanıcıya giden havuz: ham Google hacmi/CPC ve mağaza sayıları çıkarılır, yerine talep bandı (low|medium|high) ve `crowded` konur (ham sayılar yalnızca yönetimde)."""
    out = []
    for item in pool:
        clean = {k: v for k, v in item.items() if k not in ("google_volume", "google_cpc", "crowd_shops", "crowd", "google_pending")}
        band = bands.demand_band(item.get("google_volume"))
        if band:
            clean["google_demand"] = band
        if (item.get("crowd") or 0) >= 0.5:
            clean["crowded"] = True
        out.append(clean)
    return out


def scored_pool(db: Session, shop: Shop, listing: dict) -> list[dict]:
    """Yazım hattı için havuz: aday ifadeler + otomatik ölçülen rekabet (toplam sonuç sayısı) + puan, rol ve güven etiketi; puana göre sıralı.
    SEO önerisi, toplu yeniden yazım ve sohbet asistanı AYNI sıralı havuzu kullanır. Arayüzdeki ham havuz `build_keyword_pool`'dur."""
    pool = build_keyword_pool(db, shop, listing)
    _attach_research(db, shop, pool)
    competition.attach_results(pool, listing.get("title") or "")
    return scoring.rank(pool, listing.get("title") or "")

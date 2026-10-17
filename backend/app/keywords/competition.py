"""Aday ifadelerin rekabetini ölçer: Etsy'nin herkese açık aktif listing aramasındaki TOPLAM SONUÇ sayısı (uygulamanın kendi API anahtarıyla; mağaza/OAuth gerekmez).

Aylık arama sayısı (talep) Etsy'den alınamaz, yalnızca kullanıcının yapıştırdığı Marketplace Insights verisinde vardır; sonuç sayısı ise her ifade için
otomatik ölçülür. Yapıştırılmış `etsy_results` varsa ona dokunulmaz. Sonuçlar süreç içi önbellekte tutulur (ifade başına bir istek, `ttl_cache` süresi boyunca)."""
import logging
from concurrent.futures import ThreadPoolExecutor

from app.core.ttl_cache import cached
from app.keywords import scoring
from app.taxonomy import service as taxonomy_service

log = logging.getLogger(__name__)

MAX_MEASURED = 36  # listing başına ölçülen en fazla ifade (Etsy günlük kotasını ve süreyi korur)
WORKERS = 6


def _count(phrase: str) -> int | None:
    try:
        return int(cached(("kw", "count", phrase), lambda: taxonomy_service.search_active_listings(phrase, limit=1)["count"]))
    except Exception:  # noqa: BLE001 - ölçülemeyen ifade yalnızca "sonuç sayısı bilinmiyor" kalır
        log.warning("Sonuç sayısı alınamadı: %s", phrase, exc_info=True)
        return None


def _spread(ranked: list[dict], limit: int) -> list[dict]:
    """Ölçülecek ifadeleri rollere eşit yayar (sırayla her rolün en iyisi): yalnızca uzun kuyruklar ölçülüp ana ifadeler ölçüsüz kalmasın."""
    by_role: dict[str, list[dict]] = {}
    for p in ranked:
        by_role.setdefault(p["role"], []).append(p)
    out: list[dict] = []
    while len(out) < limit and any(by_role.values()):
        for rows in by_role.values():
            if rows and len(out) < limit:
                out.append(rows.pop(0))
    return out


def attach_results(pool: list[dict], title: str = "", limit: int = MAX_MEASURED) -> list[dict]:
    """Havuzdaki en umutlu `limit` ifadenin sonuç sayısını `etsy_results` olarak ekler (yerinde değiştirir ve havuzu döner). Roller arasında dengeli seçilir
    (bkz. `_spread`); sonuç sayısı zaten bilinenler (yapıştırılmış veri) ölçülmez."""
    todo = _spread([p for p in scoring.rank(pool, title) if not p.get("etsy_results")], limit)
    by_tag = {p["tag"]: p for p in pool}
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for p, n in zip(todo, ex.map(lambda x: _count(x["tag"]), todo)):
            if n is not None:
                by_tag[p["tag"]]["etsy_results"] = n
    return pool

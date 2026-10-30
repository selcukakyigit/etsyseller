"""DataForSEO adapter'ı (v3, Live yöntemi): yanıtı ortak `MetricRecord`lara çevirir. Uç nokta ayrıntıları yalnızca burada bilinir.

Live yöntem seçildi çünkü Labs yalnızca Live çalışır ve istekler küçük/toplu yapılır; Live sonuçlar sağlayıcıda SAKLANMAZ, bu yüzden
her yanıt havuza yazılır (bkz. worker.py). Google Ads hacmi istek başına ücretlendirilir (1 ya da 1000 kelime aynı), bu yüzden kelimeler
mümkün olduğunca tek istekte toplanır; Google Ads Live uç noktasında dakikada 12 istek sınırı vardır."""
import datetime as dt
import time

import httpx

from app.research.providers.base import Credentials
from app.research.terms import normalize
from app.research.questions import QUESTION_REGEX, is_question
from app.research.records import MetricRecord, ProviderError, ProviderResponse, SeasonRecord, TrendRecord

BASE = "https://api.dataforseo.com/v3"
TIMEOUT = 60.0
OK = 20000
# Geçici sayılan görev durum kodları (hız sınırı, sunucu tarafı hata); geri kalan 4xxxx kodları kalıcı hatadır (kimlik, parametre, bakiye).
_TRANSIENT_CODES = {40202, 50000, 50301, 50302, 50303}

TREND_WEEKS = 13  # son 13 hafta ile geçen yılın aynı 13 haftası karşılaştırılır (mevsim etkisi böylece ayrılır)
TREND_HISTORY_DAYS = 16 * 31  # ~16 ay: hem son pencereyi hem bir yıl öncesini kapsar; 9 aydan uzun aralık haftalık veri döner
QUESTION_LIMIT = 100
LOCATIONS = {"US": 2840, "GB": 2826, "CA": 2124, "AU": 2036, "DE": 2276, "FR": 2250, "TR": 2792}


def _monthly(items: list[dict] | None) -> list[list[int]] | None:
    rows = [[m["year"], m["month"], m["search_volume"]] for m in items or [] if m.get("search_volume") is not None]
    return rows or None


def _intent(item: dict) -> str | None:
    return ((item.get("search_intent_info") or {}).get("main_intent")) or None


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def trend_windows(series: list[tuple[dt.date, float | None]], weeks: int = TREND_WEEKS) -> tuple[float | None, float | None]:
    """(son pencere ortalaması, geçen yılın aynı penceresinin ortalaması). Veri eksik (None) olan haftalar atlanır."""
    points = sorted((d, v) for d, v in series if v is not None)
    if not points:
        return None, None
    last = points[-1][0]
    recent = [v for d, v in points if d > last - dt.timedelta(weeks=weeks)]
    previous = [v for d, v in points if last - dt.timedelta(weeks=weeks + 52) < d <= last - dt.timedelta(weeks=52)]
    return _mean(recent), _mean(previous)


def _labs_record(item: dict) -> MetricRecord | None:
    """Labs yanıtındaki bir kelime kaydı (öneri ya da tohum) -> ortak ölçüm kaydı."""
    term = normalize(item.get("keyword") or "")
    if not term:
        return None
    info = item.get("keyword_info") or {}
    props = item.get("keyword_properties") or {}
    competition = info.get("competition")
    return MetricRecord(
        term=term, search_volume=info.get("search_volume"), cpc=info.get("cpc"),
        competition=competition if isinstance(competition, (int, float)) else None,
        difficulty=props.get("keyword_difficulty"), intent=_intent(item), monthly=_monthly(info.get("monthly_searches")),
    )


MIN_SEASON_MONTHS = 24  # profil için en az bu kadar farklı (yıl, ay) verisi


def season_profile(points: list[tuple[dt.date, float | None]]) -> tuple[list[int], int] | None:
    """Haftalık ilgi noktalarından takvim ayı profili: her ayın (tüm yıllar boyunca) ortalaması, zirve ay 100 olacak biçimde ölçeklenir. (profil, yıl sayısı);
    veri kısa/eksikse ya da ilgi hep sıfırsa None (düşük hacimli kelimeler Google Trends'te 0 görünür)."""
    clean = [(d, v) for d, v in points if v is not None]
    if len({(d.year, d.month) for d, _ in clean}) < MIN_SEASON_MONTHS:
        return None
    by_month: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for d, v in clean:
        by_month[d.month].append(v)
    if any(not vals for vals in by_month.values()):
        return None
    means = [sum(by_month[m]) / len(by_month[m]) for m in range(1, 13)]
    peak = max(means)
    if peak <= 0:
        return None
    return [round(v / peak * 100) for v in means], len({d.year for d, _ in clean})


class DataForSeoProvider:
    name = "dataforseo"
    max_volume_terms = 1000
    max_trend_terms = 5  # Google Trends tek istekte en fazla 5 terim karşılaştırır

    def supports_market(self, market: str) -> bool:
        return market in LOCATIONS

    # ---- HTTP

    def _post(self, creds: Credentials, path: str, body: dict) -> tuple[dict, float, int]:
        started = time.monotonic()
        try:
            resp = httpx.post(f"{BASE}{path}", json=[body], auth=(creds.login, creds.password), timeout=TIMEOUT)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Bağlantı hatası: {type(exc).__name__}") from exc
        ms = int((time.monotonic() - started) * 1000)
        if resp.status_code in (401, 403):
            raise ProviderError("Kimlik bilgisi reddedildi", transient=False)
        if resp.status_code == 429 or resp.status_code >= 500:
            raise ProviderError(f"Sağlayıcı geçici hata ({resp.status_code})")
        try:
            data = resp.json()
        except ValueError as exc:
            raise ProviderError("Sağlayıcı geçersiz yanıt döndü") from exc
        tasks = data.get("tasks") or []
        task = tasks[0] if tasks else {}
        code = task.get("status_code") or data.get("status_code")
        if code != OK:
            message = str(task.get("status_message") or data.get("status_message") or "")[:200]
            raise ProviderError(f"Sağlayıcı hatası {code}: {message}", transient=code in _TRANSIENT_CODES, cost_usd=float(task.get("cost") or 0.0))
        return task, float(task.get("cost") or 0.0), ms

    # ---- Yetenekler

    def volumes(self, creds: Credentials, terms: list[str], market: str, language: str) -> ProviderResponse:
        endpoint = "keywords_data/google_ads/search_volume/live"
        body = {"keywords": terms[: self.max_volume_terms], "location_code": LOCATIONS[market], "language_code": language}
        task, cost, ms = self._post(creds, f"/{endpoint}", body)
        records = []
        for item in task.get("result") or []:
            term = normalize(item.get("keyword") or "")
            if not term:
                continue
            competition = item.get("competition_index")
            records.append(MetricRecord(
                term=term, search_volume=item.get("search_volume"), cpc=item.get("cpc"),
                competition=None if competition is None else competition / 100, monthly=_monthly(item.get("monthly_searches")),
            ))
        return ProviderResponse(endpoint=endpoint, records=records, cost_usd=cost, duration_ms=ms)

    def trends(self, creds: Credentials, terms: list[str], market: str, language: str) -> ProviderResponse:
        endpoint = "keywords_data/google_trends/explore/live"
        today = dt.date.today()
        body = {
            "keywords": terms[: self.max_trend_terms], "location_code": LOCATIONS[market], "language_code": language, "type": "web",
            "date_from": (today - dt.timedelta(days=TREND_HISTORY_DAYS)).isoformat(), "date_to": today.isoformat(), "item_types": ["google_trends_graph"],
        }
        task, cost, ms = self._post(creds, f"/{endpoint}", body)
        records: list[TrendRecord] = []
        for result in task.get("result") or []:
            for item in result.get("items") or []:
                if item.get("type") != "google_trends_graph":
                    continue
                names = [normalize(k) for k in item.get("keywords") or []]
                for i, term in enumerate(names):
                    series = []
                    for point in item.get("data") or []:
                        values = point.get("values") or []
                        if point.get("missing_data") or i >= len(values):
                            continue
                        try:
                            series.append((dt.date.fromisoformat(point["date_to"]), values[i]))
                        except (KeyError, ValueError):
                            continue
                    recent, previous = trend_windows(series)
                    records.append(TrendRecord(term=term, recent=recent, previous=previous))
        return ProviderResponse(endpoint=endpoint, trends=records, cost_usd=cost, duration_ms=ms)

    def seasonality(self, creds: Credentials, term: str, market: str, language: str) -> ProviderResponse:
        """Tek kelimeyle 5 yıllık haftalık ilgi (tek kelime: değerler yalnızca kendi zirvesine göre ölçeklenir, başka kelimeler profili bozmaz)."""
        endpoint = "keywords_data/google_trends/explore/live"
        body = {"keywords": [term], "location_code": LOCATIONS[market], "language_code": language, "type": "web", "time_range": "past_5_years", "item_types": ["google_trends_graph"]}
        task, cost, ms = self._post(creds, f"/{endpoint}", body)
        points: list[tuple[dt.date, float | None]] = []
        for result in task.get("result") or []:
            for item in result.get("items") or []:
                if item.get("type") != "google_trends_graph":
                    continue
                for point in item.get("data") or []:
                    values = point.get("values") or []
                    if point.get("missing_data") or not values:
                        continue
                    try:
                        # haftanın ortası: hafta iki aya taşarsa ortası, ait olduğu ayı belirler
                        points.append((dt.date.fromisoformat(point["date_from"]) + dt.timedelta(days=3), values[0]))
                    except (KeyError, ValueError):
                        continue
        profile = season_profile(points)
        record = SeasonRecord(term=normalize(term), monthly=profile[0] if profile else None, years=profile[1] if profile else 0)
        return ProviderResponse(endpoint=endpoint, seasons=[record], cost_usd=cost, duration_ms=ms)

    def suggestions(self, creds: Credentials, seed: str, market: str, language: str, limit: int, questions: bool = False) -> ProviderResponse:
        """Tohum kelimenin önerileri; tohumun kendi metrikleri de (ek istek olmadan) kayıtlara katılır. Normal listede yalnızca ÇEKİRDEK kelimeler istenir
        (`ignore_synonyms`): Google Ads yakın varyantlara aynı hacmi verir, çekirdek liste aynı sayıyı tekrar tekrar göstermez. Soru listesi (`questions`)
        sağlayıcıda soru kalıbı süzgecidir (hacimli varyantlar da kalır, çünkü soruların asıl değeri ifadelerinin kendisidir)."""
        endpoint = "dataforseo_labs/google/keyword_suggestions/live"
        body = {
            "keyword": seed, "location_code": LOCATIONS[market], "language_code": language, "limit": min(limit, 1000),
            "include_seed_keyword": True, "ignore_synonyms": not questions,
        }
        if questions:
            body["limit"] = min(limit, QUESTION_LIMIT)
            body["filters"] = ["keyword", "regex", QUESTION_REGEX]
        task, cost, ms = self._post(creds, f"/{endpoint}", body)
        records: list[MetricRecord] = []
        for result in task.get("result") or []:
            items = list(result.get("items") or [])
            if result.get("seed_keyword_data"):
                items.insert(0, result["seed_keyword_data"])
            for item in items:
                record = _labs_record(item)
                if record is not None and (not questions or is_question(record.term)):  # soru listesinde yalnızca gerçek sorular (süzgece güvenmeden doğrulanır)
                    records.append(record)
        return ProviderResponse(endpoint=endpoint, records=records, cost_usd=cost, duration_ms=ms)

    def account(self, creds: Credentials) -> dict:
        try:
            resp = httpx.get(f"{BASE}/appendix/user_data", auth=(creds.login, creds.password), timeout=TIMEOUT)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Bağlantı hatası: {type(exc).__name__}") from exc
        if resp.status_code in (401, 403):
            raise ProviderError("Kimlik bilgisi reddedildi", transient=False)
        try:
            result = ((resp.json().get("tasks") or [{}])[0].get("result") or [{}])[0]
        except (ValueError, IndexError, AttributeError) as exc:
            raise ProviderError("Hesap bilgisi okunamadı") from exc
        money = result.get("money") or {}
        return {"balance": money.get("balance"), "total": money.get("total"), "login": result.get("login")}

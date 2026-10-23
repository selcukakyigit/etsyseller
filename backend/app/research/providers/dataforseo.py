"""DataForSEO adapter'ı (v3, Live yöntemi): yanıtı ortak `MetricRecord`lara çevirir. Uç nokta ayrıntıları yalnızca burada bilinir.

Live yöntem seçildi çünkü Labs yalnızca Live çalışır ve istekler küçük/toplu yapılır; Live sonuçlar sağlayıcıda SAKLANMAZ, bu yüzden
her yanıt havuza yazılır (bkz. worker.py). Google Ads hacmi istek başına ücretlendirilir (1 ya da 1000 kelime aynı), bu yüzden kelimeler
mümkün olduğunca tek istekte toplanır; Google Ads Live uç noktasında dakikada 12 istek sınırı vardır."""
import time

import httpx

from app.research.providers.base import Credentials
from app.research.terms import normalize
from app.research.records import MetricRecord, ProviderError, ProviderResponse

BASE = "https://api.dataforseo.com/v3"
TIMEOUT = 60.0
OK = 20000
# Geçici sayılan görev durum kodları (hız sınırı, sunucu tarafı hata); geri kalan 4xxxx kodları kalıcı hatadır (kimlik, parametre, bakiye).
_TRANSIENT_CODES = {40202, 50000, 50301, 50302, 50303}

LOCATIONS = {"US": 2840, "GB": 2826, "CA": 2124, "AU": 2036, "DE": 2276, "FR": 2250, "TR": 2792}


def _monthly(items: list[dict] | None) -> list[list[int]] | None:
    rows = [[m["year"], m["month"], m["search_volume"]] for m in items or [] if m.get("search_volume") is not None]
    return rows or None


def _intent(item: dict) -> str | None:
    return ((item.get("search_intent_info") or {}).get("main_intent")) or None


class DataForSeoProvider:
    name = "dataforseo"
    max_volume_terms = 1000

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
            raise ProviderError(f"Sağlayıcı hatası {code}: {message}", transient=code in _TRANSIENT_CODES)
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

    def suggestions(self, creds: Credentials, seed: str, market: str, language: str, limit: int) -> ProviderResponse:
        endpoint = "dataforseo_labs/google/keyword_suggestions/live"
        body = {
            "keyword": seed, "location_code": LOCATIONS[market], "language_code": language, "limit": min(limit, 1000),
            "include_seed_keyword": False, "ignore_synonyms": False,
        }
        task, cost, ms = self._post(creds, f"/{endpoint}", body)
        records = []
        for result in task.get("result") or []:
            for item in result.get("items") or []:
                term = normalize(item.get("keyword") or "")
                if not term:
                    continue
                info = item.get("keyword_info") or {}
                props = item.get("keyword_properties") or {}
                competition = info.get("competition")
                records.append(MetricRecord(
                    term=term, search_volume=info.get("search_volume"), cpc=info.get("cpc"),
                    competition=competition if isinstance(competition, (int, float)) else None,
                    difficulty=props.get("keyword_difficulty"), intent=_intent(item), monthly=_monthly(info.get("monthly_searches")),
                ))
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

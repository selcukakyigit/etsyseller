"""Testlerde kullanılan sahte araştırma sağlayıcısı: çağrıları kaydeder, hata enjekte edilebilir."""
from app.research.records import MetricRecord, ProviderResponse, TrendRecord


class FakeProvider:
    name = "dataforseo"
    max_volume_terms = 1000
    max_trend_terms = 5

    def __init__(self):
        self.calls: list[tuple[str, object]] = []
        self.fail: Exception | None = None
        self.volume = 100  # volumes() her kelime için bunu döner
        self.empty_seeds: set[str] = set()  # öneri döndürmeyen tohumlar
        self.no_data: set[str] = set()  # hacim kaydı hiç dönmeyen kelimeler
        self.trend_values = {"a": (10.0, 20.0), "b": (10.0, 2.0), "c": (30.0, 30.0)}

    def supports_market(self, market: str) -> bool:
        return market == "US"

    def _maybe_fail(self):
        if self.fail:
            raise self.fail

    def volumes(self, creds, terms, market, language):
        self.calls.append(("volume", list(terms)))
        self._maybe_fail()
        records = [MetricRecord(t, search_volume=self.volume, cpc=0.5) for t in terms if t not in self.no_data]
        return ProviderResponse("fake/volume", records, 0.09, 5)

    def suggestions(self, creds, seed, market, language, limit, questions=False):
        self.calls.append(("questions" if questions else "suggest", seed))
        self._maybe_fail()
        if seed in self.empty_seeds:
            return ProviderResponse("fake/suggest", [], 0.01, 5)
        if questions:
            return ProviderResponse("fake/questions", [MetricRecord(f"how to use {seed}", search_volume=260), MetricRecord(f"what is {seed}", search_volume=90)], 0.02, 5)
        # 12 ay: ilk 3 ay 100, son 3 ay 200 (+%100 eğilim)
        monthly = [[2025, m, 100] for m in (11, 12)] + [[2026, 1, 100]] + [[2026, m, 150] for m in range(2, 8)] + [[2026, m, 200] for m in (8, 9, 10)]
        records = [MetricRecord(seed, search_volume=210, intent="commercial", cpc=0.84, competition=1.0, monthly=monthly)]
        records += [MetricRecord(f"{seed} {w}", search_volume=v, intent=i, cpc=0.5, competition=0.2) for w, v, i in (
            ("big", 5000, "transactional"), ("mid", 300, "informational"), ("tiny", 20, None), ("custom", 80, "weird"),
        )]
        return ProviderResponse("fake/suggest", records, 0.013, 5)

    def trends(self, creds, terms, market, language):
        self.calls.append(("trend", list(terms)))
        self._maybe_fail()
        records = [TrendRecord(t, *self.trend_values[t]) for t in terms if t in self.trend_values]
        return ProviderResponse("fake/trends", trends=records, cost_usd=0.011, duration_ms=5)

    def account(self, creds):
        return {"balance": 1}

    def count(self, kind: str) -> int:
        return sum(1 for k, _ in self.calls if k == kind)

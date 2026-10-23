"""Sıra takibi dürüstlüğü: API sırası sitedeki alıcı sırasıyla uyuşmadığı için teşhis ondan hüküm ya da oy üretmez."""
import datetime as dt
from types import SimpleNamespace as NS

from app.assistant.toolsets import rank as rank_tools
from app.insights import diagnosis, rank


def _keyword(position, change_30d=None, price=90.0, median=43.0):
    return {
        "keyword": "personalized metal farm sign", "measured": "2026-10-23", "position": position, "change_7d": None, "change_30d": change_30d, "total_results": 11756,
        "own_price": price, "top_price_median": median, "currency": "USD", "history": [],
    }


def _ctx(status="declining"):
    return NS(db=None, shop=NS(id=1), listing_id=5, today=dt.date(2026, 10, 24), status=status)


def _signal(monkeypatch, keywords, status="declining"):
    data = {"keywords": keywords, "is_tracked": True, "max_results": 200}
    monkeypatch.setattr(rank, "listing_ranks", lambda *a, **k: data)
    return diagnosis.rank_signal(_ctx(status))


def test_lost_or_dropped_rank_is_information_not_a_verdict(monkeypatch):
    evidence, votes = _signal(monkeypatch, [_keyword(None, change_30d=-30)])
    assert votes == [], "kayboldu oyu verilmez"
    assert all(e.tone == "info" for e in evidence), "bad/good hükmü yok"
    assert any("API" in e.text for e in evidence), "sırası API sırası olarak etiketlenir"


def test_first_page_rank_does_not_claim_buyers_see_it(monkeypatch):
    evidence, votes = _signal(monkeypatch, [_keyword(5)])
    assert votes == [] and all(e.tone == "info" for e in evidence)
    assert not any("alıcılar görüyor" in e.text or "first page of search" in e.text for e in evidence)


def test_price_gap_vs_the_api_sample_is_only_indicative(monkeypatch):
    evidence, votes = _signal(monkeypatch, [_keyword(55, price=90.0, median=43.0)])
    price = [e for e in evidence if e.kind == "price"]
    assert price and price[0].tone == "info" and votes == [], "örneğe göre pahalı demek oy/hüküm değildir"
    assert "örnek" in price[0].text


def test_assistant_rank_overview_says_it_is_the_api_order(db, monkeypatch):
    monkeypatch.setattr(rank, "tracked_listing_ids", lambda *a, **k: [5])
    monkeypatch.setattr(rank, "listing_ranks", lambda *a, **k: {"keywords": [_keyword(None, change_30d=-12)]})
    out = rank_tools.rank_overview(NS(db=db, shop=NS(id=1), today=dt.date(2026, 10, 24)), {})
    assert "API" in out["not"] and "DEĞİL" in out["not"]

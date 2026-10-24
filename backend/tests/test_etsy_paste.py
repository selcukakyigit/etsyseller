"""Etsy panelinden kopyalanan metnin kural tabanlı okunması: tür başlıktan, satırlar sütun sırasından; yapay zekâ çağrılmaz."""
import datetime as dt

from app.insights import etsy_data, etsy_paste

INSIGHTS = """Your search
Searches
Search results
Conversion rate
metal garage sign
1.3k
↓
-43.6%
67.8k
Very low
Similar search terms
Searches
Search results
Conversion rate
custom tin sign
147
11.5k
Very high
metal signs for home
121
512.1k
Very high
personalized metal plaque
34
108.1k
High
"""

ADS = """Targeted keywords and orders over the last 30 days

Collapse data

Targeted keywords (27)
All keywords
Targeted keyword	ROAS	Orders	Spend	Revenue	Clicks	Click rate	Views
Relevant keyword

workshop sign

0

0

$0	$0
0

0%	9

Relevant keyword
personalized garage sign

0

2

$2	$40
1

3.1%	32

Relevant keyword
garage sign personalized

0

0

$0	$0
0

0%	5

Previous
1
2
Next
Relevant keyword
truncated row
0
"""


def test_insights_rows_columns_and_trend():
    out = etsy_paste.parse_text(INSIGHTS)
    assert out["source"] == "marketplace_insights" and out["period_start"] is None
    rows = {r["keyword"]: r for r in out["rows"]}
    assert len(rows) == 4
    assert rows["metal garage sign"] == {"keyword": "metal garage sign", "searches": 1300, "trend_pct": -44, "listings_count": 67800, "conversion": "very_low"}
    assert rows["metal signs for home"]["listings_count"] == 512100 and rows["metal signs for home"]["conversion"] == "very_high"
    assert rows["personalized metal plaque"]["conversion"] == "high"


def test_insights_glued_trend_on_one_line():
    out = etsy_paste.parse_text("Searches\nSearch results\nConversion rate\nmetal garage sign\t1.3k ↓ -43.6%\t67.8k\tVery low\n")
    assert out["rows"][0]["searches"] == 1300 and out["rows"][0]["trend_pct"] == -44 and out["rows"][0]["listings_count"] == 67800


def test_ads_rows_period_and_truncated_row_skipped():
    out = etsy_paste.parse_text(ADS, dt.date(2026, 10, 24))
    assert out["source"] == "ads"
    assert (out["period_start"], out["period_end"]) == ("2026-09-25", "2026-10-24")
    assert [(r["keyword"], r["views"], r["clicks"], r["orders"]) for r in out["rows"]] == [
        ("workshop sign", 9, 0, 0), ("personalized garage sign", 32, 1, 2), ("garage sign personalized", 5, 0, 0),
    ]


def test_unknown_text_is_left_to_the_ai():
    assert etsy_paste.parse_text("custom metal sign\nvisits 12") is None


def test_coerce_source_fixes_a_wrong_guess_by_row_shape():
    assert etsy_paste.coerce_source({"source": "search_terms", "rows": [{"keyword": "a", "searches": 10, "listings_count": 5}]}) == "marketplace_insights"
    assert etsy_paste.coerce_source({"source": "search_terms", "rows": [{"keyword": "a", "views": 10, "clicks": 1}]}) == "ads"
    assert etsy_paste.coerce_source({"source": "search_terms", "rows": [{"keyword": "a", "views": 10}]}) == "search_terms"


def test_parse_uses_the_rules_without_calling_the_ai(monkeypatch):
    monkeypatch.setattr(etsy_data, "_ai", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the AI must not be called")))
    out = etsy_data.parse(INSIGHTS)
    assert out["source"] == "marketplace_insights" and len(out["rows"]) == 4
    assert out["rows"][0]["trend_pct"] == -44

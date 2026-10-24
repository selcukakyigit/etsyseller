"""Kalabalık sayacı ve sonuç kanıtı: yalnızca sayı, farklı mağaza sayımı, kesinleşmiş ölçümler, puana etkisi."""
import json

from app.keywords import scoring
from app.listings.models import ListingChange, ListingVersion
from app.research import admin, exposure, outcomes, pool


def _suggestion(db, shop, tags):
    db.add(ListingVersion(
        shop_id=shop, listing_id=1, kind="ai_suggestion", original_title="t", original_tags="[]", original_description="d",
        suggested_title="t", suggested_tags=json.dumps(tags), suggested_description="d", created_by=1,
    ))


def _change(db, shop, added, verdict=None, final=True, source="ai", fields=("title", "tags")):
    result = None if verdict is None else json.dumps({"status": "measured", "final": final, "verdict": verdict})
    db.add(ListingChange(shop_id=shop, listing_id=shop * 10, source=source, fields=json.dumps(list(fields)), details=json.dumps({"tags_added": added}), result_json=result))


def test_exposure_counts_distinct_shops_not_repeated_generations(db):
    for shop in (1, 2, 3):
        _suggestion(db, shop, ["Metal Wall Art", "farm sign"])
    for _ in range(5):
        _suggestion(db, 1, ["metal wall art"])  # aynı mağaza tekrar tekrar üretti
    db.commit()
    assert exposure.rebuild(db) == 2
    assert exposure.counts(db, ["metal wall art", "FARM SIGN", "never suggested"]) == {"metal wall art": 3, "farm sign": 3}


def test_crowded_phrase_scores_lower_and_is_flagged_without_numbers():
    base = {"source": "competitor", "score": 5, "sample_size": 50, "etsy_searches": 1000, "etsy_results": 20000}
    crowded = {**base, "tag": "metal wall art", "crowd": 1.0, "crowd_shops": 30}
    unique = {**base, "tag": "rusty barn sign", "crowd": 0.0}
    plain = {**base, "tag": "rusty barn sign"}
    assert scoring.score(crowded)[0] < scoring.score(plain)[0] < scoring.score(unique)[0]
    from app.listing_plan import facts, plan

    pool = [crowded, {**unique, "tag": "metal barn sign"}]
    brief = plan.build(pool, facts.from_listing("Metal wall art", "metal barn sign"), key="k", research=([], [], 0), use_ideas=False).brief()
    assert "30" not in brief  # kalabalık sayısı modele hiç gitmez


def test_outcomes_count_only_final_measured_ai_tag_changes(db):
    _change(db, 1, ["Metal Farm Sign", "barn decor"], "better")
    _change(db, 2, ["metal farm sign"], "worse")
    _change(db, 3, ["metal farm sign"], "better", final=False)  # kesinleşmemiş: ölçüm sayılmaz, uygulandı sayılır
    _change(db, 4, ["metal farm sign"], None)  # henüz ölçülmedi
    _change(db, 5, ["metal farm sign"], "better", source="manual")  # manuel: sayılmaz
    _change(db, 6, ["metal farm sign"], "better", fields=("title",))  # etiket değişmedi
    _change(db, 1, ["metal farm sign"], "better")  # aynı mağaza tekrar: bir kez sayılır
    db.commit()
    assert outcomes.rebuild(db) == 2
    result = outcomes.for_term(db, "METAL farm sign")
    assert (result.applied, result.measured, result.better, result.worse) == (4, 2, 1, 1)
    assert outcomes.for_term(db, "unknown") is None


def test_admin_keyword_detail_exposes_signals_as_counts(db):
    _change(db, 1, ["metal farm sign"], "better")
    db.commit()
    outcomes.rebuild(db)
    term = pool.get_or_create_terms(db, ["metal farm sign"], "en", "t")["metal farm sign"]
    db.commit()
    detail = admin.keyword_detail(db, term.id, "US")
    assert detail.signals.applied == 1 and detail.signals.better == 1

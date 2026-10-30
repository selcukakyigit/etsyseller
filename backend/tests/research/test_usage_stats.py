"""Kullanım ölçümü: Keşfet aramaları ve hacim bakışları sayılır; yoklamalar tek arama sayılır; sayaçlar toplu yazılır, mağaza kimliği tutulmaz."""
from sqlalchemy import delete, select

from app.research import discover, service, stats, worker
from app.research.models import ProviderCall, SearchDaily, UsageDaily
from tests.research.test_discover import SHOP_A  # sahte mağaza (aynı yardımcı)


def _events(db):
    return {r.event: r.n for r in db.scalars(select(UsageDaily))}


def test_search_counts_once_while_the_screen_polls_and_flushes_in_one_batch(db, provider):
    shop = SHOP_A
    first = discover.search(db, shop, "metal garage sign")
    assert first.status == "pending"
    for _ in range(3):  # ekran sonuç gelene kadar yoklar: yeni arama sayılmaz
        discover.search(db, shop, "metal garage sign")
    assert stats.flush(db) >= 2
    rows = db.scalars(select(SearchDaily)).all()
    assert [(r.term, r.n) for r in rows] == [("metal garage sign", 1)]
    assert _events(db).get(stats.SEARCH_MISS) == 1  # ilk bakışta havuzda yoktu: sağlayıcı gerekti


def test_second_search_after_the_pool_filled_counts_as_a_hit(db, provider):
    shop = SHOP_A
    discover.search(db, shop, "metal garage sign")
    worker.run_once(db)
    discover.search(db, shop, "metal garage sign")  # liste hazır: tohumun mevsimsellik işi kuyruğa girer
    worker.run_once(db)
    stats.flush(db)
    db.execute(delete(UsageDaily))  # yalnızca yeni ziyaretin sayılması için sıfırla
    db.commit()
    stats.reset()  # yeni bir ziyaret: önceki yoklama penceresi kapanmış say
    again = discover.search(db, shop, "metal garage sign")
    assert again.status == "ready" and not again.stale
    stats.flush(db)
    assert _events(db) == {stats.SEARCH_HIT: 1}


def test_invalid_search_is_not_counted_and_no_shop_id_is_stored(db, provider):
    shop = SHOP_A
    assert discover.search(db, shop, "  ").status == "invalid"
    stats.flush(db)
    assert db.scalars(select(SearchDaily)).all() == []
    assert not {"shop_id", "workspace_id"} & set(SearchDaily.__table__.c.keys())  # yalnızca sayı


def test_volume_lookups_are_tracked_but_system_warming_is_not(db, provider):
    service.volumes(db, ["a b", "c d"])
    service.volumes(db, ["e f"], track=False)
    stats.flush(db)
    assert _events(db) == {stats.VOLUME_MISS: 2}


def test_flush_adds_to_existing_rows_and_keeps_counts_on_failure(db, provider, monkeypatch):
    stats.count("x", 2)
    stats.flush(db)
    stats.count("x", 3)
    stats.flush(db)
    assert _events(db) == {"x": 5}

    stats.count("y", 4)
    monkeypatch.setattr(stats, "_bump", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    try:
        stats.flush(db)
    except RuntimeError:
        pass
    monkeypatch.undo()
    stats.flush(db)  # sayaç kaybolmadı, sonraki turda yazılır
    assert _events(db)["y"] == 4


def test_provider_calls_record_the_job_kind(db, provider):
    service.volumes(db, ["a b"])
    worker.run_once(db)
    assert [c.kind for c in db.scalars(select(ProviderCall))] == ["volume"]

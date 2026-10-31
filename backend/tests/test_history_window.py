"""Bağlanınca seçilen geçmiş süresi: seçilmeden geçmiş inmez; seçilince yalnızca o dönem iner, sayılar o döneme göre tutulur, geçmiş inince finans tam taranır."""
import datetime as dt
from types import SimpleNamespace

import pytest

from app.auth.models import User, Workspace, WorkspaceMember
from app.finance import service as finance
from app.orders import service as orders
from app.orders.models import OrderCache
from app.shops import router as shops_router
from app.shops.models import Shop

NOW = dt.datetime.utcnow()
AGES = [100 * i for i in range(1, 31)]  # gün: 100, 200 … 3000 (yaklaşık 8 yıl)


def _receipt(n: int, age_days: int) -> dict:
    ts = int((NOW - dt.timedelta(days=age_days)).replace(tzinfo=dt.timezone.utc).timestamp())
    return {
        "receipt_id": 1000 + n, "status": "Completed", "name": f"Buyer {n}", "grandtotal": {"amount": 2500, "divisor": 100, "currency_code": "USD"},
        "is_paid": True, "is_shipped": True, "created_timestamp": ts, "transactions": [],
    }


RECEIPTS = [_receipt(n, age) for n, age in enumerate(AGES, start=1)]  # en yeniden eskiye


class FakeEtsy:
    """Etsy sipariş uç noktasının küçük bir benzeri: min_created, limit, offset ve was_shipped süzgeçlerini uygular."""
    calls: list[dict] = []

    def __init__(self, db, shop):
        self.shop = shop

    def request(self, method, path, params=None, **kw):
        p = dict(params or {})
        FakeEtsy.calls.append(p)
        rows = [r for r in RECEIPTS if r["created_timestamp"] >= int(p.get("min_created", 0))]
        if p.get("was_shipped") == "false":
            rows = [r for r in rows if not r["is_shipped"]]
        if "min_last_modified" in p:
            rows = []
        off, lim = int(p.get("offset", 0)), int(p.get("limit", 100))
        return {"count": len(rows), "results": rows[off : off + lim]}


class StubThread:
    started: list = []

    def __init__(self, target=None, args=(), daemon=None):
        self.target, self.args = target, args

    def start(self):
        StubThread.started.append((self.target.__name__, self.args))


@pytest.fixture
def env(db, monkeypatch):
    FakeEtsy.calls, StubThread.started = [], []
    full_syncs = []
    monkeypatch.setattr(orders, "EtsyClient", FakeEtsy)
    monkeypatch.setattr(orders.threading, "Thread", StubThread)
    monkeypatch.setattr(finance, "start_sync", lambda shop, full=False: full_syncs.append((shop.id, full)) or True)
    orders._backfill_state.clear()
    user = User(supabase_id="sb-h", email="h@x.co", name="H")
    ws = Workspace(name="W")
    db.add_all([user, ws])
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    shop = Shop(user_id=user.id, workspace_id=ws.id, etsy_shop_id=77, etsy_user_id=1, shop_name="S")
    db.add(shop)
    db.commit()
    return SimpleNamespace(shop=shop, full_syncs=full_syncs)


def _count(db, shop):
    return db.query(OrderCache).filter_by(shop_id=shop.id).count()


def test_pending_choice_downloads_no_history(db, env):
    orders.sync_orders(db, env.shop, limit=5)
    assert _count(db, env.shop) == 5
    assert StubThread.started == []  # seçim yapılmadı: geçmiş indirme başlamaz


def test_one_year_window_downloads_only_that_year(db, env):
    env.shop.history_years = 1
    db.commit()
    orders.sync_orders(db, env.shop, limit=2)
    assert StubThread.started == [("_backfill", (env.shop.id,))]
    orders._backfill(env.shop.id)
    assert _count(db, env.shop) == 3  # 100, 200 ve 300 gün önceki (365 günün içinde)
    assert all(p.get("min_created") for p in FakeEtsy.calls if p.get("offset") is not None and "was_shipped" not in p and p.get("limit") == 100)
    assert (env.shop.id, True) in env.full_syncs  # geçmiş indi: finans tam taranır


def test_status_counts_are_for_the_window(db, env):
    env.shop.history_years = 2
    db.commit()
    orders.sync_orders(db, env.shop, limit=3)
    status = orders.sync_status(db, env.shop)
    assert status.remote_total == 7  # 100..700 gün
    assert status.local == 3
    orders._backfill(env.shop.id)
    status = orders.sync_status(db, env.shop)
    assert (status.local, status.remote_total) == (7, 7)  # "Etsy'de X, yerelde Y" uyarısı çıkmaz


def test_all_history_and_no_second_backfill_when_complete(db, env):
    env.shop.history_years = 0
    db.commit()
    orders.sync_orders(db, env.shop, limit=4)
    orders._backfill(env.shop.id)
    assert _count(db, env.shop) == 30
    StubThread.started.clear()
    orders._backfill_state[env.shop.id]["running"] = False
    orders.sync_orders(db, env.shop, limit=4)
    assert StubThread.started == []  # her şey inmiş: tekrar indirme yok


def test_extending_the_window_downloads_the_missing_years(db, env):
    env.shop.history_years = 1
    db.commit()
    orders.sync_orders(db, env.shop, limit=3)
    orders._backfill(env.shop.id)
    assert _count(db, env.shop) == 3
    env.shop.history_years = 3
    db.commit()
    StubThread.started.clear()
    orders._backfill_state[env.shop.id]["running"] = False
    orders.sync_orders(db, env.shop, limit=3)
    assert StubThread.started == [("_backfill", (env.shop.id,))]
    orders._backfill(env.shop.id)
    assert _count(db, env.shop) == 10  # 1000 güne kadar


def test_history_endpoint_validates_and_starts_the_download(db, env, monkeypatch):
    started = []
    monkeypatch.setattr(orders, "start_history_sync", lambda shop_id: started.append(shop_id))
    out = shops_router.set_history(shops_router.HistoryIn(years=2), shop=env.shop, db=db)
    assert out == {"history_years": 2} and started == [env.shop.id]
    with pytest.raises(Exception) as bad:
        shops_router.set_history(shops_router.HistoryIn(years=7), shop=env.shop, db=db)
    assert getattr(bad.value, "status_code", None) == 422
    env.shop.is_demo = True
    with pytest.raises(Exception) as demo:
        shops_router.set_history(shops_router.HistoryIn(years=1), shop=env.shop, db=db)
    assert getattr(demo.value, "status_code", None) == 400


def test_full_sync_requested_while_running_is_not_lost(db, env, monkeypatch):
    monkeypatch.undo()  # bu testte gerçek start_sync/_run kullanılır
    runs = []
    monkeypatch.setattr(finance, "EtsyClient", lambda db_, shop_: None)
    monkeypatch.setattr(finance, "_sync_ledger", lambda db_, client, shop_, st, full: runs.append(full))
    monkeypatch.setattr(finance, "_sync_payments", lambda *a: None)
    monkeypatch.setattr(finance, "_link_receipts", lambda *a: None)
    st = finance._state.setdefault(env.shop.id, {})
    st.clear()
    st["running"] = True
    assert finance.start_sync(env.shop, full=True) is False and st.get("full_again") is True
    finance._run(env.shop.id, False)  # çalışan senkron biter...
    assert runs == [False, True]  # ...ve istenen tam senkron arkasından çalışır
    assert not st.get("running") and not st.get("full_again")

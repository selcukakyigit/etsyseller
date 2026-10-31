"""Örnek mağaza açma/kapama kuralları."""
import pytest

from app.auth.models import User, Workspace, WorkspaceMember
from app.auth.workspaces import primary_workspace
from app.demo import seed
from app.demo.service import SampleError, create_sample_shop, remove_sample_shops
from app.listings.models import ListingCache
from app.orders.models import OrderCache
from app.shops.models import Shop


def _user(db, n):
    user = User(supabase_id=f"sb-{n}", email=f"u{n}@x.co", name=f"U{n}")
    ws = Workspace(name=f"W{n}")
    db.add_all([user, ws])
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    db.commit()
    return user


def test_sample_shop_is_created_once_per_workspace(db):
    user = _user(db, 1)
    first = create_sample_shop(db, user)
    again = create_sample_shop(db, user)
    assert first.id == again.id and first.is_demo and first.etsy_shop_id < 0
    assert db.query(ListingCache).filter_by(shop_id=first.id).count() == 5


def test_two_users_get_separate_sample_shops(db):
    a, b = create_sample_shop(db, _user(db, 1)), create_sample_shop(db, _user(db, 2))
    assert a.id != b.id and a.etsy_shop_id != b.etsy_shop_id
    assert db.query(OrderCache).filter_by(shop_id=a.id).count() == seed.N_ORDERS == db.query(OrderCache).filter_by(shop_id=b.id).count()


def test_not_allowed_when_a_real_shop_exists(db):
    user = _user(db, 1)
    ws = primary_workspace(db, user)
    db.add(Shop(user_id=user.id, workspace_id=ws.id, etsy_shop_id=123, etsy_user_id=1, shop_name="Real"))
    db.commit()
    with pytest.raises(SampleError):
        create_sample_shop(db, user)


def test_removal_deletes_sample_data_only_in_that_workspace(db):
    a, b = _user(db, 1), _user(db, 2)
    sa_id, sb_id = create_sample_shop(db, a).id, create_sample_shop(db, b).id
    assert remove_sample_shops(db, primary_workspace(db, a).id) == 1
    assert db.query(Shop).filter_by(id=sa_id).count() == 0
    assert db.query(ListingCache).filter_by(shop_id=sa_id).count() == 0
    assert db.query(ListingCache).filter_by(shop_id=sb_id).count() == 5  # diğer hesaba dokunulmaz


def test_reviewer_demo_shop_survives_real_shop_connect(db):
    """İncelemeci hesabının demo mağazası (-3e9 aralığı) kendi Etsy'sini bağlayanda silinmez."""
    user = _user(db, 1)
    ws = primary_workspace(db, user)
    reviewer = Shop(user_id=user.id, workspace_id=ws.id, etsy_shop_id=-(seed.REVIEWER_ID_BASE + ws.id), etsy_user_id=-1, shop_name="R", is_demo=True)
    db.add(reviewer)
    db.commit()
    seed.seed_shop(db, reviewer)
    assert remove_sample_shops(db, ws.id) == 0
    assert db.query(ListingCache).filter_by(shop_id=reviewer.id).count() == 5

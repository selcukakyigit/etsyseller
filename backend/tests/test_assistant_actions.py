"""Düğmeli onay (assistant/actions.py) ve taslak silme: araç silmez, onay kartı üretir; silme yalnızca düğme isteğiyle olur, yayındaki listing asla silinmez.
Ayrıca her listing aracının toplu işte izinli/yasaklı olarak sınıflandırıldığı denetlenir."""
import json

import pytest
from fastapi.testclient import TestClient

from app.assistant import actions, batch_drafts, tools
from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
from app.listings.models import ListingLocal
from app.shops.deps import get_owned_shop
from app.shops.models import Shop


def _shop(db, n=1):
    shop = Shop(user_id=1, workspace_id=n, etsy_shop_id=2000 + n, etsy_user_id=7, shop_name=f"Shop {n}")
    db.add(shop)
    db.commit()
    return shop


def _draft(db, shop, lid, title):
    db.add(ListingLocal(shop_id=shop.id, listing_id=lid, data_json=json.dumps({"title": title})))
    db.commit()


@pytest.fixture
def ctx(db, monkeypatch):
    shop = _shop(db)
    monkeypatch.setattr(tools, "_draft_work", lambda c, lid: json.loads(db.query(ListingLocal).filter_by(shop_id=shop.id, listing_id=lid).one().data_json))
    return tools.Ctx(db=db, shop=shop, user_id=5, today=None)


def _exists(db, shop, lid):
    db.expire_all()
    return db.query(ListingLocal).filter_by(shop_id=shop.id, listing_id=lid).first() is not None


def test_the_tool_never_deletes_it_only_shows_a_confirmation_card(db, ctx):
    _draft(db, ctx.shop, -11, "Tumbler")
    _draft(db, ctx.shop, -12, "Pillow")
    out = tools.delete_listing(ctx, {"listing_ids": [-11, -12, -99]})
    assert out["onay_bekliyor"] and out["taslak_sayisi"] == 2 and out["bulunamayan"] == [-99]
    card = ctx.cards[0]
    assert card["type"] == "confirm_action" and card["kind"] == "delete_drafts" and card["status"] == "pending"
    assert [i["title"] for i in card["items"]] == ["Tumbler", "Pillow"]
    assert _exists(db, ctx.shop, -11) and _exists(db, ctx.shop, -12), "düğmeye basılmadan hiçbir şey silinmez"
    assert "confirm" not in json.dumps([t for t in tools.TOOLS if t["name"] == "delete_listing"]), "modelin kendi onaylayabileceği confirm alanı yok"


def test_published_listings_and_bad_input_are_refused_in_code(db, ctx):
    assert "Etsy'de yayında" in tools.delete_listing(ctx, {"listing_id": 123456})["error"]
    assert "Etsy'de yayında" in tools.delete_listing(ctx, {"listing_ids": [-5, 123456]})["error"], "karışık listede de hiçbiri silinmez"
    assert tools.delete_listing(ctx, {})["error"] and tools.delete_listing(ctx, {"listing_id": "x"})["error"]
    assert tools.delete_listing(ctx, {"listing_ids": list(range(-1, -60, -1))})["error"], "en fazla 50"
    assert tools.delete_listing(ctx, {"listing_id": -404})["error"], "olmayan taslak"
    assert ctx.cards == []


def test_confirming_deletes_once_cancelling_deletes_nothing_and_other_shops_cannot_touch_it(db, ctx):
    _draft(db, ctx.shop, -21, "A")
    _draft(db, ctx.shop, -22, "B")
    other = _shop(db, 2)
    _draft(db, other, -23, "Other shop")
    tools.delete_listing(ctx, {"listing_ids": [-21, -22]})
    action = actions.get(ctx.cards[0]["action_id"], ctx.shop.id)
    assert actions.get(action.id, other.id) is None, "başka mağaza eylemi göremez"
    done = actions.confirm(db, ctx.shop, action)
    assert done["status"] == "done" and done["result"] == {"deleted": [-21, -22], "skipped": []}
    assert not _exists(db, ctx.shop, -21) and not _exists(db, ctx.shop, -22) and _exists(db, other, -23)
    again = actions.confirm(db, ctx.shop, action)
    assert again["result"] == done["result"], "ikinci tıklama aynı işi yeniden yapmaz"

    _draft(db, ctx.shop, -31, "C")
    tools.delete_listing(ctx, {"listing_id": -31})
    second = actions.get(ctx.cards[1]["action_id"], ctx.shop.id)
    actions.cancel(second)
    assert actions.confirm(db, ctx.shop, second)["status"] == "cancelled" and _exists(db, ctx.shop, -31), "vazgeçilen eylem sonradan onaylanamaz"


def test_the_handler_itself_skips_foreign_published_and_unknown_ids(db, ctx):
    other = _shop(db, 2)
    _draft(db, other, -41, "Foreign draft")
    _draft(db, ctx.shop, -42, "Mine")
    result = actions._delete_drafts(db, ctx.shop, {"listing_ids": [-41, 555, -42, -43, "x"]})
    assert result == {"deleted": [-42], "skipped": [-41, 555, -43, "x"]}, "düğme isteği dışarıdan gelir: işlev sahipliği ve türü kendisi doğrular"
    assert _exists(db, other, -41)


def test_an_expired_action_does_nothing(db, ctx):
    _draft(db, ctx.shop, -51, "Late")
    tools.delete_listing(ctx, {"listing_id": -51})
    action = actions.get(ctx.cards[0]["action_id"], ctx.shop.id)
    action.created -= actions.TTL_SECONDS + 1
    assert actions.get(action.id, ctx.shop.id).status == "expired"
    assert actions.confirm(db, ctx.shop, action)["status"] == "expired" and _exists(db, ctx.shop, -51)


def test_the_http_endpoints_confirm_and_cancel(db, ctx):
    from app import main

    _draft(db, ctx.shop, -61, "One")
    _draft(db, ctx.shop, -62, "Two")
    tools.delete_listing(ctx, {"listing_id": -61})
    tools.delete_listing(ctx, {"listing_id": -62})
    confirm_id, cancel_id = (c["action_id"] for c in ctx.cards)

    def _db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[get_current_user] = lambda: type("U", (), {"id": 5, "is_admin": False})()
    main.app.dependency_overrides[get_owned_shop] = lambda: ctx.shop
    try:
        client = TestClient(main.app)
        base = f"/api/shops/{ctx.shop.id}/assistant/actions"
        assert client.post(f"{base}/nope/confirm").status_code == 404
        assert client.post(f"{base}/{confirm_id}/confirm").json()["result"]["deleted"] == [-61]
        assert client.post(f"{base}/{cancel_id}/cancel").json()["status"] == "cancelled"
        assert client.post(f"{base}/{cancel_id}/confirm").json()["status"] == "cancelled"
    finally:
        main.app.dependency_overrides.clear()
    assert not _exists(db, ctx.shop, -61) and _exists(db, ctx.shop, -62)


def test_every_listing_tool_is_classified_for_batch_runs():
    """Yeni bir listing aracı eklenince toplu işte kullanılıp kullanılmayacağına karar verilmek zorunda (batch_drafts.ITEM_TOOLS ya da BATCH_DENIED)."""
    listing_tools = tools.LISTING_TOOL_NAMES
    unclassified = listing_tools - batch_drafts.ITEM_TOOLS - batch_drafts.BATCH_DENIED
    assert not unclassified, f"Toplu işte izinli mi yasaklı mı karar ver (batch_drafts.py): {sorted(unclassified)}"
    assert not batch_drafts.ITEM_TOOLS & batch_drafts.BATCH_DENIED
    assert not batch_drafts.BATCH_DENIED - listing_tools, "BATCH_DENIED'da artık olmayan araç adı var"
    assert not batch_drafts.ITEM_TOOLS - set(tools.EXECUTORS)
    for dangerous in ("publish_listing_draft", "delete_listing", "ask_user", "generate_listing_video"):
        assert dangerous in batch_drafts.BATCH_DENIED


def test_group_patterns_contain_no_control_characters():
    """Kalıplara yanlışlıkla geri-silme karakteri (\x08, '\b' kaçışının bozulmuş hâli) girmesin: böyle bir kalıp sessizce hiç eşleşmez."""
    for name, pattern in tools.GROUP_WORDS.items():
        assert "\x08" not in pattern.pattern, name
    assert "support" in tools.listing_groups("destek talebi aç, bir ticket oluştur", None)
    assert "support" in tools.listing_groups("open a support ticket", None)

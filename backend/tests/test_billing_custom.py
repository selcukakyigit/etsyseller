"""Özel kredi miktarı: basamaklı fiyat, paket indirimleri, ödeme sonrası kredi yükleme ve iade."""
import pytest

from app.auth.models import Workspace
from app.billing import credits, custom, service
from app.billing.models import BillingProduct
from app.core.config import settings


@pytest.fixture
def packs(db):
    db.add_all([
        BillingProduct(name_tr="Start", name_en="Start", variant_id="1", credits=1000, price_cents=999, currency="USD", sort=1),
        BillingProduct(name_tr="Popular", name_en="Popular", variant_id="2", credits=2750, price_cents=2499, currency="USD", sort=2),
        BillingProduct(name_tr="Power", name_en="Power", variant_id="3", credits=6000, price_cents=4999, currency="USD", sort=3),
    ])
    db.commit()


@pytest.fixture(autouse=True)
def custom_variant(monkeypatch):
    monkeypatch.setattr(settings, "lemonsqueezy_custom_variant_id", "9")


@pytest.fixture
def ws(db):
    row = Workspace(name="W")
    db.add(row)
    db.commit()
    row.start = credits.balance(db, row.id)  # kayıt hediyesi varsa onunla başlar
    return row


def test_smallest_pack_has_no_discount_bigger_ones_do(db, packs):
    products = custom.active_products(db)
    start, popular, power = products
    assert custom.pack_discount(products, start) == (999, 0)
    list_price, pct = custom.pack_discount(products, popular)
    assert list_price > popular.price_cents and pct == 9
    assert custom.pack_discount(products, power)[1] == 17


def test_quote_uses_the_tier_of_the_largest_pack_not_above_the_amount(db, packs):
    small = custom.quote(db, 100)
    assert small["discount_pct"] == 0 and small["price_cents"] == small["list_price_cents"]
    mid = custom.quote(db, 3000)
    assert mid["discount_pct"] == 9 and mid["price_cents"] < mid["list_price_cents"]
    big = custom.quote(db, 10_000)
    assert big["discount_pct"] == 17
    # Daha çok kredi hiçbir zaman daha pahalıya gelmez (basamak geçişinde de).
    assert custom.quote(db, 2750)["price_cents"] <= custom.quote(db, 2749)["price_cents"] + 1


def test_quote_rejects_out_of_range_and_missing_products(db, packs):
    with pytest.raises(custom.CustomError):
        custom.quote(db, custom.MIN_CREDITS - 1)
    with pytest.raises(custom.CustomError):
        custom.quote(db, custom.MAX_CREDITS + 1)


def test_quote_without_products(db):
    with pytest.raises(custom.CustomError):
        custom.quote(db, 500)


def _order(order_id, variant, subtotal, custom_credits=None, ws_id=1):
    meta = {"event_name": "order_created", "custom_data": {"workspace_id": ws_id, **({"custom_credits": custom_credits} if custom_credits else {})}}
    return {"meta": meta, "data": {"id": order_id, "type": "orders", "attributes": {"status": "paid", "subtotal": subtotal, "first_order_item": {"variant_id": variant}}}}


def test_custom_order_grants_the_chosen_amount_when_paid_enough(db, packs, ws):
    price = custom.quote(db, 750)["price_cents"]
    service.handle_event(db, _order("o1", "9", price, custom_credits="750", ws_id=ws.id))
    assert credits.balance(db, ws.id) == ws.start + 750


def test_custom_order_refused_when_underpaid(db, packs, ws):
    price = custom.quote(db, 750)["price_cents"]
    with pytest.raises(service.EventError):
        service.handle_event(db, _order("o2", "9", price - 1, custom_credits="750", ws_id=ws.id))
    assert credits.balance(db, ws.id) == ws.start


def test_pack_order_still_grants_pack_credits(db, packs, ws):
    service.handle_event(db, _order("o3", "2", 2499, ws_id=ws.id))
    assert credits.balance(db, ws.id) == ws.start + 2750


def test_refund_takes_back_what_the_order_actually_granted(db, packs, ws):
    price = custom.quote(db, 750)["price_cents"]
    service.handle_event(db, _order("o4", "9", price, custom_credits="750", ws_id=ws.id))
    refund = {"meta": {"event_name": "order_refunded", "custom_data": {"workspace_id": ws.id}}, "data": {"id": "o4", "type": "orders", "attributes": {"first_order_item": {"variant_id": "9"}}}}
    service.handle_event(db, refund)
    assert credits.balance(db, ws.id) == ws.start  # paketin 1000 kredisi değil, yüklenen 750


def test_custom_price_on_a_pack_variant_is_never_credited(db, packs, ws):
    """Özel fiyatlı ödeme sayfasında müşteri başka bir paketi seçerse eksik ödemeyle o paketin kredisi verilmez."""
    price = custom.quote(db, 750)["price_cents"]
    with pytest.raises(service.EventError):
        service.handle_event(db, _order("o5", "1", price, custom_credits="750", ws_id=ws.id))
    assert credits.balance(db, ws.id) == ws.start


def test_custom_variant_without_amount_is_refused(db, packs, ws):
    with pytest.raises(service.EventError):
        service.handle_event(db, _order("o6", "9", 5000, ws_id=ws.id))
    assert credits.balance(db, ws.id) == ws.start

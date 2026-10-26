"""Alış paketi: kalemde paket türü + paketteki miktar, serileştirme (paket fiyatı), doğrulama ve stok girişinde paket."""
from types import SimpleNamespace as NS

import pytest
from fastapi import HTTPException

from app.modkit import packs, pricebook, stock
from app.modkit.models import PriceItem


def _access():
    return NS(entity=NS(id=1, workspace_id=1, vat_rate=0, vat_in_cost=False, currency="TRY"), user=NS(id=1), is_guest=False, is_member=True, require=lambda *a: None, require_member=lambda: None)


def _material(db, access, name="Strafor", unit="sheet", price=20, **fields):
    return pricebook.create_item(db, access, "material", name, unit, "", price, fields={"material": "styrofoam", **fields})


def _row(db, access, item):
    version = pricebook.latest_prices(db, [item.id]).get(item.id)
    return pricebook.serialize(item, version, 1, None)


def test_pack_is_stored_on_the_item_and_the_pack_price_is_derived(db):
    a = _access()
    item = _material(db, a, pack_unit="pack", pack_size=20)
    row = _row(db, a, item)
    assert (row["pack_unit"], row["pack_size"], row["price"], row["pack_price"]) == ("pack", 20, 20, 400)
    tape = _material(db, a, "Koli bandı", "m", 0.8, material="tape", pack_unit="roll", pack_size=100)
    assert _row(db, a, tape)["pack_price"] == 80
    assert _row(db, a, _material(db, a, "Plain"))["pack_price"] is None, "paketi olmayan kalemde paket fiyatı yok"


def test_pack_can_be_changed_and_cleared_and_unknown_types_are_refused(db):
    a = _access()
    item = _material(db, a)
    pricebook.update_item(db, a, item, None, None, fields={"pack_unit": "box", "pack_size": 12})
    assert (item.pack_unit, item.pack_size) == ("box", 12)
    pricebook.update_item(db, a, item, None, None, fields={"pack_unit": None, "pack_size": None})
    assert (item.pack_unit, item.pack_size) == (None, None)
    with pytest.raises(HTTPException) as err:
        pricebook.update_item(db, a, item, None, None, fields={"pack_unit": "bogus"})
    assert err.value.status_code == 422
    with pytest.raises(HTTPException):
        pricebook.update_item(db, a, item, None, None, fields={"pack_size": -3})


def test_pack_is_ignored_outside_material_items(db):
    a = _access()
    service = pricebook.create_item(db, a, "service", "Kesim", "min", "", 5, fields={"pack_unit": "pack", "pack_size": 3})
    assert (service.pack_unit, service.pack_size) == (None, None)


def test_stock_entry_in_packs_converts_with_the_pack_size(db):
    a = _access()
    item = _material(db, a, pack_unit="pack", pack_size=20)
    assert stock.to_item_unit(item, 3, stock.PACK) == 60
    assert stock.PACK in stock.entry_units(item)
    bare = _material(db, a, "Bare")
    with pytest.raises(HTTPException):
        stock.to_item_unit(bare, 1, stock.PACK)


def test_stock_settings_no_longer_carry_the_pack_size(db):
    assert "pack_size" not in stock.TRACKING_FIELDS
    assert [p["key"] for p in packs.catalog()][:3] == ["pack", "roll", "box"]

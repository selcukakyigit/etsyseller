"""Rulo malzemeler: stok saydığın şeyle (adet/rulo), metre türetilir: bant (rulo boyu), balonlu naylon ve streç (rulo ağırlığı × en × kalınlıktan uzunluk)."""
import pytest

from app.modkit import materials, pricebook
from tests.modkit.test_packs import _access, _row


def _roll(db, name, price, **fields):
    return pricebook.create_item(db, _access(), "material", name, "piece", "", price, fields=fields)


def test_film_group_defaults_to_counting_rolls_not_metres():
    assert materials.units_for("film")[0] == "piece"
    assert "plate_kg" in materials.fields_for("film", "piece") and "roll_length" in materials.fields_for("film", "piece")


def test_tape_roll_length_gives_metres_per_roll_and_stock_in_metres(db):
    tape = _roll(db, "Koli bandı", 80, material="tape", roll_length=100, pack_unit="box", pack_size=80)
    assert materials.roll_metres(tape) == 100 and materials.per_metre(tape) == pytest.approx(0.01)
    assert materials.metres_of(tape, 3) == pytest.approx(300)
    assert _row(db, _access(), tape)["roll_metres"] == 100


def test_bubble_wrap_length_is_worked_out_from_weight_width_and_thickness(db):
    bubble = _roll(db, "Balonlu naylon", 900, material="bubble", plate_kg=14, roll_width=1500, film_um=600)
    assert materials.roll_metres(bubble) == pytest.approx(14 / (1.5 * 600e-6 * 0.01 * 1000), rel=1e-6)  # ≈ 1556 m
    assert materials.per_metre(bubble) == pytest.approx(1 / materials.roll_metres(bubble))


def test_stretch_roll_by_weight_and_a_written_length_wins(db):
    stretch = _roll(db, "Streç", 300, material="stretch", plate_kg=2, roll_width=500, film_um=23)
    assert materials.roll_metres(stretch) == pytest.approx(2 / (0.5 * 23e-6 * 0.92 * 1000), rel=1e-6)  # ≈ 189 m
    stretch.roll_length = 150
    assert materials.roll_metres(stretch) == 150, "yazılan rulo boyu hesaplanandan önce gelir"


def test_kg_priced_roll_uses_the_pack_weight(db):
    item = pricebook.create_item(db, _access(), "material", "Streç kg", "kg", "", 100, fields={"material": "stretch", "roll_width": 500, "film_um": 23, "pack_unit": "roll", "pack_size": 2})
    assert materials.roll_metres(item) == pytest.approx(2 / (0.5 * 23e-6 * 0.92 * 1000), rel=1e-6)
    assert materials.metres_of(item, 4) == pytest.approx(2 * materials.roll_metres(item))


def test_not_enough_information_gives_no_metres(db):
    bare = _roll(db, "Bant", 10, material="tape")
    assert materials.roll_metres(bare) is None and materials.metres_of(bare, 5) is None


def test_serialized_stock_shows_metres_on_hand(db):
    a = _access()
    tape = _roll(db, "Koli bandı", 80, material="tape", roll_length=100)
    version = pricebook.latest_prices(db, [tape.id])[tape.id]
    row = pricebook.serialize(tape, version, 1, {tape.id: {"on_hand": 4}})
    assert row["on_hand_metres"] == 400


def test_an_unused_metre_tape_can_be_switched_to_counted_rolls_with_a_pack(db):
    """Eski "m" birimli bant kalemi (işte kullanılmamış): birim adete, rulo boyu ve koli paketiyle tek kayıtta değişir."""
    a = _access()
    tape = pricebook.create_item(db, a, "material", "Koli bandı", "m", "", 1, fields={"material": "tape"})
    pricebook.update_item(db, a, tape, None, None, unit="piece", in_use=False,
                          fields={"roll_length": 100, "pack_unit": "box", "pack_size": 80})
    pricebook.set_price(db, a, tape, 80)
    row = _row(db, a, tape)
    assert (tape.unit, tape.roll_length, tape.pack_unit, tape.pack_size) == ("piece", 100, "box", 80)
    assert row["roll_metres"] == 100 and row["pack_price"] == 6400


def test_counted_sheet_material_asks_for_plate_size_so_packages_can_use_its_area(db):
    """Strafor tabaka: 1200×600 ölçüsü girilebilir; ambalaj tarifi alan payını tabaka alanına böler (2,5 m × 0,15 m ürün → 0,52 tabaka)."""
    from app.supply.models import PackageLine
    from app.supply import packages

    assert set(materials.fields_for("piece", "sheet")) == {"thickness_mm", "plate_width", "plate_height"}
    assert materials.fields_for("piece", "piece") == ()
    a = _access()
    foam = pricebook.create_item(db, a, "material", "20 lik strafor", "sheet", "", 50, fields={"material": "styrofoam", "thickness_mm": 20, "plate_width": 1200, "plate_height": 600})
    assert (foam.thickness_mm, foam.plate_width, foam.plate_height) == (20, 1200, 600)
    qty, missing = packages.quantity(foam, PackageLine(per_area=1.0, constant=0, per_long=0, per_short=0), (2.5, 0.15))
    assert missing is None and qty == pytest.approx(0.375 / 0.72)
    bare = pricebook.create_item(db, a, "material", "Strafor", "sheet", "", 50, fields={"material": "styrofoam"})
    assert packages.quantity(bare, PackageLine(per_area=1.0, constant=0, per_long=0, per_short=0), (2.5, 0.15)) == (None, "plate"), "ölçü yoksa hesaplanamaz"

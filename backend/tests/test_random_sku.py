"""Rastgele SKU sunucuda üretilir (model kafadan "rastgele" yazınca tekrar eder/sahte olur) ve araç sonucu gerçek durumu döner."""
from app.listings import inventory_edit as ie


def _work():
    def product(color, sku):
        return {"property_values": [{"property_id": 200, "property_name": "Color", "values": [color]}], "sku": sku,
                "offerings": [{"quantity": 5, "price": {"amount": 2500, "divisor": 100}, "is_enabled": True}]}
    return {"inventory": {"products": [product("White", "BM-4821-WHT"), product("Black", "")]}}


def test_random_sku_is_unique_readable_and_within_limit():
    work = _work()
    changed, errors, count = ie.apply_inventory(work, random_sku="bm")
    skus = [p["sku"] for p in work["inventory"]["products"]]
    assert changed == ["sku"] and not errors and count == 2
    assert len(set(skus)) == 2 and all(s.startswith("BM-") and len(s) <= 32 for s in skus)
    assert skus[0].endswith("-WHI") and skus[1].endswith("-BLA")


def test_random_sku_without_prefix_and_not_clashing_with_untouched_rows():
    work = _work()
    ie.apply_inventory(work, where={"Color": "Black"}, random_sku="")
    assert work["inventory"]["products"][0]["sku"] == "BM-4821-WHT"  # seçilmeyen satıra dokunulmaz
    assert work["inventory"]["products"][1]["sku"].endswith("-BLA")


def test_summary_reports_the_real_state():
    work = _work()
    ie.apply_inventory(work, random_sku="BM")
    rows = ie.sku_summary(work)
    assert [r["stok"] for r in rows] == [5, 5] and rows[0]["sku"] == work["inventory"]["products"][0]["sku"]

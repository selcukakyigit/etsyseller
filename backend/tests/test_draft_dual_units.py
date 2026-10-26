"""Boyutlar hem cm hem inç yazılınca ('140 x 49 cm (55 x 19.3 in)') taslak ilk çağrıda kurulur: kapsama denetimi parantezdeki inç karşılığı yüzünden reddetmez (oturum 50/51)."""
import json

from app.assistant import tools
from app.shops.models import Shop


def test_a_size_listing_with_both_units_is_created_on_the_first_call(db, monkeypatch):
    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1001, etsy_user_id=7, shop_name="S")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="2mm metal 140x49 cm 249 usd 118x40 cm 159 usd 99x34 cm 129 usd black white grey gold brown stok 30 hepsi için geçerli", cards=[{"type": "brief"}])
    args = {
        "title": "abstract metal wall decor bubble line art panel", "product": "metal wall decor panel", "quantity": 30, "taxonomy_id": 1029, "personalizable": False,
        "description": "Abstract metal wall panel featuring continuous bubble line art.\n\nDETAILS\n• Material: 2 mm metal\n• Sizes: 140 x 49 cm (55 x 19.3 in); 118 x 40 cm (46.5 x 15.7 in); 99 x 34 cm (39 x 13.4 in)\n• Colors: Black, White, Grey, Gold, Brown\n• Mounting hardware included",
        "tags": ["metal wall art", "bubble wall art", "line art decor", "abstract metal art", "modern wall decor", "metal wall decor", "wall hanging", "geometric decor", "living room art", "minimalist art", "wall sculpture", "bedroom decor", "office wall art"],
        "variations": [
            {"name": "Size", "values": [{"value": "140 x 49 cm (55 x 19.3 in)", "price": 249}, {"value": "118 x 40 cm (46.5 x 15.7 in)", "price": 159}, {"value": "99 x 34 cm (39 x 13.4 in)", "price": 129}]},
            {"name": "Color", "values": [{"value": c} for c in ("Black", "White", "Grey", "Gold", "Brown")]},
        ],
    }
    out = tools.create_listing_draft(ctx, args)
    assert out.get("listing_id") and not out.get("kalite_uyarilari"), out


def test_total_quantity_is_spread_over_the_combinations_and_per_combination_stays_the_default(db, monkeypatch):
    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1002, etsy_user_id=7, shop_name="S2")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    base = {"title": "Bubble Line Art Metal Wall Decor Panel", "product": "metal wall decor", "taxonomy_id": 1029, "price": 100,
            "description": "Bubble line art metal wall panel.\n\nDETAILS\n• Sizes: Small; Large\n• Colors: Black; White; Grey",
            "variations": [{"name": "Size", "values": [{"value": "Small"}, {"value": "Large"}]}, {"name": "Color", "values": [{"value": c} for c in ("Black", "White", "Grey")]}]}

    def stocks(extra):
        ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="stok", cards=[{"type": "brief"}])
        out = tools.create_listing_draft(ctx, {**base, **extra})
        assert out.get("listing_id"), out
        from app.listings import drafts
        work = json.loads(drafts._local_row(db, shop, out["listing_id"]).data_json)
        return [o["quantity"] for p in work["inventory"]["products"] for o in p["offerings"]]

    assert stocks({"quantity": 30}) == [30] * 6, "hepsi için 30: her kombinasyona 30"
    assert stocks({"total_quantity": 20}) == [4, 4, 3, 3, 3, 3], "toplam 20, 6 kombinasyona: kalan ilk ikisine"
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="stok", cards=[{"type": "brief"}])
    assert "bölünemez" in tools.create_listing_draft(ctx, {**base, "total_quantity": 4}).get("error", ""), "kombinasyondan az toplam reddedilir"

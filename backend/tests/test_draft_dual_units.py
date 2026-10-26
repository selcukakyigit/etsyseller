"""Boyutlar hem cm hem inç yazılınca ('140 x 49 cm (55 x 19.3 in)') taslak ilk çağrıda kurulur: kapsama denetimi parantezdeki inç karşılığı yüzünden reddetmez (oturum 50/51)."""
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

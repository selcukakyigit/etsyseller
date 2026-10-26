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


def test_the_model_cannot_crop_the_first_photo_on_its_own_and_piece_counts_need_a_source(db, monkeypatch):
    from app.listing_plan import facts as facts_mod, fit

    wall = facts_mod.from_listing("Metal wall art", "single metal panel in 3 sizes", product="metal wall art", said="3 farklı boyut, tek panel")
    assert (fit.reason("3 panel wall art", wall) or "").startswith("kartta olmayan parça sayısı"), "'3 farklı boyut' cümlesindeki 3 parça sayısı değildir"
    assert fit.reason("metal wall art", wall) is None
    triptych = facts_mod.from_listing("Metal wall art", "3 panel set", product="metal wall art", said="3 panel takım")
    assert fit.reason("3 panel wall art", triptych) is None, "kullanıcı söylediyse serbest"

    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1003, etsy_user_id=7, shop_name="S3")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    crops = []
    monkeypatch.setattr(tools, "_crop_in_work", lambda ctx, lid, work, number, spec: crops.append(spec) or None)
    args = {"title": "Bubble Line Art Metal Wall Decor Panel", "product": "metal wall decor", "taxonomy_id": 1029, "price": 100, "quantity": 5, "crop_first_photo": "1:1",
            "description": "Bubble line art metal wall panel in one piece.\n\nDETAILS\n• Material: metal"}
    out = tools.create_listing_draft(tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="yeni ürün 2mm metal", cards=[{"type": "brief"}]), args)
    assert out.get("listing_id") and not crops and out.get("kirpma_atlandi"), "kullanıcı kırpma istemedi: fotoğraf olduğu gibi kalır"
    asked = tools.create_listing_draft(tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="ilk resmi 1:1 kırp", cards=[{"type": "brief"}]), {**args, "title": "Bubble Line Art Metal Wall Hanging Panel"})
    assert asked.get("listing_id")


def test_the_category_picker_does_not_override_the_shops_established_category(db, monkeypatch):
    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1004, etsy_user_id=7, shop_name="S4")
    db.add(shop); db.commit()
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None)
    monkeypatch.setattr(tools.listing_service, "get_top_categories", lambda db_, shop_, limit=50: [{"taxonomy_id": 1027, "count": 146}, {"taxonomy_id": 66, "count": 28}])
    assert tools._keeps_established_category(ctx, 1027, 129) is True, "146 listing'lik Wall Decor, mağazanın hiç kullanmadığı Sculpture ile değiştirilmez"
    assert tools._keeps_established_category(ctx, 1027, 66) is False, "seçicinin önerisi de mağazada kullanılıyorsa serbest"
    assert tools._keeps_established_category(ctx, 129, 1027) is False and tools._keeps_established_category(ctx, None, 129) is False
    monkeypatch.setattr(tools.listing_service, "get_top_categories", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    assert tools._keeps_established_category(ctx, 1027, 129) is False, "mağaza verisi alınamazsa seçici karar verir"


def test_uniform_stock_follows_the_price_variation_so_the_editor_rule_holds(db, monkeypatch):
    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1005, etsy_user_id=7, shop_name="S5")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="stok 30", cards=[{"type": "brief"}])
    out = tools.create_listing_draft(ctx, {
        "title": "Bubble Line Art Metal Wall Decor Panel", "product": "metal wall decor", "taxonomy_id": 1029, "quantity": 30,
        "description": "Bubble line art metal wall panel.\n\nDETAILS\n• Sizes: Small; Large\n• Colors: Black; White",
        "variations": [{"name": "Size", "values": [{"value": "Small", "price": 50}, {"value": "Large", "price": 90}]}, {"name": "Color", "values": [{"value": "Black"}, {"value": "White"}]}]})
    from app.listings import drafts
    inv = json.loads(drafts._local_row(db, shop, out["listing_id"]).data_json)["inventory"]
    size_id = inv["products"][0]["property_values"][0]["property_id"]
    assert inv["price_on_property"] == [size_id] and inv["quantity_on_property"] == [size_id], "stok eşit: tüm varyasyonlara değil fiyatın bağlı olduğu varyasyona"
    assert inv["sku_on_property"] == [], "editördeki kural: tek varyasyona ya da tümüne bağlı, ikisi karışmaz"

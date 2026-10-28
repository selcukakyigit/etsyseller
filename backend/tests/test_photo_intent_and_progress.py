"""Yalnızca resim gelince önce niyet sorulur; kart reddi bir turda en çok bir kez; bekleme yazıları çeşitli; sayı sözcüğüyle metin alanı sayısı."""
import random
from types import SimpleNamespace

from app.assistant import progress, service, tools
from app.assistant.tools import brief_check

UNDERSTOOD = [{"label": "Ürün", "value": "Garaj tabelası"}]
IMG = SimpleNamespace(content_type="image/jpeg")


def test_a_bare_photo_asks_for_intent_but_a_described_one_does_not(db):
    assert service.photo_needs_intent(db, 1, "", [IMG])
    assert service.photo_needs_intent(db, 1, "bak şuna", [IMG])
    assert not service.photo_needs_intent(db, 1, "bu garaj tabelası 2mm alüminyum", [IMG]), "ürün tarif edilmiş: niyet belli"
    assert not service.photo_needs_intent(db, 1, "liste oluştur", [IMG]) and not service.photo_needs_intent(db, 1, "Evet, liste oluştur", [IMG])
    assert not service.photo_needs_intent(db, 1, "kırp", [IMG]), "düzenleme isteği"
    assert not service.photo_needs_intent(db, 1, "", []), "resim yok"
    assert not service.photo_needs_intent(db, 1, "", [SimpleNamespace(content_type="application/pdf")]), "belge resim değildir"


class _NoDb:
    def scalars(self, *_a, **_k):
        return SimpleNamespace(all=lambda: [])


def test_soft_title_rejections_are_said_once_then_the_card_passes():
    ctx = SimpleNamespace(cards=[], plan=SimpleNamespace(lead_options=["metal garage sign", "aluminum garage sign"]), message="", session_id=None, db=_NoDb())
    args = {"understood": UNDERSTOOD, "design": "round badge serif lettering", "questions": [{"label": "Başlık seç", "options": ["Garage Sign Round", "Garage Sign Badge", "Garage Sign Plate"]}]}
    first = brief_check(ctx, args)
    assert "error" in first and ctx.cards == []
    assert "error" in brief_check(ctx, args), "kalite retleri en çok iki kez söylenir"
    third = brief_check(ctx, args)
    assert third.get("ok") and ctx.cards and ctx.cards[0]["type"] == "brief", "üçüncü çağrıda kalite retleri tekrarlanmaz (16 turluk döngü)"


def test_the_stated_number_of_text_fields_is_read_from_words_too():
    assert tools._stated_text_lines("Kişiselleştirme alanı üç farklı alan olacak ve her biri 25 karakter") == ["Line 1", "Line 2", "Line 3"]
    assert tools._stated_text_lines("3 metin olarak") == ["Line 1", "Line 2", "Line 3"]
    assert tools._stated_text_lines("iki ölçü ve dört renk var") == [], "ölçü/renk sayısı metin alanı sayılmaz"


def test_progress_lines_are_varied_and_bilingual():
    for name in ("brief_check", "create_listing_draft", "keyword_pool", "find_category"):
        tr_lines = {tuple(progress.steps_for(None, 1, name, {}, False)) for _ in range(60)}
        en_lines = progress.steps_for(None, 1, name, {}, True)
        assert len(tr_lines) > 1, f"{name}: hep aynı cümle"
        assert len(en_lines) == len(next(iter(tr_lines))) and all(x.strip() for x in en_lines)
    assert len({progress.thinking(False) for _ in range(60)}) > 1
    assert not any("sabır" in x.lower() for step in progress._VARIED.values() for alts in step for x, _ in alts), "sabır cümlesi yok"


def test_features_land_in_the_details_section():
    from app.ai import quality

    out = quality.build_details("", {"Size": ["S", "L"]}, ["aluminum"], "", ["back-mounted", "mounting hardware included"])
    assert "• Features: back-mounted; mounting hardware included" in out
    again = quality.build_details("DETAILS\n• Mounting: back-mounted", {}, [], "", ["back-mounted"])
    assert again.count("back-mounted") == 1, "zaten yazılan olgu tekrarlanmaz"


def test_sizes_the_user_wants_proportioned_are_computed_on_the_server():
    from app.listings import dimensions

    out = dimensions.fill_missing_sizes(["S", "M - 103x67 cm (40.6 x 26.4 in)", "XL - 123x79 cm (48.4 x 31.1 in)", "XXL - proportioned to given sizes"])
    assert out[0] == "S - 83x55 cm (32.7 x 21.7 in)" and out[3] == "XXL - 143x91 cm (56.3 x 35.8 in)", out
    assert out[1:3] == ["M - 103x67 cm (40.6 x 26.4 in)", "XL - 123x79 cm (48.4 x 31.1 in)"]
    assert dimensions.fill_missing_sizes(["Small", "Large"]) == ["Small", "Large"], "ölçüsüz adlara dokunulmaz"
    assert dimensions.fill_missing_sizes(["S", "M - 50x40 cm"]) == ["S", "M - 50x40 cm"], "tek ölçülü: hesaplanamaz"
    assert dimensions.fill_missing_sizes(["XL - 100x50 cm", "M - 120x60 cm", "S - 90x40 cm"]) == ["XL - 100x50 cm", "M - 120x60 cm", "S - 90x40 cm"], "ölçülerin hepsi belliyse değişmez"


def test_a_specific_material_the_user_never_said_is_dropped(db, monkeypatch):
    import json

    from app.listings import drafts
    from app.shops.models import Shop

    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1014, etsy_user_id=7, shop_name="S14")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="metal isim tabelası", cards=[{"type": "brief"}])
    out = tools.create_listing_draft(ctx, {"title": "Metal Name Plaque Rectangular Sign", "product": "metal sign", "taxonomy_id": 1029, "price": 50, "quantity": 5, "materials": ["metal", "steel"],
                                           "description": "Metal name plaque.\n\nDETAILS\n• Material: metal"})
    assert json.loads(drafts._local_row(db, shop, out["listing_id"]).data_json)["materials"] == ["metal"], "söylenmeyen 'steel' atılır"


def test_size_labels_fit_etsys_20_character_limit_with_both_units():
    from app.listings import dimensions

    filled = dimensions.fill_missing_sizes(["S", "M - 103x67 cm (40.6 x 26.4 in)", "XL - 123x79 cm (48.4 x 31.1 in)", "XXL - proportioned"])
    short = dimensions.compact_sizes(filled)
    assert short == ["S 83x55cm/33x22in", "M 103x67cm/41x26in", "XL 123x79cm/48x31in", "XXL 143x91cm/56x36in"] and all(len(x) <= 20 for x in short)
    assert dimensions.compact_sizes(["140 × 50 cm (55 × 19.7 in)", "120 × 35 cm (47.2 × 13.8 in)"]) == ["140x50cm/55.1x19.7in", "120x35cm/47.2x13.8in"]
    assert dimensions.compact_sizes(["Small", "Large"]) == ["Small", "Large"] and dimensions.compact_sizes(["S 10x5 cm"]) == ["S 10x5 cm"], "sığanlara dokunulmaz"


def test_a_long_option_name_is_refused_for_the_model_to_shorten():
    from app.listings import inventory_edit

    err, msg = inventory_edit.add_option({"inventory": {"products": [{"property_values": [{"property_name": "Size", "values": ["S"]}], "offerings": [{}]}]}}, "Size", "S - proportioned to given sizes (inches added in description)")
    assert err == 0 and "20" in (msg or "")


def test_a_draft_without_a_price_gets_price_boxes_per_size_and_they_write_through_edit_inventory(db, monkeypatch):
    from app.shops.models import Shop

    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1015, etsy_user_id=7, shop_name="S15")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="fiyatsız", cards=[{"type": "brief"}])
    sizes = [{"name": "Size", "values": [{"value": "S 83x55cm/33x22in"}, {"value": "M 103x67cm/41x26in"}]}, {"name": "Color", "values": [{"value": "Black"}, {"value": "White"}]}]
    out = tools.create_listing_draft(ctx, {"title": "Metal Name Plaque Rectangular Sign Wall", "product": "metal sign", "taxonomy_id": 1029, "quantity": 5, "variations": sizes,
                                           "description": "Metal name plaque.\n\nDETAILS\n• Material: metal"})
    card = next(c for c in ctx.cards if c.get("type") == "listing_draft")
    assert card["price_missing"] and card["price_form"] == {"variation": "Size", "options": ["S 83x55cm/33x22in", "M 103x67cm/41x26in"]}, card.get("price_form")
    res = tools.set_card_prices(ctx, out["listing_id"], "Size", [{"option": "S 83x55cm/33x22in", "price": 80}, {"option": "M 103x67cm/41x26in", "price": 120}])
    assert res["card"]["price"] == [80.0, 120.0] and not res["card"]["price_missing"] and "price_form" not in res["card"], res
    inv = tools._work_or_error(ctx, out["listing_id"])[0]["inventory"]
    assert {(p["property_values"][0]["values"][0], p["offerings"][0]["price"]["amount"]) for p in inv["products"]} == {("S 83x55cm/33x22in", 8000), ("M 103x67cm/41x26in", 12000)}
    bad = tools.set_card_prices(ctx, out["listing_id"], "Size", [{"option": "Nope", "price": 10}])
    assert bad.get("error"), "olmayan seçenek yazılmaz"


def test_a_header_with_option_price_lines_becomes_a_priced_variation():
    text = "how many \n100 adet - 330 dolar \n200 adet - 660 dolar \ntoplam stok 50 adet olacak\n\nsize \neu size \nUs size"
    got = tools._stated_price_variation(text)
    assert got == {"name": "How many", "values": [{"value": "100 pcs", "price": 330.0}, {"value": "200 pcs", "price": 660.0}]}, got
    assert tools._stated_price_variation("XL - 50 dolar") is None, "başlık ve en az iki satır yoksa varyasyon sayılmaz"
    assert tools._stated_price_variation("fiyatlar\nS - 40 $\nM - 60 $")["name"] == "Fiyatlar"


def test_the_price_variation_is_added_when_the_model_missed_it_and_prices_land_on_it(db, monkeypatch):
    from app.shops.models import Shop

    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1016, etsy_user_id=7, shop_name="S16")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    msg = "how many\n100 adet - 330 dolar\n200 adet - 660 dolar\ntoplam stok 50 adet olacak\n\nsize\neu size\nUs size"
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message=msg, cards=[{"type": "brief"}])
    out = tools.create_listing_draft(ctx, {"title": "Metal Business Card Engraved Logo", "product": "metal business card", "taxonomy_id": 1029, "total_quantity": 50,
                                           "variations": [{"name": "Size", "values": [{"value": "EU size"}, {"value": "US size"}]}], "description": "Metal business card.\n\nDETAILS\n• Material: metal"})
    card = next(c for c in ctx.cards if c.get("type") == "listing_draft")
    assert not card["price_missing"] and card["price"] == [330.0, 660.0], card
    inv = tools._work_or_error(ctx, out["listing_id"])[0]["inventory"]
    assert len(inv["products"]) == 4 and inv["price_on_property"], "2 boyut x 2 miktar, fiyat miktar seçeneğinde"
    assert {tuple(v["values"][0] for v in p["property_values"]) for p in inv["products"]} >= {("EU size", "100 pcs"), ("US size", "200 pcs")}


def test_an_upload_field_is_not_counted_as_a_text_line_in_the_description(db, monkeypatch):
    from app.ai import description_writer
    from app.shops.models import Shop

    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1017, etsy_user_id=7, shop_name="S17")
    db.add(shop); db.commit()
    seen = {}
    monkeypatch.setattr(description_writer, "write", lambda **kw: seen.update(kw) or ("If you are looking for a card, this is it. " + "word " * 25 + "\n\nSecond paragraph. " + "word " * 25))
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="x")
    a = {"description": "x", "product": "metal card", "personalizable": True, "materials": ["metal"], "personalization_questions": [
        {"question_type": "unlabeled_upload", "question_text": "Upload"}, {"question_type": "text_input", "max_allowed_characters": 100}, {"question_type": "text_input", "max_allowed_characters": 200}]}
    out = tools._enrich_description(ctx, a, "Metal Card", [], {}, "kişiselleştirme", None, [])
    assert "2 separate text lines" in seen["personalization"] and "upload a logo" in seen["personalization"] and "characters each" not in seen["personalization"], seen
    assert "2 personalization boxes" in out["description"] and "upload your logo" in out["description"], out["description"]


def test_junk_tags_are_dropped_and_the_score_flags_lost_prices():
    from app.ai import listing_score, quality

    assert quality.junk_tag("eu size card") and quality.junk_tag("40x60 cm sign") and quality.junk_tag("metal sign for") and not quality.junk_tag("metal business card")
    tags_out, _ = tools._tags(["metal business card", "eu size card", "custom card for", "engraved metal card"])
    assert tags_out == ["metal business card", "engraved metal card"]

    work = {"title": "Metal Business Card Engraved Logo", "materials": ["metal"], "tags": ["metal business card"] * 2, "description": "x", "inventory": {"products": [{"property_values": [{"values": ["EU size"]}], "offerings": [{"quantity": 50, "price": {"amount": 0, "divisor": 100}}]}], "quantity_on_property": []}}
    result = listing_score.score(work, "100 adet - 330 dolar\ntoplam stok 50 adet", rounds=9)
    assert result["toplam"] <= 6.0 and any("fiyat" in m for m in result["kritik"]), result
    good = {**work, "inventory": {"products": [{"property_values": [{"values": ["100 pcs"]}], "offerings": [{"quantity": 50, "price": {"amount": 33000, "divisor": 100}}]}], "quantity_on_property": []}}
    assert listing_score.fidelity(good, "100 adet - 330 dolar\ntoplam stok 50 adet")[0] == 10.0
    assert listing_score.efficiency(4)[0] == 10.0 and listing_score.efficiency(9)[0] == 6.5

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
    monkeypatch.setattr(tools, "_taxonomy", lambda: {1027: "Home & Living > Home Decor > Wall Decor", 129: "Art & Collectibles > Sculpture > Art Objects", 66: "Art & Collectibles"})
    monkeypatch.setattr(tools.listing_service, "get_top_categories", lambda db_, shop_, limit=50: [{"taxonomy_id": 1027, "count": 146}, {"taxonomy_id": 66, "count": 28}])
    title = "abstract wall decor wave line metal panel geometric wall art"
    assert tools._keeps_established_category(ctx, 1027, 129, title) is True, "146 listing'lik Wall Decor, başlıkta 'wall decor' geçiyor: Sculpture ile değiştirilmez"
    assert tools._keeps_established_category(ctx, 1027, 129, "gold pendant necklace handmade") is False, "başlık kategoriyi söylemiyorsa (çok çeşitli mağaza, model yanlış seçtiyse) seçici düzeltir"
    assert tools._keeps_established_category(ctx, 1027, 66, title) is False, "seçicinin önerisi de mağazada kullanılıyorsa serbest"
    assert tools._keeps_established_category(ctx, 129, 1027, title) is False and tools._keeps_established_category(ctx, None, 129, title) is False
    monkeypatch.setattr(tools.listing_service, "get_top_categories", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    assert tools._keeps_established_category(ctx, 1027, 129, title) is False, "mağaza verisi alınamazsa seçici karar verir"


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


def test_a_new_listing_needs_one_brief_card_first_unless_the_user_says_not_to_ask(db, monkeypatch):
    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1006, etsy_user_id=7, shop_name="S6")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    args = {"title": "Bubble Line Art Metal Wall Decor Panel", "product": "metal wall decor", "taxonomy_id": 1029, "quantity": 30,
            "description": "Bubble line art metal wall panel.\n\nDETAILS\n• Sizes: Small; Large\n• Colors: Black; White",
            "variations": [{"name": "Size", "values": [{"value": "Small", "price": 129}, {"value": "Large", "price": 249}]}, {"name": "Color", "values": [{"value": "Black"}, {"value": "White"}]}]}
    ctx = lambda msg, **kw: tools.Ctx(db=db, shop=shop, user_id=5, today=None, message=msg, **kw)  # noqa: E731
    asked = tools.create_listing_draft(ctx("fiyatlar boyuta göre"), args)
    assert "brief_check" in asked.get("error", "") and "BAŞLIK" in asked["error"], "fiyat seçeneklerde verilmiş olsa da kart (başlık önerileriyle) önce gelir"
    assert tools.create_listing_draft(ctx("fiyatlar boyuta göre", cards=[{"type": "brief"}]), args).get("listing_id"), "kart gösterildi: taslak kurulur"
    assert tools.create_listing_draft(ctx("sormadan oluştur"), {**args, "title": "Bubble Line Art Metal Wall Hanging Panel"}).get("listing_id"), "kullanıcı sormadan dediyse kart şart değil"


def test_obvious_title_mistakes_are_fixed_on_the_server():
    from app.ai import quality

    said = "2mm metal 140x49 cm 118x40 cm 99x34 cm"
    bad = "abstract metal wall decor 2mm steel – 140x49 cm (55x19 in) • 118x40 cm (46x16 in) • 99x34 cm (39x13 in)"
    fixed, notes = quality.autofix_title(bad, True, said)
    assert fixed == "abstract metal wall decor 2mm" and len(notes) == 2, (fixed, notes)
    assert quality.autofix_title("Metal Wall Art 140x49 cm", False, said) == ("Metal Wall Art 140x49 cm", []), "tek ölçülü üründe ölçü kalır"
    assert quality.autofix_title("Metal Wall Art Panel", True, said) == ("Metal Wall Art Panel", []), "hata yoksa dokunulmaz"
    long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"
    cut, cut_notes = quality.autofix_title(long, True, said)
    assert len(cut.split()) == 14 and cut_notes
    assert quality.autofix_title("Steel 140x49 cm", True, said)[0] == "Steel 140x49 cm", "çok kısalırsa özgün korunur"


def test_title_suggestions_that_are_nearly_the_same_are_not_alternatives():
    said = "2mm metal wall decor"
    same = ["metal home wall decor industrial silhouette geometric line art", "metal wall artwork decor industrial silhouette geometric line art", "abstract metal wall decor industrial silhouette geometric line art"]
    assert any("birbirinin neredeyse aynı" in p for p in tools._title_option_problems(same, said, "industrial silhouette geometric line art"))
    different = ["Abstract Bubble Cells Line Art Metal Wall Decor", "Organic Honeycomb Metal Wall Sculpture Panel", "Modern Cellular Pattern Metal Wall Hanging"]
    assert not any("birbirinin" in p for p in tools._title_option_problems(different, said, "bubble cells line art honeycomb cellular pattern"))


def test_a_rejected_draft_call_cannot_be_reported_as_in_progress():
    from app.assistant import service

    reply = "Tamam, eksik yokmuş, taslağı oluşturuyorum."
    assert "henüz oluşmadı" in service._guard_progress_claim({"create_listing_draft"}, 0, [], reply)
    assert service._guard_progress_claim({"create_listing_draft"}, 1, [{"type": "listing_draft"}], reply) == reply, "taslak kartı varsa dokunulmaz"
    assert service._guard_progress_claim({"keyword_pool"}, 0, [], reply) == reply, "taslak çağrısı yoksa dokunulmaz"


def test_only_one_brief_card_per_listing_an_answered_card_is_not_followed_by_another(db):
    import json as _json

    from app.assistant.models import ChatMessage, ChatSession

    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1007, etsy_user_id=7, shop_name="S7")
    db.add(shop); db.commit()
    session = ChatSession(shop_id=shop.id, user_id=5, title="t")
    db.add(session); db.commit()
    card = {"understood": [{"label": "Ürün", "value": "Metal wall decor"}], "design": "bubble cells honeycomb cellular line art", "questions": [
        {"label": "Başlık seç", "options": ["Abstract Bubble Cells Line Art Metal Decor", "Organic Honeycomb Pattern Wall Sculpture Panel", "Modern Cellular Motif Hanging Piece"]},
        {"label": "Montaj?", "options": ["Var", "Yok"], "type": "text"}]}

    from types import SimpleNamespace as _NS

    def ctx(**kw):
        return tools.Ctx(db=db, shop=shop, user_id=5, today=None, session_id=session.id, plan=_NS(lead_options=["metal wall decor", "bubble cells", "honeycomb", "cellular"], ask=[]), **kw)

    assert tools.brief_check(ctx(), card).get("ok"), "ilk kart gösterilir"
    db.add(ChatMessage(session_id=session.id, role="assistant", content="kart", cards_json=_json.dumps([{"type": "brief"}])))
    db.add(ChatMessage(session_id=session.id, role="user", content="Var"))
    db.commit()
    out = tools.brief_check(ctx(), card)
    assert "create_listing_draft" in out.get("error", ""), "kullanıcı cevapladı: ikinci kart yok, taslak kurulur"
    db.add(ChatMessage(session_id=session.id, role="assistant", content="taslak", cards_json=_json.dumps([{"type": "listing_draft"}])))
    db.commit()
    assert tools.brief_check(ctx(), card).get("ok"), "yeni bir listing için yeni kart serbest"


def test_a_wall_phrase_is_not_a_tag_for_a_bottle_and_wall_art_phrases_stay_valid():
    from app.listing_plan import facts as facts_mod, fit

    bottle = facts_mod.from_listing("Gym water bottle", "750 ml stainless", product="gym water bottle", said="750ml matte termos")
    assert (fit.reason("gym wall decor", bottle) or "").startswith("başka ürün türü"), "su şişesine duvar dekoru etiketi olmaz (oturum 57)"
    assert fit.reason("750 ml bottle", bottle) is None and fit.reason("gym water bottle", bottle) is None
    wall = facts_mod.from_listing("Metal wall art", "metal panel", product="metal wall art", said="2mm metal duvar")
    assert fit.reason("metal wall decor", wall) is None
    assert (fit.reason("gold necklace", wall) or "").startswith("başka ürün türü")


def test_the_selected_title_wins_personalization_needs_the_users_word_and_junk_is_stripped(db, monkeypatch):
    import json as _json

    from app.ai import layout
    from app.assistant.models import ChatMessage, ChatSession

    assert "answered" not in layout.normalize("Nice.\n\nDETAILS\n• Size: 40 cm\n\nQUESTIONS\n(Answered: skipped by seller)\n\nThanks.").lower()
    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1008, etsy_user_id=7, shop_name="S8")
    db.add(shop); db.commit()
    session = ChatSession(shop_id=shop.id, user_id=5, title="t")
    db.add(session); db.commit()
    options = ["Lotus Motif Circular Cutout Metal Wall Decor", "Lotus Mandala Hanging Metal Wall Artwork", "Abstract Lotus Cutout Metal Wall Panel"]
    db.add(ChatMessage(session_id=session.id, role="assistant", content="kart", cards_json=_json.dumps([{"type": "brief", "questions": [{"label": "Başlık", "type": "title", "options": options}]}])))
    db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    args = {"title": "Totally Different Model Title Metal Wall Decor", "product": "metal wall decor", "taxonomy_id": 1029, "price": 59, "quantity": 5, "personalizable": True,
            "description": "Lotus cutout metal wall panel.\n\nDETAILS\n• Material: metal"}
    out = tools.create_listing_draft(tools.Ctx(db=db, shop=shop, user_id=5, today=None, session_id=session.id, message="Toplam 20\n" + options[1] + "\nVar"), args)
    assert out.get("listing_id") and out.get("kisisellestirme_kaldirildi"), "kişiselleştirmeden söz edilmedi: eklenmedi"
    from app.listings import drafts
    work = _json.loads(drafts._local_row(db, shop, out["listing_id"]).data_json)
    assert work["title"] == options[1], "kullanıcının seçtiği başlık, modelin yazdığı değil"


def test_free_form_questions_get_model_suggested_buttons_and_open_questions_do_not(monkeypatch):
    from app.ai import choices

    monkeypatch.setattr(choices, "text_model", lambda task: object())
    answers = {"fmt": '{"options": ["Parantez içinde", "Ondalıklı"]}', "num": '{"options": []}', "long": '{"options": ["' + "x" * 60 + '", "b"]}', "bad": "not json"}
    state = {"key": "fmt"}
    monkeypatch.setattr(choices, "ask_text", lambda model, prompt, max_tokens=120, task="vision": answers[state["key"]])
    q = "İnçleri nasıl ekleyeyim: yuvarlanmış parantez içinde mı yoksa ondalıklı mı?"
    assert choices.suggest(q) == ["Parantez içinde", "Ondalıklı"]
    for key in ("num", "long", "bad"):
        state["key"] = key
        assert choices.suggest(q) == [], key
    assert choices.suggest("Taslak hazır.") == [], "soru işareti yoksa model çağrılmaz"
    monkeypatch.setattr(choices, "text_model", lambda task: (_ for _ in ()).throw(RuntimeError("anahtar yok")))
    assert choices.suggest(q) == [], "model yoksa düğmesiz devam"

    state["key"] = "fmt"
    monkeypatch.setattr(choices, "text_model", lambda task: object())
    ctx = tools.Ctx(db=None, shop=None, user_id=1, today=None)
    tools.auto_yes_no(ctx, q)
    assert ctx.cards and ctx.cards[0]["options"] == ["Parantez içinde", "Ondalıklı"], "serbest cümleli soru düğme olur"
    ctx2 = tools.Ctx(db=None, shop=None, user_id=1, today=None, cards=[{"type": "choices", "kind": "question", "options": ["A", "B"], "question": "Q"}])
    tools.auto_yes_no(ctx2, q)
    assert ctx2.cards[0]["options"] == ["A", "B"] and len(ctx2.cards) == 1, "modelin kendi kartına dokunulmaz"


def test_updating_variations_keeps_the_stock_of_matching_combinations(db, monkeypatch):
    shop = Shop(user_id=1, workspace_id=1, etsy_shop_id=1009, etsy_user_id=7, shop_name="S9")
    db.add(shop); db.commit()
    monkeypatch.setattr(tools, "_autofill_in_work", lambda *a, **k: ([], []))
    monkeypatch.setattr(tools, "_category_defs", lambda tid: [])
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, message="sormadan oluştur", cards=[])
    out = tools.create_listing_draft(ctx, {
        "title": "Bubble Line Art Metal Wall Decor Panel", "product": "metal wall decor", "taxonomy_id": 1029, "price": 100, "total_quantity": 30,
        "description": "Bubble line art metal wall panel.\n\nDETAILS\n• Sizes: Small; Large\n• Colors: Black; White; Grey; Gold",
        "variations": [{"name": "Size", "values": [{"value": "Small"}, {"value": "Large"}]}, {"name": "Color", "values": [{"value": c} for c in ("Black", "White", "Grey", "Gold")]}]})
    from app.listings import drafts

    def stocks():
        inv = json.loads(drafts._local_row(db, shop, out["listing_id"]).data_json)["inventory"]
        return [o["quantity"] for p in inv["products"] for o in p["offerings"]]

    before = stocks()
    assert sum(before) == 30 and len(set(before)) > 1, before
    upd = tools.update_listing(ctx, {"listing_id": out["listing_id"], "set_variations": [
        {"name": "Size", "values": [{"value": 'Small (22")', "price": 119}, {"value": 'Large (41")', "price": 159}]}, {"name": "Color", "values": [{"value": c} for c in ("Black", "White", "Grey", "Gold")]}]})
    assert upd.get("ok"), upd
    assert stocks() == before, "fiyat/inç eklenince stok dağılımı ve toplam (30) korunur"


def test_the_design_the_model_wrote_is_checked_against_what_the_vision_model_sees(monkeypatch):
    from app.ai import design_reader

    ctx = tools.Ctx(db=None, shop=None, user_id=1, today=None)
    monkeypatch.setattr(tools, "_session_photos", lambda c: ([(b"x", "image/png")], ("img1",)))
    monkeypatch.setattr(design_reader, "read", lambda photos, key: {"product": "metal wall art panel", "design": "organic interconnected bubble cells line art"})
    bad = tools._design_mismatch(ctx, "industrial silhouette geometric line art")
    assert bad and "bubble cells" in bad and "industrial silhouette" in bad, "resimdeki motifle uyuşmuyor: görsel modelin okuması modele söylenir"
    assert tools._design_mismatch(ctx, "interconnected bubble cells in continuous line") is None, "örtüşüyor"
    monkeypatch.setattr(design_reader, "read", lambda photos, key: None)
    assert tools._design_mismatch(ctx, "anything at all") is None, "okuma yoksa denetim atlanır"
    monkeypatch.setattr(tools, "_session_photos", lambda c: ([], ()))
    assert tools._design_mismatch(ctx, "anything at all") is None, "resim yoksa denetim atlanır"


def test_the_vision_reading_is_cached_per_image_and_fails_quietly(monkeypatch):
    from app.ai import design_reader

    calls = []
    monkeypatch.setattr(design_reader, "text_model", lambda task: object())
    monkeypatch.setattr(design_reader, "ask_text", lambda model, prompt, max_tokens=120, task="vision", images=None: calls.append(1) or '{"product": "metal wall art", "design": "bubble cells line art"}')
    design_reader._CACHE.clear()
    assert design_reader.read([(b"x", "image/png")], ("a",)) == {"product": "metal wall art", "design": "bubble cells line art"}
    design_reader.read([(b"x", "image/png")], ("a",))
    assert len(calls) == 1, "aynı resim için tek çağrı"
    monkeypatch.setattr(design_reader, "ask_text", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("model yok")))
    assert design_reader.read([(b"y", "image/png")], ("b",)) is None


def test_only_one_high_demand_unanswered_question_reaches_the_card():
    from app.listing_plan import facts as facts_mod
    from app.listing_plan.plan import unanswered

    card = facts_mod.from_listing("Gym water bottle", "750 ml stainless", product="gym water bottle", said="750ml matte")
    qs = [{"q": "does it keep drinks hot", "demand": "medium"}, {"q": "do these come with a case", "demand": "high"}, {"q": "is there a warranty", "demand": "high"}, {"q": "is it dishwasher safe", "demand": "low"}]
    asked = unanswered(qs, card)
    assert [q["q"] for q in asked] == ["do these come with a case"], "en çok 1 ve yalnızca talebi yüksek olan"

"""Kelime planı: simülasyondaki üç senaryo (termos: kalabalık pazar + aynı ürün iki mağazada; metal yusufçuk: niş, Etsy verisi zengin;
kare gözlük: Etsy verisi yok, Google ağırlıklı). Veriler sahte; ağ ve model çağrısı yok."""
from app.listing_plan import facts as facts_mod
from app.listing_plan import fit, plan


def P(tag, **kw):
    return {"tag": tag, "source": kw.pop("source", "research"), "score": 0, "sample_size": 0, **kw}


BOTTLE = facts_mod.from_listing(
    "Insulated water bottle", "Double-wall stainless steel thermos, 750 ml (25 oz), about 30 cm. Engraved in silver, up to 30 characters.",
    materials=["stainless steel"], variations={"Color": ["Pink", "Red", "White", "Purple"]}, personalizable=True, product="insulated water bottle",
)
BOTTLE_POOL = [
    P("water bottle", google_volume=165000, etsy_searches=9000, etsy_results=310000, etsy_conversion="low", crowd=0.75),
    P("insulated water bottle", google_volume=40500, etsy_results=98000, crowd=0.3),
    P("engraved water bottle", google_volume=2900, etsy_searches=850, etsy_results=21000, etsy_conversion="high", crowd=0.9),
    P("personalized water bottle", google_volume=12100, etsy_searches=3100, etsy_results=64000, etsy_conversion="medium", crowd=0.7),
    P("custom name water bottle", google_volume=880, etsy_results=15000),
    P("stainless water bottle", google_volume=6600, etsy_results=120000),
    P("750ml water bottle", google_volume=1300, etsy_results=8000),
    P("25 oz water bottle", google_volume=1900, etsy_results=9500),
    P("engraved thermos", google_volume=720, etsy_searches=140, etsy_results=6200, etsy_conversion="very_high"),
    P("personalized thermos", google_volume=1600, etsy_results=11000),
    P("vacuum insulated bottle", google_volume=2400, etsy_results=30000),
    P("travel water bottle", google_volume=4400, etsy_results=70000),
    P("gym water bottle", google_volume=5400, etsy_results=40000),
    P("hiking water bottle", google_volume=2900, etsy_results=25000),
    P("metal water bottle", google_volume=8100, etsy_results=95000),
    P("thermos bottle", google_volume=8100, etsy_results=42000),
    P("custom thermos", google_volume=2400, etsy_results=16000),
    P("monogram water bottle", google_volume=1300, etsy_results=13000),
    P("sports water bottle", google_volume=6600, etsy_results=55000),
    P("gift for runner", google_volume=1900, etsy_results=50000),
    P("gift for hiker", google_volume=1300, etsy_results=30000),
    P("kids water bottle", google_volume=27000, etsy_results=150000),
    P("stanley tumbler", google_volume=450000, etsy_results=40000),
    P("glass water bottle", google_volume=14800, etsy_results=60000),
    P("pink water bottle", google_volume=9900, etsy_results=50000),
]
BOTTLE_QUESTIONS = [{"q": "is stainless steel water bottle safe", "google_volume": 2400}, {"q": "how to engrave a water bottle", "google_volume": 590},
                    {"q": "how long does a vacuum bottle keep water cold", "google_volume": 1300}]
SHOP_A_SIBLING = {
    "listing_id": 1, "title": "Engraved Water Bottle, Insulated Stainless Steel, Custom Name Gift",
    "tags": ["engraved water bottle", "personalized bottle", "custom name bottle", "insulated bottle", "stainless bottle", "gift for runner",
             "gym water bottle", "metal water bottle", "travel water bottle", "leak proof bottle", "coworker gift", "custom engraving", "reusable bottle"],
    "description": "Engraved water bottle in insulated stainless steel.",
}


def _bottle(key, others=()):
    return plan.build(BOTTLE_POOL, BOTTLE, key=key, others=list(others), research=([], list(BOTTLE_QUESTIONS), 0), use_ideas=False)


def test_fit_rejects_brand_other_material_audience_color_and_closed_personalization():
    assert fit.reason("stanley tumbler", BOTTLE) == "marka"
    assert fit.reason("glass water bottle", BOTTLE).startswith("başka malzeme")
    assert fit.reason("kids water bottle", BOTTLE).startswith("kartta olmayan kitle")
    assert fit.reason("pink water bottle", BOTTLE).startswith("renk etiketi")
    assert fit.reason("how to engrave a water bottle", BOTTLE) == "kendin-yap sorusu"
    no_pers = facts_mod.from_listing("Square sunglasses", "Glossy acrylic frame", personalizable=False, product="square sunglasses")
    assert fit.reason("personalized shades", no_pers) == "kişiselleştirme yok"
    assert fit.reason("engraved water bottle", BOTTLE) is None


def test_crowded_market_opens_with_a_specific_phrase_not_the_broad_head():
    p = _bottle("shopB:1")
    assert p.shape == "crowded"
    assert p.lead not in ("water bottle", "insulated water bottle") and len(p.lead.split()) >= 2
    assert p.lead_options[0] == p.lead and len(p.lead_options) == 3
    tags = [t["tag"] for t in p.tags]
    assert len(tags) == 13 and all(len(t) <= 20 for t in tags)
    assert not {"stanley tumbler", "glass water bottle", "kids water bottle", "pink water bottle"} & set(tags)
    assert {r["tag"] if isinstance(r, dict) else r[0] for r in p.rejected} >= {"stanley tumbler", "glass water bottle"}


def test_shop_sibling_keeps_its_opening_and_shared_tags_stay_under_the_limit():
    p = _bottle("shopA:2", others=[SHOP_A_SIBLING])
    assert p.lead != "engraved water bottle"
    assert len({t["tag"] for t in p.tags} & set(SHOP_A_SIBLING["tags"])) <= 5
    assert "engraved" in p.sibling_words or "steel" in p.sibling_words


def test_same_product_in_two_listings_is_deterministic_per_listing():
    assert _bottle("shopX:7").lead == _bottle("shopX:7").lead  # aynı listing hep aynı sonucu alır
    leads = {_bottle(f"shop{i}:1").lead for i in range(8)}
    assert len(leads) >= 2  # eşit iyi açılışlar listing'lere dağılır


def test_questions_keep_buyer_questions_drop_diy_and_use_bands():
    p = _bottle("shopB:1")
    qs = [q["q"] for q in p.questions]
    assert "how to engrave a water bottle" not in qs and "is stainless steel water bottle safe" in qs
    assert all(q["demand"] in (None, "low", "medium", "high") for q in p.questions)


DRAGONFLY = facts_mod.from_listing(
    "Metal dragonfly garden stake", "Powder-coated steel garden stake for outdoor yard and flower beds, about 60 cm tall.", materials=["steel"],
    product="metal dragonfly yard art",
)
DRAGONFLY_POOL = [
    P("metal yard art", etsy_searches=4700, etsy_results=128400, etsy_conversion="very_low", google_volume=6600, units=14, source="own"),
    P("metal dragonfly yard art", etsy_searches=7, etsy_results=6700, etsy_conversion="very_high", google_volume=320),
    P("metal dragonfly", google_volume=3600, etsy_results=9000),
    P("dragonfly garden stake", google_volume=1900, etsy_results=4200),
    P("dragonfly garden art", google_volume=1300, etsy_results=5200),
    P("metal garden decor", etsy_results=21000, google_volume=9900, units=22, source="own"),
    P("garden stake", google_volume=12100, etsy_results=60000),
    P("outdoor metal art", google_volume=5400, etsy_results=80000, units=6, source="own"),
    P("metal fairy garden decor", etsy_searches=20, etsy_results=10600, etsy_conversion="very_high"),
    P("gift for gardener", google_volume=5400, etsy_results=320000),
]


def test_niche_market_lets_a_measured_high_conversion_phrase_open_the_title():
    p = plan.build(DRAGONFLY_POOL, DRAGONFLY, key="bennu:9", research=([], [], 0), use_ideas=False)
    assert p.shape == "niche"  # pazarı kategori ("metal yard art") değil ürünün kendi ifadesi belirler
    assert p.lead in ("metal dragonfly yard art", "metal dragonfly")
    assert "metal fairy garden decor" not in [t["tag"] for t in p.tags]  # kartta olmayan "fairy": model doğrulamadan girmez


def test_unverified_candidate_needs_the_model_and_only_confirmed_ones_enter(monkeypatch):
    seen = {}

    def fake_run(f, check, want_new, want_questions=True):
        seen["check"] = check
        return {"metal dragonfly lawn"} & set(check), [], [], []

    monkeypatch.setattr(plan.ideas, "run", fake_run)
    pool = [*DRAGONFLY_POOL, P("metal dragonfly lawn", google_volume=900, etsy_results=3000)]
    p = plan.build(pool, DRAGONFLY, key="bennu:9", research=([], [], 0), shop=object())
    assert "metal fairy garden decor" in seen["check"]
    tags = [t["tag"] for t in p.tags]
    assert "metal fairy garden decor" not in tags
    assert ("metal fairy garden decor", "kartta olmayan kelime: fairy") in p.rejected


SUN = facts_mod.from_listing("Square sunglasses", "Retro square sunglasses, thick glossy acrylic frame, unisex.", variations={"Color": ["Black", "Yellow", "Blue", "Grey"]},
                             product="square sunglasses")
SUN_POOL = [
    P("square sunglasses", google_volume=49500, etsy_results=90000),
    P("retro square sunglasses", google_volume=1900, etsy_results=12000),
    P("retro sunglasses", google_volume=40500, etsy_results=150000),
    P("gift for him", google_volume=201000, etsy_results=5000000),
    P("thick frame sunglasses", google_volume=2900, etsy_results=20000),
    P("polarized sunglasses", google_volume=90500, etsy_results=50000),
    P("black square sunglasses", google_volume=3600, etsy_results=30000),
    P("ray ban square", google_volume=22200, etsy_results=3000),
]


def test_google_only_market_is_crowded_and_generic_gift_phrase_does_not_lead():
    p = plan.build(SUN_POOL, SUN, key="bennu:sun", research=([], [], 0), use_ideas=False)
    assert p.shape == "crowded" and p.lead in ("retro square sunglasses", "thick frame sunglasses")  # genel ifade ya da hediye kalıbı açmaz
    tags = [t["tag"] for t in p.tags]
    assert "ray ban square" not in tags and "black square sunglasses" not in tags  # marka / varyasyondaki renk


def test_thin_pool_asks_ai_for_ideas_and_queues_them(monkeypatch):
    calls = {}
    monkeypatch.setattr(plan.ideas, "run", lambda f, check, want_new, want_questions=True: (set(), ["retro mod shades", "thick acrylic shades", "polarized shades"], ["are these uv400"], ["shades"]))
    monkeypatch.setattr(plan.sources, "queue_measurement", lambda shop, phrases: calls.setdefault("q", phrases) and len(phrases))
    p = plan.build(SUN_POOL[:2], SUN, key="k", research=([], [], 0), shop=object())
    tags = [t["tag"] for t in p.tags]
    assert "retro mod shades" in tags and "polarized shades" not in tags  # eşanlamlı (shades) karta girer, özellik (polarized) girmez
    assert ("polarized shades", "doğrulanmamış iddia") in p.rejected  # iddia kelimesi kartta yoksa elenir (ayrıca model doğrulamasına da gitmez)
    assert p.data["ideas"] == 2 and calls["q"] == ["retro mod shades", "thick acrylic shades"]
    assert any(q["q"] == "are these uv400" for q in p.questions)


def test_user_title_is_respected_and_tags_complete_from_written_ones():
    p = plan.build(SUN_POOL[:3], SUN, key="k", research=([], [], 0), use_ideas=False, current_title="Retro Square Sunglasses, Mod Acrylic Frame")
    assert p.lead == "retro square sunglasses"
    final = plan.place_tags(p, ["mod sunglasses", "acrylic shades", "retro square sunglasses"])
    assert len(final) == len(set(final)) and "mod sunglasses" in final
    assert plan.title_problems("Mod Shades for Summer", p) and not plan.title_problems("Retro Square Sunglasses, Unisex", p)


def test_brief_has_no_raw_numbers():
    text = _bottle("shopB:1").brief()
    assert "165000" not in text and "KELİME PLANI" in text or "KEYWORD PLAN" in text


def test_unverified_claim_phrases_and_near_duplicate_tags_do_not_enter_the_plan():
    sun = facts_mod.from_listing("Vintage square sunglasses", "Black and white frames.", variations={"Color": ["Black", "White"]}, product="vintage square sunglasses")
    pool = [P("vintage square sunglasses", google_volume=5000, etsy_results=40000), P("uv400 sunglasses", google_volume=9900, etsy_results=60000),
            P("polarized sunglasses", google_volume=90000, etsy_results=50000), P("mens sunglasses", google_volume=60000, etsy_results=90000),
            P("men sunglasses", google_volume=59000, etsy_results=95000), P("womens sunglasses", google_volume=70000, etsy_results=99000),
            P("women sunglasses", google_volume=69000, etsy_results=99500), P("retro square sunglasses", google_volume=2000, etsy_results=9000)]
    p = plan.build(pool, sun, key="k", research=([], [], 0), use_ideas=False)
    tags = [t["tag"] for t in p.tags]
    assert "uv400 sunglasses" not in tags and "polarized sunglasses" not in tags
    assert ("uv400 sunglasses", "doğrulanmamış iddia") in p.rejected
    from app.ai import quality
    assert len({quality.tag_key(t) for t in tags}) == len(tags)  # yakın-aynı etiket yok


def test_no_demand_evidence_still_gives_lead_options_so_the_title_check_is_never_empty():
    sun = facts_mod.from_listing("square sunglasses", "", [], [], {"Color": ["Black", "White"]}, product="square sunglasses", extra="siyah beyaz kare gözlük")
    pool = [P("retro sunglasses"), P("vintage sunglasses"), P("square sunglasses"), P("unisex sunglasses")]  # havuzda terim var ama hiçbirinin ölçümü yok
    p = plan.build(pool, sun, key="k", research=([], [], 0), use_ideas=False)
    assert p.lead_options and p.lead in p.lead_options
    assert plan.title_problems("Totally Unrelated Title For Something", p)  # artık boş seçenek her başlığı geçirmez


def test_claims_are_checked_against_what_the_user_said_not_what_the_model_wrote():
    from app.listing_plan import service

    said = "iki renk beyaz siyah kare gözlük"
    model_written = {"title": "Classic Square Sunglasses, UV400", "description": "UV400 protection sunglasses.", "tags": ["uv400 sunglasses"], "personalizable": False}
    facts = facts_mod.from_listing("square sunglasses", "", [], [], {}, False, product="square sunglasses", extra=said, said=said)
    assert fit.reason("uv400 sunglasses", facts) == "doğrulanmamış iddia"
    # model "facts" parametresine UV400 yazsa bile (bilinen kelimeye girer) iddia kullanıcı sözlerinde olmadığı için yine elenir
    with_model_facts = facts_mod.from_listing("square sunglasses", "", [], [], {}, False, product="square sunglasses", extra=said + " uv400", said=said)
    assert fit.reason("uv400 sunglasses", with_model_facts) == "doğrulanmamış iddia"
    assert service.for_listing  # said_only yolu içe aktarılabilir
    user_said_it = facts_mod.from_listing("square sunglasses", "", [], [], {}, False, product="square sunglasses", extra=said + " uv400 korumalı", said=said + " uv400 korumalı")
    assert fit.reason("uv400 sunglasses", user_said_it) is None


def test_title_check_accepts_the_opening_words_in_any_order_within_the_first_words():
    sun = facts_mod.from_listing("square sunglasses", "", [], [], {}, False, product="square sunglasses", extra="kare gözlük")
    p = plan.build([P("retro sunglasses", google_volume=900), P("vintage sunglasses", google_volume=800)], sun, key="k", research=([], [], 0), use_ideas=False)
    assert "retro sunglasses" in p.lead_options
    assert not plan.title_problems("Retro Square Sunglasses, Unisex", p)
    assert plan.title_problems("Classic Frames For Summer Days", p)


def test_unanswered_buyer_questions_are_asked_not_invented(monkeypatch):
    sun = facts_mod.from_listing("square sunglasses", "", [], [], {"Color": ["Black", "White"]}, product="square sunglasses", extra="siyah beyaz kare gözlük acrylic frame", said="siyah beyaz kare gözlük acrylic frame")
    qs = [{"q": "do these come with a case", "google_volume": 1600}, {"q": "are acrylic sunglasses durable", "google_volume": 300}, {"q": "what size sunglasses do i need", "google_volume": 900}]
    p = plan.build([P("retro sunglasses", google_volume=900)], sun, key="k", research=([], qs, 0), use_ideas=False)
    asked = [q["q"] for q in p.ask]
    assert "do these come with a case" in asked  # "case" kullanıcının sözlerinde yok: cevabı bilinmiyor, kullanıcıya sorulur
    assert "are acrylic sunglasses durable" not in asked  # "acrylic" biliniyor: cevap olgudan gelir
    assert len(asked) <= 2 and "KULLANICIYA SOR" in p.brief() or "ASK THE USER" in p.brief()


def test_when_the_pool_has_no_questions_the_ai_is_asked_for_them(monkeypatch):
    seen = {}

    def fake_run(f, check, want_new, want_questions=True):
        seen["want_questions"] = want_questions
        return set(), [], ["do these come with a case"], []

    monkeypatch.setattr(plan.ideas, "run", fake_run)
    monkeypatch.setattr(plan.sources, "queue_measurement", lambda shop, phrases: 0)
    sun = facts_mod.from_listing("square sunglasses", "", [], [], {}, product="square sunglasses", extra="kare gözlük", said="kare gözlük")
    p = plan.build([P("retro sunglasses", google_volume=900)] * 1 + [P(f"square sunglasses {i}", google_volume=900) for i in range(25)], sun, key="k", research=([], [], 0), shop=object())
    assert seen["want_questions"] is True and [q["q"] for q in p.ask] == ["do these come with a case"]

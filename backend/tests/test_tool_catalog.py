"""Araç kataloğu: karıştırılabilecek araçlar birbirine başvurur, her araç her yerde kayıtlıdır, çekirdek liste şişmez (oturum 47-51: toplu/tekli listing, kart/soru karışıklıkları)."""
from app.assistant import tools

BY_NAME = {t["name"]: t for t in tools.TOOLS}

# (araç, anmak ZORUNDA olduğu araç): yanlış olanı seçtirebilecek çiftler
CROSS_REFERENCES = [
    ("create_listing_draft", "create_listings_from_images"),
    ("create_listings_from_images", "create_listing_draft"),
    ("update_listing", "create_listing_draft"),
    ("update_listing", "edit_inventory"),
    ("edit_chat_image", "plan_listing_media"),
    ("plan_listing_media", "edit_chat_image"),
    ("ask_user", "brief_check"),
    ("edit_chat_image", "generate_chat_image"),
    ("generate_chat_image", "edit_chat_image"),
]
MAX_CORE_LISTING_TOOLS = 50  # çekirdek araçlar her listing konuşmasında modele gider: yenisi önce bir konu grubuna (TOOL_GROUPS) konmalı
MAX_DESCRIPTION = 1600


def test_names_are_unique_and_every_tool_is_registered_everywhere():
    names = [t["name"] for t in tools.TOOLS]
    assert len(names) == len(set(names)), "aynı adlı iki araç"
    for n in names:
        assert n in tools.EXECUTORS, f"{n}: yürütücü yok"
        assert n in tools.TOOL_LABELS and n in tools.TOOL_LABELS_EN, f"{n}: ilerleme metni (TR/EN) yok"


def test_descriptions_are_present_and_not_bloated():
    for t in tools.TOOLS:
        d = t["description"]
        assert d.strip(), f"{t['name']}: açıklama boş"
        assert len(d) <= MAX_DESCRIPTION, f"{t['name']}: açıklama {len(d)} karakter; kısalt ya da ayrıntıyı istem kuralına taşı"


def test_confusable_tools_point_at_each_other():
    for tool, other in CROSS_REFERENCES:
        assert other in BY_NAME[tool]["description"], f"{tool} açıklaması {other} aracını anmıyor: model yanlış olanı seçebilir"


def test_the_always_on_listing_tool_list_does_not_grow_unchecked():
    assert len(tools._CORE_LISTING_TOOLS) <= MAX_CORE_LISTING_TOOLS, f"çekirdek listing araçları {len(tools._CORE_LISTING_TOOLS)}: yeni araç bir TOOL_GROUPS grubuna konmalı"
    assert all(n in BY_NAME for n in tools._CORE_LISTING_TOOLS), "çekirdekte şeması olmayan araç"
    grouped = {n for names in tools.TOOL_GROUPS.values() for n in names}
    assert not grouped & tools._CORE_LISTING_TOOLS, "bir araç hem çekirdekte hem bir grupta"


def test_the_creation_phase_sends_only_the_tools_a_new_listing_needs():
    full = {t["name"] for t in tools.tools_for("listing", frozenset())}
    create = {t["name"] for t in tools.tools_for("listing", frozenset(), "create")}
    assert tools.CREATE_PHASE_TOOLS <= tools._CORE_LISTING_TOOLS, "kurulum araçlarının hepsi çekirdekte olmalı"
    assert create == tools.CREATE_PHASE_TOOLS and len(create) <= len(full) * 0.55, "kurulum aşamasında araç sayısı yaklaşık yarıya iner"
    assert {"create_listing_draft", "brief_check", "keyword_pool", "update_listing", "set_listing_attributes", "edit_chat_image"} <= create
    assert not create & {"publish_listing_draft", "delete_listing", "deactivate_listing", "discard_listing_changes", "copy_listing", "delete_description_templates"}, "yıkıcı/yayın araçları kurulumda yok"
    with_group = {t["name"] for t in tools.tools_for("listing", frozenset({"batch", "media"}), "create")}
    assert {"create_listings_from_images", "plan_listing_media"} <= with_group, "konu grupları kurulum aşamasında da açılır"
    assert tools.tools_for("listing", frozenset(), None) == tools.tools_for("listing", frozenset()), "phase verilmezse tam liste"


def test_creation_phase_detection():
    brief = [{"type": "brief"}]
    draft = [{"type": "listing_draft"}]
    suggest = [{"type": "choices", "kind": "suggestions", "options": ["a", "b"]}]
    assert tools.creation_phase("bu yeni bir ürün ve liste oluşturmak istiyorum", False, []) is True
    assert tools.creation_phase("bu resimden liste yap", True, []) is True, "resim var, taslak yok"
    assert tools.creation_phase("Var\nAbstract Bubble Cells Metal Wall Decor", False, [brief]) is True, "bekleyen ön kontrol kartının cevabı"
    assert tools.creation_phase("başlığı kısalt", False, [suggest, draft]) is False, "taslak oluştu: tam liste"
    assert tools.creation_phase("yeni bir ürün daha ekleyelim", False, [draft]) is True, "taslak varken açıkça yeni liste istenirse"
    assert tools.creation_phase("kaç taslağım var", False, []) is False, "kurulumla ilgisiz soru: tam liste"
    assert tools.creation_phase("evet", False, [suggest, brief]) is True, "araya düğme kartı girse de bekleyen kart sayılır"

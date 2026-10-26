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

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

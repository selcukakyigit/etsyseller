"""Kullanıcının söylemediği "UV400" gibi iddialar başlıkta/etiketlerde/açıklamada; birbirinin aynısı etiketler; bilgi vermeyen SSS cevabı."""
from app.ai import audit, quality

SRC = "iki renk var beyaz ve siyah. Vintage square sunglasses. Fiyat 25 $"
TAGS = ["classic sunglasses", "uv400 sunglasses", "retro sunglasses", "square sunglasses", "unisex sunglasses", "vintage sunglasses", "classic eyewear",
        "mens sunglasses", "women sunglasses", "fashion sunglasses", "uv400 protection", "fashion eyewear", "womens sunglasses"]
DESC = "Classic vintage square sunglasses.\n\nQUESTIONS\nDo these come with a case?\nPlease ask if you want one included."


def test_uv_claim_in_title_tags_and_description_is_a_problem_unless_the_user_said_it():
    problems = audit.generation_problems("Classic Vintage Square Sunglasses, UV400", TAGS, DESC, [], SRC, {"Color": ["White", "Black"]})
    assert any("UV400".lower() in p.lower() and "Başlık/etiketlerde" in p for p in problems)
    said = audit.generation_problems("Classic Vintage Square Sunglasses, UV400", TAGS, DESC, [], SRC + " UV400 korumalı", {"Color": ["White", "Black"]})
    assert not any("uv400" in p.lower() and "iddia" in p.lower() for p in said)


def test_near_duplicate_tags_are_reported():
    twins = quality.near_duplicate_tags(TAGS)
    assert ["women sunglasses", "womens sunglasses"] in twins
    assert any("neredeyse aynısı" in p or "near-duplicates" in p for p in quality.tag_problems(TAGS))


def test_evasive_faq_answer_is_flagged():
    assert quality.filler_problems(DESC)
    assert not quality.filler_problems("Sunglasses.\n\nQUESTIONS\nDo these come with a case?\nNo, they ship in a soft pouch.")

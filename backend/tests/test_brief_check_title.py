"""Ön kontrol kartı: başlık sorusu önerisiz gösterilmez (kullanıcı "Başlık önerisinden birini seçin" der ama liste boş kalıyordu)."""
from types import SimpleNamespace

from app.assistant.tools import brief_check

UNDERSTOOD = [{"label": "Ürün", "value": "Su termosu"}]


def _ctx(leads=None):
    return SimpleNamespace(cards=[], plan=SimpleNamespace(lead_options=leads) if leads else None)


def test_title_question_without_options_is_rejected():
    ctx = _ctx()
    out = brief_check(ctx, {"understood": UNDERSTOOD, "questions": [{"label": "Başlık önerisinden birini seçin veya kendi başlığınızı yazın"}]})
    assert "error" in out and ctx.cards == []


def test_typed_title_question_needs_three_options():
    ctx = _ctx()
    out = brief_check(ctx, {"understood": UNDERSTOOD, "questions": [{"label": "Pick a title", "type": "title", "options": ["A", "B"]}]})
    assert "error" in out and ctx.cards == []


def test_title_question_without_a_keyword_plan_asks_for_keyword_pool_first():
    out = brief_check(_ctx(), {"understood": UNDERSTOOD, "questions": [{"label": "Başlık seç", "options": ["One", "Two", "Three"]}]})
    assert "keyword_pool" in out["error"]


def test_title_options_must_open_with_the_plans_phrases():
    ctx = _ctx(["engraved thermos", "monogram water bottle"])
    out = brief_check(ctx, {"understood": UNDERSTOOD, "questions": [{"label": "Başlık seç", "options": ["Engraved Thermos, 750 ml", "Water Bottle Gift", "Monogram Water Bottle, Steel"]}]})
    assert "Water Bottle Gift" in out["error"] and ctx.cards == []


def test_title_question_with_options_becomes_title_card():
    ctx = _ctx(["one", "two", "three"])
    out = brief_check(ctx, {"understood": UNDERSTOOD, "questions": [
        {"label": "Fiyat?", "type": "price"},
        {"label": "Başlık seç", "options": ["One", "Two", "Three"]},
    ]})
    assert out["ok"]
    types = [q["type"] for q in ctx.cards[0]["questions"]]
    assert types == ["price", "title"]

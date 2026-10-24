"""Ön kontrol kartı: başlık sorusu önerisiz gösterilmez (kullanıcı "Başlık önerisinden birini seçin" der ama liste boş kalıyordu)."""
from types import SimpleNamespace

from app.assistant.tools import brief_check

UNDERSTOOD = [{"label": "Ürün", "value": "Su termosu"}]


def _ctx(leads=None):
    return SimpleNamespace(cards=[], plan=SimpleNamespace(lead_options=leads) if leads else None, message="", session_id=None, db=_NoDb())


class _NoDb:
    def scalars(self, *_a, **_k):
        return SimpleNamespace(all=lambda: [])


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


def test_title_option_with_a_claim_the_user_never_made_is_rejected():
    ctx = _ctx(["engraved thermos", "monogram water bottle", "steel bottle"])
    out = brief_check(ctx, {"understood": UNDERSTOOD, "questions": [{"label": "Başlık seç", "options": ["Engraved Thermos, UV400", "Monogram Water Bottle, Steel", "Steel Bottle, 750 ml"]}]})
    assert "UV400" in out["error"] and ctx.cards == []


def test_brief_check_reminds_once_to_ask_the_plans_unanswered_question():
    ctx = _ctx(["one", "two", "three"])
    ctx.plan.ask = [{"q": "do these come with a case", "demand": "high"}]
    ctx.ask_checked = False
    card = {"understood": UNDERSTOOD, "questions": [{"label": "Fiyat?", "type": "price"}]}
    first = brief_check(ctx, card)
    assert "case" in first["error"] and ctx.cards == []
    second = brief_check(ctx, card)  # ikinci çağrı geçer: kullanıcı soru yağmuruna tutulmaz
    assert second.get("ok")
    ctx2 = _ctx(["one", "two", "three"])
    ctx2.plan.ask, ctx2.ask_checked = [{"q": "do these come with a case", "demand": "high"}], False
    ok = brief_check(ctx2, {"understood": UNDERSTOOD, "questions": [{"label": "Kılıf var mı?", "options": ["Var", "Yok"], "plan_question": "Do these come with a case?"}]})
    assert ok.get("ok") and ctx2.cards[0]["questions"][0]["plan_question"] == "do these come with a case"


def test_plan_questions_always_get_a_skip_option():
    ctx = _ctx(["one", "two", "three"])
    ctx.plan.ask, ctx.ask_checked = [{"q": "do these come with a case", "demand": "high"}], False
    brief_check(ctx, {"understood": UNDERSTOOD, "questions": [{"label": "Kılıf var mı?", "options": ["Var", "Yok"], "plan_question": "do these come with a case"}]})
    options = ctx.cards[0]["questions"][0]["options"]
    assert options[:2] == ["Var", "Yok"] and len(options) == 3 and "atla" in options[2].lower() or "skip" in options[2].lower()

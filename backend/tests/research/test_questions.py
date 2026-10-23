"""Soru listesi: yalnızca gerçek sorular (sağlayıcı süzgeci "do"/"is" öneklerini sızdırmıştı)."""
from types import SimpleNamespace as NS

from app.research import discover, worker
from app.research.providers.dataforseo import DataForSeoProvider
from app.research.providers.base import Credentials
from app.research.questions import QUESTION_REGEX, is_question

SHOP = NS(id=1, workspace_id=1)


def test_is_question():
    assert is_question("how to hang metal wall art") and is_question("Is metal wall art outdated")
    assert not is_question("dolphin wall art metal") and not is_question("islamic wall art in metal")
    assert not is_question("don quixote metal wall art") and not is_question("how"), "tek kelime soru sayılmaz"


def test_provider_filter_keeps_the_trailing_wildcard_and_drops_false_positives(monkeypatch):
    captured = {}

    def fake_post(self, creds, path, body):
        captured["body"] = body
        items = [{"keyword": k, "keyword_info": {"search_volume": 10}} for k in ("how to hang metal wall art", "dolphin metal wall art", "what is metal art", "islamic wall art")]
        return {"result": [{"items": items}]}, 0.02, 5

    monkeypatch.setattr(DataForSeoProvider, "_post", fake_post)
    resp = DataForSeoProvider().suggestions(Credentials("l", "p"), "metal wall art", "US", "en", 100, questions=True)
    assert captured["body"]["filters"] == ["keyword", "regex", QUESTION_REGEX]
    assert QUESTION_REGEX.endswith(" .*"), "sondaki boşluk kırpılmasın diye desen .* ile bitmeli"
    assert [r.term for r in resp.records] == ["how to hang metal wall art", "what is metal art"]
    normal = DataForSeoProvider().suggestions(Credentials("l", "p"), "metal wall art", "US", "en", 100)
    assert len(normal.records) == 4 and "filters" not in captured["body"], "normal listede soru süzgeci yok"


def test_discover_questions_view_hides_non_questions_even_if_the_pool_has_them(db, provider):
    discover.search(db, SHOP, "metal farm sign", "questions")
    worker.run_once(db)
    result = discover.search(db, SHOP, "metal farm sign", "questions")
    assert sorted(i.term for i in result.items) == ["how to use metal farm sign", "what is metal farm sign"]

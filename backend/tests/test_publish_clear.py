"""Etsy'ye boş değer yazılamaz: boşaltılan etiket/materyal/stil listesi formdan düşer ve Etsy'de değişmez. Yerel önbellek bu yüzden "boşaltıldı" diye yanlış güncellenmemeli."""
import json
from types import SimpleNamespace as NS

from app.listings import drafts, service
from app.listings.schemas import ListingUpdateIn


def test_cleared_means_none_empty_list_or_empty_text_but_not_false_or_zero():
    assert all(drafts.is_cleared(v) for v in (None, [], ""))
    assert not any(drafts.is_cleared(v) for v in (False, 0, ["a"], "x", 0.0))


def test_empty_lists_are_not_sent_and_do_not_patch_the_local_cache(db, monkeypatch):
    sent = []
    row = NS(raw_json=json.dumps({"title": "t", "materials": ["Metal"], "tags": ["a"]}), title="t")
    monkeypatch.setattr(service, "_get_cache_row", lambda *a, **k: row)
    monkeypatch.setattr(service, "EtsyClient", lambda *a, **k: object())
    monkeypatch.setattr(service.etsy_listings, "update_listing", lambda client, listing_id, data: sent.append(data))
    monkeypatch.setattr(service, "_listing_edit_out", lambda r: None)
    monkeypatch.setattr(db, "commit", lambda: None)

    service.update_listing_fields(db, NS(id=1), 1, 7, ListingUpdateIn(materials=[], tags=["b"], title="new"))

    assert sent == [{"tags": ["b"], "title": "new"}], "boş liste Etsy'ye gönderilmez"
    cached = json.loads(row.raw_json)
    assert cached["materials"] == ["Metal"], "Etsy'de değişmediği için önbellek de boşaltılmış göstermez"
    assert cached["tags"] == ["b"] and row.title == "new"

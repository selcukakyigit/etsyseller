"""Etsy form gövdesi: listeler virgülle birleşir; Etsy'nin zorunlu tuttuğu `value_ids` boş olsa da gönderilir (serbest sayısal özellik, ör. ebat)."""
from app.etsy.client import encode_form


def test_lists_are_comma_joined_and_other_empty_lists_are_left_out():
    assert encode_form({"tags": ["a", "b"], "materials": [], "title": "x"}) == {"tags": "a,b", "title": "x"}


def test_free_form_property_sends_an_empty_value_ids_field():
    """Ebat gibi serbest sayısal özelliğin değer kimliği yoktur: `value_ids` yine gönderilmeli, yoksa Etsy "Missing input parameter: [value_ids]" der."""
    assert encode_form({"value_ids": [], "values": ["4696"], "scale_id": 327}) == {"value_ids": "", "values": "4696", "scale_id": 327}


def test_property_with_ids_is_unchanged():
    assert encode_form({"value_ids": [11, 12], "values": ["Black", "White"]}) == {"value_ids": "11,12", "values": "Black,White"}

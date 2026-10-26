"""Etsy'nin listing yazma kuralları tek modülde: temizleyiciler, yayın öncesi denetim, birlikte istenen alanlar; AI önerisi ve asistan aynı kuralları kullanır."""
from app.ai import quality
from app.assistant import tools
from app.listings import etsy_rules as rules
from app.listings import fields


def test_tags_keep_only_letters_digits_spaces_hyphen_and_apostrophe():
    assert rules.clean_tag("metal sign!") == "metal sign"
    assert rules.clean_tag("powder/coated  door-sign") == "powder coated door-sign"
    assert rules.clean_tag("dad’s garage") == "dad's garage", "tipografik kesme işareti düzeltilir"
    assert rules.clean_tag("Café 2 mm ™") == "Café 2 mm ™"


def test_materials_and_styles_allow_only_letters_digits_spaces():
    assert rules.clean_word("powder-coated metal") == "powder coated metal"
    assert rules.clean_word("2 mm.") == "2 mm"
    assert rules.clean_words(["Sheet Metal", "sheet metal", "a&b"], 13) == ["Sheet Metal", "a b"]
    assert rules.clean_words(["x" * 60], 2, 45) == ["x" * 45]


def test_title_special_characters_only_once_each():
    assert rules.clean_title("Address Planter Box: Metal Sign: Large") == "Address Planter Box: Metal Sign Large"
    assert rules.clean_title("A & B & C + D + E") == "A & B C + D E"
    assert rules.clean_title("Sign ★ Metal ✓ 😀 ™") == "Sign Metal ™", "simge ve emoji Etsy'nin kümesinde yok; ™ © ® var"
    assert rules.clean_title("Sign <b> a/b") == "Sign <b> a/b", "matematik simgesi ve noktalama serbest"


def test_preflight_reports_only_what_will_be_sent_and_where_it_lives():
    work = {"title": "Metal sign: A: B", "tags": ["good tag", "bad tag!", "x" * 21], "materials": ["powder-coated"], "style": ["a", "b", "c"], "item_weight": 0}
    out = rules.issues_for(work)
    keys = {(i["key"], i["section"]) for i in out}
    assert ("title", "sec-details") in keys and ("tags", "sec-attributes") in keys and ("materials", "sec-attributes") in keys
    assert ("style", "sec-attributes") in keys and ("item_weight", "sec-shipping") in keys
    assert len([i for i in out if i["key"] == "tags"]) == 2, "bozuk etiket ve uzun etiket ayrı ayrı"
    assert rules.issues_for(work, core={"description"}) == [], "gönderilmeyen alan (Etsy'de zaten kabul edilmiş eski değer) denetlenmez"
    assert [i["key"] for i in rules.issues_for(work, core={"item_weight"})] == ["item_weight"]


def test_grouped_fields_made_and_guarantee():
    assert rules.issues_for({"who_made": "i_did", "when_made": None}, core={"who_made"})[0]["section"] == "sec-made"
    guarantee = {"ecgt_garan_brand": "Acme", "ecgt_garan_years": 2, "ecgt_garan_model": None, "ecgt_garan_guarantee_details": None}
    out = rules.issues_for(guarantee, core={"ecgt_garan_brand"})
    assert {i["key"] for i in out} == {"ecgt"} and len(out) == 2, "eksik alanlar ve 3-99 yıl sınırı"
    done = {"ecgt_garan_brand": "Acme", "ecgt_garan_years": 5, "ecgt_garan_model": "M1", "ecgt_garan_guarantee_details": "Repair"}
    assert rules.issues_for(done, core={"ecgt_garan_brand"}) == []


def test_changed_member_pulls_in_the_rest_of_its_group():
    work = {"who_made": "i_did", "when_made": "made_to_order", "is_supply": False, "title": "t", "ecgt_garan_brand": "A", "ecgt_garan_years": 3, "ecgt_garan_model": "M", "ecgt_garan_guarantee_details": "D"}
    assert rules.complete_groups({"who_made": "i_did"}, work) == {"who_made": "i_did", "when_made": "made_to_order", "is_supply": False}
    assert set(rules.complete_groups({"ecgt_garan_years": 3}, work)) == set(rules.ECGT_GROUP)
    assert rules.complete_groups({"title": "t"}, work) == {"title": "t"}
    partial = {**work, "ecgt_garan_model": None}
    assert rules.complete_groups({"ecgt_garan_years": 3}, partial) == {"ecgt_garan_years": 3}, "eksik dörtlü gönderilmez (denetim bunu zaten durdurur)"


def test_parentheses_only_in_free_text_values_not_in_etsy_defined_ones():
    work = {"properties": [{"property_id": 1, "property_name": "Depth", "values": ["2 (mm)"], "value_ids": []}, {"property_id": 2, "property_name": "Color", "values": ["Black (matte)"], "value_ids": [9]}],
            "inventory": {"products": [{"property_values": [{"property_name": "Size", "values": ["Large (XL)"], "value_ids": []}]}]}}
    out = rules.issues_for(work, core=set())
    assert {i["key"] for i in out} == {"property", "inventory"} and len(out) == 2
    assert rules.issues_for(work, core=set(), props=set(), inventory=False) == []


def test_alt_text_limit():
    assert rules.issues_for({"images": [{"alt_text": "x" * 501}]}, core=set())[0]["section"] == "sec-media"
    assert rules.issues_for({"images": [{"alt_text": "x" * 500}]}, core=set()) == []


def test_ai_and_assistant_paths_use_the_same_cleaners():
    assert quality.clean_tags(["metal sign!", "Metal Sign", "dad’s garage"]) == ["metal sign", "dad's garage"]
    assert fields.clean_words(["powder-coated"], 13) == ["powder coated"]
    tags, short = tools._tags(["wall/art decor", "x" * 30])
    assert tags[0] == "wall art decor" and short, "asistan etiketi de temizlenir ve uzun etiket kısaltılır"


def test_client_rules_expose_the_same_character_sets():
    client = rules.rules_for_client()
    assert client["tag"]["max_len"] == rules.TAG_MAX_LEN and client["material"]["allowed"] == r"\p{L}\p{Nd}\p{Zs}"
    assert client["title"]["once_only"] == "%:&+"

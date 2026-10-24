"""Planın bağlandığı yerler: editördeki AI önerisi (seo) etiketleri plandan alır ve başlık açılışa uymazsa geri bildirimle yeniden dener;
kişiselleştirme kapatılınca kişiselleştirme etiketleri çıkar ve model başlık/açıklamayı yeniden yazmaya yönlendirilir. Model çağrısı sahte."""
from app.ai import seo
from app.assistant import tools
from app.listing_plan import facts as facts_mod
from app.listing_plan import plan as plan_mod

from tests.listing_plan.test_plan import BOTTLE, BOTTLE_POOL, BOTTLE_QUESTIONS


def _plan():
    return plan_mod.build(BOTTLE_POOL, BOTTLE, key="shopB:1", research=([], list(BOTTLE_QUESTIONS), 0), use_ideas=False)


def test_seo_suggestion_uses_plan_tags_and_retries_when_title_ignores_the_opening(monkeypatch):
    plan = _plan()
    calls = []
    model_tags = ["insulated bottle", "steel thermos", "travel mug", "gym bottle", "hiking bottle", "gift for runner", "cold drinks",
                  "metal flask", "sports bottle", "office bottle", "camping bottle", "picnic bottle", "school bottle"]

    def fake_call(content):
        calls.append(content)
        title = "Bottle For Water, Stainless Steel" if len(calls) == 1 else f"{plan.lead.title()}, Stainless Steel, 750 ml"
        return {"title": title, "tags": model_tags, "description": "A double-wall stainless steel bottle, 750 ml.", "materials": ["stainless steel"], "rationale": "x"}

    monkeypatch.setattr(seo, "_call", fake_call)
    listing = {"title": "Insulated water bottle", "tags": [], "description": "Double-wall stainless steel, 750 ml.", "materials": ["stainless steel"], "is_personalizable": True}
    out = seo.generate_seo_suggestion(listing, plan=plan, variations=BOTTLE.variations)
    assert "KELİME PLANI" in calls[0] or "KEYWORD PLAN" in calls[0]
    assert len(calls) >= 2 and plan.lead_options[0] in calls[1].split("Önceki denemende", 1)[1]  # başlık açılışa uymadı: seçenekler geri bildirimle gitti
    assert out["title"].lower().startswith(plan.lead)
    assert out["tags"][: len(plan.tags)] == [t["tag"] for t in plan.tags][:13]


def test_personalization_off_drops_personal_tags_and_asks_for_a_rewrite():
    work = {"title": "Personalized Square Sunglasses, Name or Initials", "description": "Retro shades. Add your initials.",
            "tags": ["personalized", "square sunglasses", "custom initials", "retro shades", "personalized shades"]}
    out = tools._after_personalization_off(work)
    assert work["tags"] == ["square sunglasses", "retro shades"]
    assert out["cikarilan_etiketler"] == ["personalized", "custom initials", "personalized shades"]
    assert "title" in out["kisisellestirme_kapatildi"] and "description" in out["kisisellestirme_kapatildi"]


def test_personalization_off_is_quiet_when_nothing_mentions_it():
    work = {"title": "Retro Square Sunglasses", "description": "Thick acrylic frame.", "tags": ["square sunglasses"]}
    assert tools._after_personalization_off(work) == {}


def test_lead_phrase_reads_the_first_title_segment():
    assert facts_mod.lead_phrase("Metal Dragonfly Yard Art, 60 cm Outdoor Decor") == "metal dragonfly yard art"
    assert facts_mod.lead_phrase("Engraved Thermos - Stainless Steel") == "engraved thermos"

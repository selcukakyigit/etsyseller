"""Toplu yeni listing (assistant/batch_drafts.py): doğrulama, çözümleme + ön kontrol, onaylanan bilgilerin olgu olarak verilmesi, ürün başına alt çalıştırma, hata yalıtımı, durdurma, araç sınırı."""
import time
from types import SimpleNamespace as NS

import pytest

from app.assistant import batch_drafts, llm, service, tools
from app.assistant.models import ChatImage
from app.assistant.toolsets import batch as batch_tools
from app.billing import metering
from app.shops.models import Shop

CATEGORIES = [{"taxonomy_id": 1027, "path": "Home & Living > Home Decor > Wall Decor", "share": 0.6}, {"taxonomy_id": 129, "path": "Art & Collectibles > Sculpture > Art Objects", "share": 0.2}]


def _shop(db, n=1):
    shop = Shop(user_id=1, workspace_id=n, etsy_shop_id=1000 + n, etsy_user_id=7, shop_name=f"Shop {n}")
    db.add(shop)
    db.commit()
    return shop


def _images(db, shop, ids, content_type="image/jpeg"):
    for i in ids:
        db.add(ChatImage(id=i, shop_id=shop.id, session_id=None, filename=f"{i}.jpg", content_type=content_type, path=f"/x/{i}"))
    db.commit()


@pytest.fixture
def fakes(monkeypatch):
    """Sahte model + sahte araç yürütücü: çözümleme `report_product` çağırır, oluşturma `create_listing_draft` çağırır; gerçek model, ağ ve gerçek taslak kodu çalışmaz."""
    monkeypatch.setattr(llm, "assistant_model", lambda: NS(provider="p", model_id="m"))
    monkeypatch.setattr(metering, "record", lambda *a, **k: None)
    monkeypatch.setattr(batch_drafts, "WORKERS", 1)  # sıralı: kardeş başlık davranışı belirli olsun
    monkeypatch.setattr(batch_drafts, "_categories", lambda shop_id, phrase: [dict(c) for c in CATEGORIES])
    seen = NS(analysis_texts=[], create_texts=[], create_images=[], create_tools=[], analysis_tools=[], executed=[], drafted=0, fail_first={}, never=set(), report={}, draft_taxonomy=111)

    def execute(ctx, name, args):
        seen.executed.append((name, dict(args), ctx.unattended))
        if name == "create_listing_draft":
            seen.drafted += 1
            return {"listing_id": 500 + seen.drafted, "yayin_icin_eksikler": ["Fiyat gir."], "kalite_uyarilari": []}
        return {"ok": True}

    def run_agent(model, static, dynamic, history, text, images, schemas, run):
        names = [t["name"] for t in schemas]
        first = images[0]["path"].rsplit("/", 1)[1]
        if names == ["report_product"]:
            seen.analysis_texts.append(text)
            seen.analysis_tools.append(names)
            report = {"name": f"Product {first}", "phrase": f"phrase {first}", "digital": first == "d1", "size": "", "material": "", "personalizable": False, "personalization_detail": "",
                      "weight_value": 1.5, "weight_unit": "lb", "unsure": ["size"], **seen.report.get(first, {})}
            run("report_product", report)
        else:
            seen.create_texts.append(text)
            seen.create_images.append(len(images))
            seen.create_tools = names
            calls = seen.fail_first.get(first, 0)
            if first in seen.never:
                pass  # model taslak kurmadan bitirir
            elif calls > 0:
                seen.fail_first[first] = calls - 1
            else:
                run("create_listing_draft", {"title": f"Title {first}", "image_ids": [first]})
        return llm.AgentResult("tamam", llm.Usage(provider="p", model="m"))

    monkeypatch.setattr(tools, "execute", execute)
    monkeypatch.setattr(tools, "_draft_work", lambda ctx, lid: {"taxonomy_id": seen.draft_taxonomy})
    monkeypatch.setattr(llm, "run_agent", run_agent)
    return seen


def _wait(job, until, seconds=10):
    end = time.time() + seconds
    while job.status not in until and time.time() < end:
        time.sleep(0.02)
    assert job.status in until, f"iş {until} durumuna gelmedi: {job.status}"


def _job(db, shop, items, shared="", review=True):
    job, error = batch_drafts.create_job(db, shop, 5, None, items, shared, review=review)
    assert error is None, error
    return job


def test_create_job_validates_items_images_and_ownership(db):
    shop, other = _shop(db, 1), _shop(db, 2)
    _images(db, shop, ["a1", "a2", "b1"])
    _images(db, other, ["o1"])
    _images(db, shop, ["doc1"], content_type="application/pdf")
    ok = lambda items: batch_drafts.create_job(db, shop, 5, None, items, "")  # noqa: E731
    assert ok([])[1] and ok("x")[1], "boş liste"
    assert ok([{"image_ids": ["a1"]}] * 16)[1], "en fazla 15 ürün"
    assert ok([{"image_ids": []}])[1], "resimsiz ürün"
    assert ok([{"image_ids": ["o1"]}])[1], "başka mağazanın resmi kullanılamaz"
    assert ok([{"image_ids": ["nope"]}])[1], "olmayan resim"
    assert ok([{"image_ids": ["doc1"]}])[1], "resim olmayan dosya"
    assert ok([{"image_ids": ["a1"]}, {"image_ids": ["a1", "a2"]}])[1], "aynı resim iki üründe olamaz"
    job, err = ok([{"image_ids": ["a1", "a2"], "note": " bir  not "}, {"image_ids": ["b1"]}])
    assert err is None and [i.index for i in job.items] == [1, 2] and job.items[0].note == "bir not" and job.status == "analyzing"


def test_analysis_stops_at_a_review_with_estimates_and_a_market_category(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1", "d1"])
    fakes.report = {"a1": {"size": "40 oz", "material": "stainless steel", "personalizable": True}, "d1": {"weight_value": 0}}
    job = _job(db, shop, [{"image_ids": ["a1"], "note": "termos"}, {"image_ids": ["d1"]}], "hepsi 20 adet")
    batch_drafts.start(job)
    _wait(job, {"review"})
    state = batch_drafts.public(job)
    assert (state["status"], state["analyzed"], state["done"]) == ("review", 2, 0) and fakes.drafted == 0, "onay gelmeden taslak kurulmaz"
    first, second = (i["spec"] for i in state["items"])
    assert first["name"] == "Product a1" and first["size"] == "40 oz" and first["material"] == "stainless steel" and first["personalizable"] is True
    assert (first["weight"], first["weight_unit"], first["weight_estimated"]) == (1.5, "lb", True), "ağırlık tahmindir ve işaretlenir"
    assert first["category_id"] == 1027 and first["categories"][0]["path"].endswith("Wall Decor"), "rakiplerin %60'ı Wall Decor: varsayılan o"
    assert second["digital"] is True and second["weight"] is None and second["unsure"] == ["size"]
    assert any("termos" in t and "hepsi 20 adet" in t for t in fakes.analysis_texts)
    assert all(names == ["report_product"] for names in fakes.analysis_tools), "çözümleme yalnızca rapor aracını görür"


def test_a_weak_market_signal_leaves_the_category_to_the_draft_step(db, fakes, monkeypatch):
    monkeypatch.setattr(batch_drafts, "_categories", lambda shop_id, phrase: [{"taxonomy_id": 129, "path": "Sculpture", "share": 0.3}])
    shop = _shop(db)
    _images(db, shop, ["a1"])
    job = _job(db, shop, [{"image_ids": ["a1"]}])
    batch_drafts.start(job)
    _wait(job, {"review"})
    assert batch_drafts.public(job)["items"][0]["spec"]["category_id"] is None


def test_confirmed_facts_reach_the_draft_run_and_category_and_weight_are_applied(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1", "a2", "a3", "a4", "a5", "b1"])
    job = _job(db, shop, [{"image_ids": ["a1", "a2", "a3", "a4", "a5"], "note": "metal sign, 49 $"}, {"image_ids": ["b1"]}], "hepsi stok 20")
    batch_drafts.start(job)
    _wait(job, {"review"})
    edits = [
        {"index": 1, "name": "Insulated tumbler", "size": "40 oz", "personalizable": True, "personalization_detail": "name engraving, 20 characters", "weight": 2.2, "weight_unit": "lb", "category_id": 129},
        {"index": 9, "name": "yok"},  # olmayan ürün: yok sayılır
    ]
    assert batch_drafts.confirm(job, edits) and not batch_drafts.confirm(job, edits), "onay yalnızca bir kez işler"
    _wait(job, {"done", "stopped"})
    state = batch_drafts.public(job)
    assert (state["status"], state["done"], state["failed"]) == ("done", 2, 0) and state["listing_ids"] == [501, 502]
    assert [i["title"] for i in state["items"]] == ["Title a1", "Title b1"]
    assert fakes.create_images == [4, 1], "model bir üründe en çok 4 resim görür, her ürün yalnızca kendi resimlerini"
    first, second = fakes.create_texts
    assert "40 oz" in first and "name engraving, 20 characters" in first and "taxonomy_id=129" in first and "metal sign, 49 $" in first and "hepsi stok 20" in first
    assert "BİLİNMİYOR" in second and "kişiselleştirme: YOK" in second, "bilinmeyen ölçü boş kalır, uydurulmaz"
    assert "Title a1" in second, "kardeş ürünün başlığı sonrakine söylenir (kopyalamasın)"
    calls = [(name, args) for name, args, _ in fakes.executed if name in ("set_listing_fields", "autofill_listing_attributes")]
    assert ("set_listing_fields", {"listing_id": 501, "taxonomy_id": 129}) in calls and ("autofill_listing_attributes", {"listing_id": 501}) in calls, "seçilen kategori kesin uygulanır, özellikler yeniden dolar"
    assert ("set_listing_fields", {"listing_id": 501, "weight": 2.2, "weight_unit": "lb"}) in calls
    assert state["items"][0]["estimated"] == [], "kullanıcının yazdığı ağırlık tahmini değil"
    assert state["items"][1]["estimated"] == ["weight"], "dokunulmayan ağırlık 'tahmini' diye işaretli kalır"
    assert all(unattended for _, _, unattended in fakes.executed), "alt çalıştırma soru soramaz"


def test_skip_review_goes_straight_to_drafts(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1", "b1"])
    job = _job(db, shop, [{"image_ids": ["a1"]}, {"image_ids": ["b1"]}], review=False)
    batch_drafts.start(job)
    _wait(job, {"done"})
    assert batch_drafts.public(job)["done"] == 2 and fakes.drafted == 2


def test_stopping_during_review_closes_the_job_without_drafts(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1", "b1"])
    job = _job(db, shop, [{"image_ids": ["a1"]}, {"image_ids": ["b1"]}])
    batch_drafts.start(job)
    _wait(job, {"review"})
    batch_drafts.stop(job)
    assert job.status == "stopped" and batch_drafts.public(job)["skipped"] == 2 and fakes.drafted == 0
    assert not batch_drafts.confirm(job), "kapanan iş onaylanamaz"


def test_edits_are_validated_and_clipped(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1"])
    job = _job(db, shop, [{"image_ids": ["a1"]}])
    batch_drafts.start(job)
    _wait(job, {"review"})
    batch_drafts.confirm(job, [{"index": 1, "name": "x" * 500, "size": "  40   oz ", "weight": "abc", "weight_unit": "stone", "category_id": 999999, "personalizable": 1, "unknown": "z"}])
    _wait(job, {"done"})
    spec = job.items[0].spec
    assert len(spec["name"]) == 120 and spec["size"] == "40 oz" and spec["weight"] is None and spec["weight_unit"] == "lb" and spec["personalizable"] is True
    assert spec["category_id"] == 1027, "seçeneklerde olmayan kategori kimliği yok sayılır (varsayılan kalır)"


def test_tools_in_a_draft_run_are_limited_to_drafting(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1"])
    job = _job(db, shop, [{"image_ids": ["a1"]}], review=False)
    batch_drafts.start(job)
    _wait(job, {"done"})
    assert "create_listing_draft" in fakes.create_tools and "keyword_pool" in fakes.create_tools
    for forbidden in ("ask_user", "brief_check", "publish_listing_draft", "delete_listing", "generate_listing_video", "generate_chat_image", "edit_chat_image", "create_listings_from_images"):
        assert forbidden not in fakes.create_tools, forbidden
    # yürütücü de izinsiz aracı reddeder (model uydursa bile)
    seen_result = {}
    original = llm.run_agent

    def sneaky(model, static, dynamic, history, text, images, schemas, run):
        if [t["name"] for t in schemas] != ["report_product"]:
            seen_result["r"] = run("publish_listing_draft", {"listing_id": 1})
        return original(model, static, dynamic, history, text, images, schemas, run)

    llm.run_agent = sneaky
    try:
        job2 = _job(db, shop, [{"image_ids": ["a1"]}], review=False)
        batch_drafts.start(job2)
        _wait(job2, {"done"})
    finally:
        llm.run_agent = original
    assert "error" in seen_result["r"]


def test_one_failure_does_not_stop_the_others_and_a_missed_draft_is_retried(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1", "b1", "c1"])
    fakes.never.add("b1")  # b1: model hiç taslak kurmuyor (iki denemede de)
    fakes.fail_first["c1"] = 1  # c1: ilk denemede kurmuyor, ikincide kuruyor
    job = _job(db, shop, [{"image_ids": ["a1"]}, {"image_ids": ["b1"]}, {"image_ids": ["c1"]}], review=False)
    batch_drafts.start(job)
    _wait(job, {"done"})
    state = batch_drafts.public(job)
    assert [i["state"] for i in state["items"]] == ["done", "failed", "done"]
    assert state["items"][1]["error"], "başarısız ürünün nedeni görünür"
    assert state["done"] == 2 and state["failed"] == 1 and len(state["listing_ids"]) == 2
    assert sum("ÖNCEKİ DENEMEDE" in t for t in fakes.create_texts) == 2, "b1 ve c1 bir kez yeniden denendi"


def test_the_tools_drive_the_job_and_jobs_are_per_shop(db, fakes):
    shop, other = _shop(db, 1), _shop(db, 2)
    _images(db, shop, ["a1", "b1"])
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, session_id=None)
    out = batch_tools.create_listings_from_images(ctx, {"items": [{"image_ids": ["a1"]}, {"image_ids": ["b1"]}], "shared": "hepsi 9 $"})
    assert out["baslatildi"] and out["urun_sayisi"] == 2 and ctx.cards[0]["type"] == "batch_job" and ctx.cards[0]["job_id"] == out["job_id"]
    job = batch_drafts.get(out["job_id"], shop.id)
    _wait(job, {"review"})
    waiting = batch_tools.batch_listings_status(ctx, {"job_id": out["job_id"]})
    assert waiting["durum"] == "review" and waiting["hazir"] == 0 and waiting["cozumlenen"] == 2, "durum aracı 'ön kontrol bekliyor' der, hazır demez"
    assert batch_drafts.get(out["job_id"], other.id) is None, "başka mağaza işi göremez"
    foreign = tools.Ctx(db=db, shop=other, user_id=5, today=None)
    assert batch_tools.stop_batch_listings(foreign, {"job_id": out["job_id"]})["error"] and batch_tools.start_batch_listings(foreign, {"job_id": out["job_id"]})["error"]
    assert batch_tools.start_batch_listings(ctx, {"job_id": out["job_id"]})["basladi"]
    _wait(job, {"done"})
    done = batch_tools.batch_listings_status(ctx, {"job_id": out["job_id"]})
    assert (done["durum"], done["hazir"]) == ("done", 2) and done["urunler"][0]["eksikler"] == ["Fiyat gir."]
    assert "basladi" not in batch_tools.start_batch_listings(ctx, {"job_id": out["job_id"]}), "bitmiş iş yeniden başlatılmaz"
    assert "error" in batch_tools.create_listings_from_images(ctx, {"items": []})


def test_the_skip_review_flag_is_passed_by_the_tool(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1"])
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, session_id=None)
    out = batch_tools.create_listings_from_images(ctx, {"items": [{"image_ids": ["a1"]}], "skip_review": True})
    assert out["on_kontrol_atlandi"] is True
    _wait(batch_drafts.get(out["job_id"], shop.id), {"done"})


def test_unattended_context_skips_the_ask_first_price_gate(db, monkeypatch):
    class PastTheGate(Exception):
        pass

    def stop_here(*a, **k):
        raise PastTheGate

    monkeypatch.setattr(tools, "_normalize_sizes", stop_here)  # kapıdan sonraki ilk adım: gerçek akış (ağ, kategori) çalışmasın
    shop = _shop(db)
    asked = tools.create_listing_draft(tools.Ctx(db=db, shop=shop, user_id=5, today=None), {"title": "Metal sign"})
    assert "brief_check" in asked["error"], "normal akışta fiyat yoksa önce ön kontrol kartı istenir"
    with pytest.raises(PastTheGate):
        tools.create_listing_draft(tools.Ctx(db=db, shop=shop, user_id=5, today=None, unattended=True), {"title": "Metal sign"})


def test_tool_group_opens_for_separate_product_requests():
    for text in ("5 farklı ürün, her biri ayrı listing olsun", "her resim ayrı listing", "make separate listings from these", "one listing per photo"):
        assert "batch" in tools.listing_groups(text, None), text
    assert "batch" not in tools.listing_groups("bu resimlerle bir listing oluştur", None)
    assert service.MODEL_IMAGES_PER_MESSAGE == 4
    assert "batch_listings_status" in service._READ_ONLY_TOOLS

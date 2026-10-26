"""Toplu yeni listing (assistant/batch_drafts.py): doğrulama, ürün başına alt çalıştırma, hata yalıtımı, durdurma, araç sınırı, mağaza yalıtımı."""
import time
from types import SimpleNamespace as NS

import pytest

from app.assistant import batch_drafts, llm, service, tools
from app.assistant.models import ChatImage
from app.assistant.toolsets import batch as batch_tools
from app.billing import metering
from app.shops.models import Shop


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
    """Sahte model + sahte araç yürütücü: model ürünün ilk resim kimliğinden bir taslak 'kurar'; gerçek model ve gerçek taslak kodu çalışmaz."""
    monkeypatch.setattr(llm, "assistant_model", lambda: NS(provider="p", model_id="m"))
    monkeypatch.setattr(metering, "record", lambda *a, **k: None)
    monkeypatch.setattr(batch_drafts, "WORKERS", 1)  # sıralı: kardeş başlık davranışı belirli olsun
    seen = NS(texts=[], images=[], tools=[], executed=[], drafted=0, fail_first={}, never=set())

    def execute(ctx, name, args):
        seen.executed.append((name, ctx.unattended))
        if name == "create_listing_draft":
            seen.drafted += 1
            return {"listing_id": 500 + seen.drafted, "yayin_icin_eksikler": ["Fiyat gir."], "kalite_uyarilari": []}
        return {"ok": True}

    def run_agent(model, static, dynamic, history, text, images, schemas, run):
        seen.texts.append(text)
        seen.images.append(len(images))
        seen.tools = [t["name"] for t in schemas]
        first_image = text.split("resim kimlikleri: ")[1].split(",")[0].split("\n")[0].strip()
        calls = seen.fail_first.get(first_image, 0)
        if first_image in seen.never:
            pass  # model taslak kurmadan bitirir
        elif calls > 0:
            seen.fail_first[first_image] = calls - 1
        else:
            run("create_listing_draft", {"title": f"Title {first_image}", "image_ids": [first_image]})
        return llm.AgentResult("tamam", llm.Usage(provider="p", model="m"))

    monkeypatch.setattr(tools, "execute", execute)
    monkeypatch.setattr(llm, "run_agent", run_agent)
    return seen


def _wait(job, seconds=10):
    end = time.time() + seconds
    while job.status == "running" and time.time() < end:
        time.sleep(0.02)
    assert job.status != "running", "iş zamanında bitmedi"


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
    assert err is None and [i.index for i in job.items] == [1, 2] and job.items[0].note == "bir not"


def test_each_product_runs_alone_unattended_with_only_its_own_images(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1", "a2", "a3", "a4", "a5", "b1"])
    job, _ = batch_drafts.create_job(db, shop, 5, None, [{"image_ids": ["a1", "a2", "a3", "a4", "a5"], "note": "metal sign, 49 $"}, {"image_ids": ["b1"]}], "hepsi stok 20")
    batch_drafts.start(job)
    _wait(job)
    state = batch_drafts.public(job)
    assert (state["status"], state["done"], state["failed"], state["total"]) == ("done", 2, 0, 2)
    assert [i["listing_id"] for i in state["items"]] == [501, 502] and state["listing_ids"] == [501, 502]
    assert [i["title"] for i in state["items"]] == ["Title a1", "Title b1"]
    assert state["items"][0]["missing"] == ["Fiyat gir."]
    assert fakes.images == [4, 1], "model bir üründe en çok 4 resim görür, her ürün yalnızca kendi resimlerini"
    assert "metal sign, 49 $" in fakes.texts[0] and "hepsi stok 20" in fakes.texts[0] and "b1" not in fakes.texts[0].split("Bu ürünün resim kimlikleri")[1].split("\n")[0]
    assert "Title a1" in fakes.texts[1], "kardeş ürünün başlığı sonrakine söylenir (kopyalamasın)"
    assert all(unattended for _, unattended in fakes.executed), "alt çalıştırma soru soramaz"


def test_tools_in_a_sub_run_are_limited_to_drafting(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1"])
    job, _ = batch_drafts.create_job(db, shop, 5, None, [{"image_ids": ["a1"]}], "")
    batch_drafts.start(job)
    _wait(job)
    assert "create_listing_draft" in fakes.tools and "keyword_pool" in fakes.tools
    for forbidden in ("ask_user", "brief_check", "publish_listing_draft", "delete_listing", "generate_listing_video", "generate_chat_image", "edit_chat_image", "create_listings_from_images"):
        assert forbidden not in fakes.tools, forbidden
    # ve yürütücü de izinsiz aracı reddeder (model uydursa bile)
    ctx_run = {}
    original = llm.run_agent

    def sneaky(model, static, dynamic, history, text, images, schemas, run):
        ctx_run["result"] = run("publish_listing_draft", {"listing_id": 1})
        return original(model, static, dynamic, history, text, images, schemas, run)

    llm.run_agent = sneaky
    try:
        job2, _ = batch_drafts.create_job(db, shop, 5, None, [{"image_ids": ["a1"]}], "")
        batch_drafts.start(job2)
        _wait(job2)
    finally:
        llm.run_agent = original
    assert "error" in ctx_run["result"]


def test_one_failure_does_not_stop_the_others_and_a_missed_draft_is_retried(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1", "b1", "c1"])
    fakes.never.add("b1")  # b1: model hiç taslak kurmuyor (iki denemede de)
    fakes.fail_first["c1"] = 1  # c1: ilk denemede kurmuyor, ikincide kuruyor
    job, _ = batch_drafts.create_job(db, shop, 5, None, [{"image_ids": ["a1"]}, {"image_ids": ["b1"]}, {"image_ids": ["c1"]}], "")
    batch_drafts.start(job)
    _wait(job)
    state = batch_drafts.public(job)
    assert [i["state"] for i in state["items"]] == ["done", "failed", "done"]
    assert state["items"][1]["error"], "başarısız ürünün nedeni görünür"
    assert state["done"] == 2 and state["failed"] == 1 and len(state["listing_ids"]) == 2
    assert sum("ÖNCEKİ DENEMEDE" in t for t in fakes.texts) == 2, "b1 ve c1 bir kez yeniden denendi"


def test_stop_skips_products_not_started(db, fakes):
    shop = _shop(db)
    _images(db, shop, ["a1", "b1"])
    job, _ = batch_drafts.create_job(db, shop, 5, None, [{"image_ids": ["a1"]}, {"image_ids": ["b1"]}], "")
    batch_drafts.stop(job)
    batch_drafts.start(job)
    _wait(job)
    assert batch_drafts.public(job)["skipped"] == 2 and job.status == "stopped" and fakes.drafted == 0


def test_tool_starts_the_job_adds_the_card_and_jobs_are_per_shop(db, fakes):
    shop, other = _shop(db, 1), _shop(db, 2)
    _images(db, shop, ["a1", "b1"])
    ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, session_id=None)
    out = batch_tools.create_listings_from_images(ctx, {"items": [{"image_ids": ["a1"]}, {"image_ids": ["b1"]}], "shared": "hepsi 9 $"})
    assert out["baslatildi"] and out["urun_sayisi"] == 2 and ctx.cards[0]["type"] == "batch_job" and ctx.cards[0]["job_id"] == out["job_id"]
    job = batch_drafts.get(out["job_id"], shop.id)
    _wait(job)
    assert batch_drafts.get(out["job_id"], other.id) is None, "başka mağaza işi göremez"
    assert batch_tools.stop_batch_listings(tools.Ctx(db=db, shop=other, user_id=5, today=None), {"job_id": out["job_id"]})["error"]
    assert "error" in batch_tools.create_listings_from_images(ctx, {"items": []})


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

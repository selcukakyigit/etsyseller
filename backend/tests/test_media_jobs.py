"""Çoklu medya üretimi (assistant/media_jobs.py + toolsets/media.py): maliyet kartı, düğmeyle başlatma, bakiye/durdurma, hata yalıtımı, model üretemez."""
import time
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

from app.assistant import media_jobs, service, tools
from app.assistant.toolsets import media as media_tools
from app.billing import credits
from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
from app.listings import generation
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

PRICES = (3, 10)  # resim, video (kredi)


def _shop(db, n=1):
    shop = Shop(user_id=1, workspace_id=n, etsy_shop_id=3000 + n, etsy_user_id=7, shop_name=f"Shop {n}")
    db.add(shop)
    db.commit()
    return shop


@pytest.fixture
def world(db, monkeypatch):
    """Sahte listing'ler, bakiye ve üretim: gerçek model, Etsy ve sağlayıcı çalışmaz."""
    shop = _shop(db)
    state = NS(
        listings={-1: {"title": "Tumbler", "images": 2, "videos": 0}, -2: {"title": "Pillow", "images": 19, "videos": 0}, -3: {"title": "No photo", "images": 0, "videos": 0}},
        balance=1000, enabled=True, made=[], videos=[], executed=[], image_errors={}, after_image=None, video_error=None,
    )

    def draft_work(ctx, lid):
        spec = state.listings[lid]
        return {"title": spec["title"], "images": [{"listing_image_id": 100 + i, "rank": i + 1} for i in range(spec["images"])], "videos": [{} for _ in range(spec["videos"])]}

    monkeypatch.setattr(tools, "_draft_work", draft_work)
    monkeypatch.setattr(media_jobs, "_prices", lambda seconds, want_video: (PRICES[0], PRICES[1] if want_video else 0))
    monkeypatch.setattr(credits, "enabled", lambda: state.enabled)
    monkeypatch.setattr(credits, "balance", lambda db_, ws: state.balance)
    monkeypatch.setattr(credits, "can_afford", lambda ws, amount: not state.enabled or state.balance >= amount)
    monkeypatch.setattr(generation, "source_photo", lambda db_, shop_, lid, photo: (b"img", "image/png"))
    monkeypatch.setattr(media_jobs, "WORKERS", 1)

    def make_image(job, ctx, lid, source, shot):
        if state.image_errors.get(lid):
            return state.image_errors[lid]
        state.balance -= PRICES[0]
        state.made.append((lid, shot))
        if state.after_image:
            state.after_image(job)
        return None

    def make_video(job, ctx, lid, photo):
        if state.video_error:
            return state.video_error
        state.balance -= PRICES[1]
        state.videos.append(lid)
        return None

    monkeypatch.setattr(media_jobs, "_make_image", make_image)
    monkeypatch.setattr(media_jobs, "_make_video", make_video)
    monkeypatch.setattr(tools, "execute", lambda ctx, name, args: state.executed.append((name, args)) or {"ok": True})
    state.ctx = tools.Ctx(db=db, shop=shop, user_id=5, today=None, session_id=None)
    state.shop = shop
    return state


def _wait(job, until, seconds=10):
    end = time.time() + seconds
    while job.status not in until and time.time() < end:
        time.sleep(0.02)
    assert job.status in until, f"iş {until} durumuna gelmedi: {job.status}"


def _plan(world, **args):
    out = media_tools.plan_listing_media(world.ctx, args)
    assert "error" not in out, out
    return out, media_jobs.get(out["job_id"], world.shop.id)


def test_the_tool_only_plans_and_shows_the_cost_card_nothing_is_generated(world):
    out, job = _plan(world, listing_ids=[-1, -2], images_per_listing=5, video=True)
    q = job.quote
    assert (job.status, world.made, world.videos) == ("quote", [], []), "kart çıkar, üretim yok"
    rows = {r["listing_id"]: r for r in media_jobs.public(job)["items"]}
    assert (rows[-1]["images"], rows[-1]["video"], rows[-1]["credits"]) == (5, True, 5 * 3 + 10)
    assert (rows[-2]["images"], rows[-2]["credits"]) == (1, 1 * 3 + 10) and rows[-2]["skipped"], "19 fotoğraflı listing'e yalnızca 1 resim sığar (Etsy 20), söylenir"
    assert (q["images"], q["videos"], q["credits"], q["affordable"], q["balance"]) == (6, 2, 25 + 13, True, 1000)
    card = world.ctx.cards[0]
    assert card["type"] == "media_job" and card["status"] == "quote" and card["job_id"] == out["job_id"] and out["onay_bekliyor"] and out["kredi"] == 38


def test_plan_validates_input(world):
    plan = lambda **a: media_tools.plan_listing_media(world.ctx, a)  # noqa: E731
    assert plan(listing_ids=[-1])["error"], "ne üretileceği belirtilmedi"
    assert plan(listing_ids=[-1], images_per_listing=11)["error"], "listing başına en fazla 10"
    assert "en fazla 15" in plan(listing_ids=list(range(-1, -40, -1)), images_per_listing=1)["error"]
    assert plan(images_per_listing=2)["error"], "listing belirtilmedi"
    assert plan(listing_ids=[-999], images_per_listing=2)["error"], "olmayan listing"
    assert plan(listing_ids=[-3], images_per_listing=0, video=True)["error"], "fotoğrafsız listing'e video üretilemez (resim yok)"
    assert plan(listing_ids=["x"], images_per_listing=1)["error"]


def test_pressing_start_runs_the_job_with_distinct_shots_and_alt_texts(world):
    _out, job = _plan(world, listing_ids=[-1, -2], images_per_listing=3, video=True, instruction="sıcak oturma odası")
    assert media_jobs.start(job) is None and media_jobs.start(job) is None
    _wait(job, {"done"})
    shots = [shot for lid, shot in world.made if lid == -1]
    assert len(shots) == 3 and len(set(shots)) == 3, "her ek resim farklı bir çekim"
    assert [lid for lid, _ in world.made].count(-2) == 1 and sorted(world.videos) == [-2, -1]
    state = media_jobs.public(job)
    assert (state["status"], state["images_total"], state["videos_total"], state["done"]) == ("done", 4, 2, 2)
    alt = [args["listing_id"] for name, args in world.executed if name == "generate_missing_alt_texts"]
    assert sorted(alt) == [-2, -1], "alt metinler üretilen görsele bakılarak yazılır"
    assert len(world.made) == 4, "ikinci start üretimi yinelemez"


def test_insufficient_balance_refuses_to_start_and_runs_dry_gracefully(world):
    world.balance = 5
    _out, job = _plan(world, listing_ids=[-1], images_per_listing=5)
    assert "Kredi yetersiz" in media_jobs.start(job) or "Not enough" in media_jobs.start(job)
    assert job.status == "quote" and world.made == []
    world.balance = 7  # 15 krediye ihtiyaç var, yalnızca ilk iki resme yeter... başlatmayı da reddeder
    assert media_jobs.start(job)
    world.balance = 15
    assert media_jobs.start(job) is None
    world.balance = 7  # iş sürerken bakiye düşer: üçüncü resimden önce durur
    _wait(job, {"done", "stopped"})
    assert len(world.made) == 2 and job.note, "bakiye bitince kalan üretimler durur ve söylenir"


def test_stop_before_start_and_while_running(world):
    _out, job = _plan(world, listing_ids=[-1], images_per_listing=4)
    media_jobs.stop(job)
    assert job.status == "stopped" and media_jobs.public(job)["skipped"] == 1 and media_jobs.start(job) is None and world.made == []

    world.after_image = lambda j: media_jobs.stop(j)  # ilk resimden sonra kullanıcı durdurur
    _out, job2 = _plan(world, listing_ids=[-1], images_per_listing=4)
    media_jobs.start(job2)
    _wait(job2, {"stopped", "done"})
    assert len(world.made) == 1 and job2.status == "stopped", "çalışan iş durdurulunca kalan resimler üretilmez, üretilen taslakta kalır"


def test_one_listing_failing_does_not_stop_the_others(world):
    world.image_errors = {-1: "Gemini görsel üretemedi"}
    _out, job = _plan(world, listing_ids=[-1, -2], images_per_listing=2)
    media_jobs.start(job)
    _wait(job, {"done"})
    rows = {r["listing_id"]: r for r in media_jobs.public(job)["items"]}
    assert rows[-1]["state"] == "failed" and rows[-1]["errors"] and rows[-2]["state"] == "done" and rows[-2]["images_done"] == 1


def test_a_failed_video_keeps_the_images(world):
    world.video_error = "Video zamanında hazırlanamadı."
    _out, job = _plan(world, listing_ids=[-1], images_per_listing=2, video=True)
    media_jobs.start(job)
    _wait(job, {"done"})
    row = media_jobs.public(job)["items"][0]
    assert (row["images_done"], row["video_done"], row["state"]) == (2, False, "done") and row["errors"] == ["Video zamanında hazırlanamadı."]


def test_credit_system_off_shows_a_free_cost_card(world):
    world.enabled = False
    _out, job = _plan(world, listing_ids=[-1], images_per_listing=2)
    assert job.quote["credits_enabled"] is False and job.quote["balance"] is None and job.quote["affordable"] is True
    world.balance = 0
    assert media_jobs.start(job) is None, "kredi sistemi kapalıyken bakiye engel olmaz"
    _wait(job, {"done"})


def test_jobs_are_per_shop_and_the_status_tool_never_says_done_early(world, db):
    _out, job = _plan(world, listing_ids=[-1], images_per_listing=1)
    other = _shop(db, 2)
    assert media_jobs.get(job.id, other.id) is None
    foreign = tools.Ctx(db=db, shop=other, user_id=5, today=None)
    assert media_tools.stop_media_job(foreign, {"job_id": job.id})["error"] and media_tools.media_job_status(foreign, {"job_id": job.id})["error"]
    assert media_tools.media_job_status(world.ctx, {"job_id": job.id})["durum"] == "quote"


def test_http_start_needs_the_button_and_reports_missing_credits(world, db):
    from app import main

    _out, job = _plan(world, listing_ids=[-1], images_per_listing=2)

    def _db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[get_current_user] = lambda: NS(id=5, is_admin=False)
    main.app.dependency_overrides[get_owned_shop] = lambda: world.shop
    try:
        client = TestClient(main.app)
        base = f"/api/shops/{world.shop.id}/assistant/media-jobs"
        assert client.get(f"{base}/nope").status_code == 404
        world.balance = 1
        assert client.post(f"{base}/{job.id}/start").status_code == 402, "bakiye yetmiyorsa üretim başlamaz"
        world.balance = 1000
        started = client.post(f"{base}/{job.id}/start")
        assert started.status_code == 200 and started.json()["status"] in ("running", "done")
        _wait(job, {"done"})
        assert client.get(f"{base}/{job.id}").json()["images_total"] == 2
    finally:
        main.app.dependency_overrides.clear()


def test_the_chat_guard_replaces_premature_claims_and_drops_suggestion_buttons():
    card = {"type": "media_job", "quote": {"images": 10, "videos": 1, "credits": 55, "credits_enabled": True}}
    cards = [card, {"type": "choices", "kind": "suggestions", "question": "?", "options": ["x"]}]
    reply = service._guard_media_reply({"plan_listing_media"}, cards, "Tamam, 10 resim ve video üretiyorum, hazır olunca eklerim.")
    assert cards == [card] and "55" in reply and "üretiliyor" not in reply and "[Üret]" in reply
    off = service._guard_media_reply({"plan_listing_media"}, [{**card, "quote": {**card["quote"], "credits_enabled": False}}], "Üretildi!")
    assert "ücretsiz" in off or "free" in off
    ok = "10 resim ve 1 video için maliyet kartı hazır; karttan onayla."
    assert service._guard_media_reply({"plan_listing_media"}, [dict(card)], ok) == ok, "doğru söyleyen cevap olduğu gibi kalır"
    untouched = [{"type": "choices", "kind": "suggestions"}]
    assert service._guard_media_reply({"keyword_pool"}, untouched, "Üretildi") == "Üretildi" and len(untouched) == 1


def test_media_words_open_the_tool_group():
    for text in ("şu liste için 10 tane resim üret ve bir de tanıtım videosu", "bütün taslaklara 5 resim ekle", "video üret", "generate 10 images for this listing", "make a promo video"):
        assert "media" in tools.listing_groups(text, None), text
    assert "media" not in tools.listing_groups("başlığı değiştir", None)

"""Asistanın destek aracı: ekranla aynı servis, onaylı açılış, sohbet bağlamı ve resimler, hız sınırı, kayıt."""
import json
from types import SimpleNamespace as NS

import pytest

from app.assistant import prompt, tools
from app.assistant.models import ChatImage, ChatMessage, ChatSession
from app.assistant.toolsets import support as tool
from app.auth.models import User
from app.support import limits, service
from app.support.models import Ticket

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


@pytest.fixture
def env(db, monkeypatch):
    monkeypatch.setattr(limits, "MIN_GAP_SECONDS", 0)
    monkeypatch.setattr(service.storage, "ensure_bucket", lambda *a, **k: None)
    monkeypatch.setattr(service.storage, "upload", lambda *a, **k: None)
    monkeypatch.setattr(tool.blobstore, "read", lambda path: PNG)
    mails = []
    monkeypatch.setattr(service, "notify_team", lambda *a: mails.append(a))
    user = User(supabase_id="sb-1", email="a@x.co", name="A", email_lang="tr")
    db.add(user)
    db.flush()
    session = ChatSession(shop_id=1, user_id=user.id)
    db.add(session)
    db.flush()
    db.add_all([
        ChatMessage(session_id=session.id, role="user", content="Fotoğraf yüklenmiyor"),
        ChatMessage(session_id=session.id, role="assistant", content="Hata mesajı ne diyor?"),
        ChatImage(id="img-1", shop_id=1, session_id=session.id, filename="a.png", content_type="image/png", path="p/a.png"),
        ChatImage(id="other-chat", shop_id=1, session_id=session.id + 99, filename="b.png", content_type="image/png", path="p/b.png"),
    ])
    db.commit()
    return NS(ctx=NS(db=db, shop=NS(id=1, shop_name="Demo"), user_id=user.id, session_id=session.id), user=user, mails=mails)


ARGS = {"subject": "Fotoğraf yüklenmiyor", "category": "bug", "body": "Listing 123 için fotoğraf yüklerken hata alıyorum."}


def test_nothing_is_opened_without_confirmation(env, db):
    out = tool.open_support_ticket(env.ctx, {**ARGS, "image_ids": ["img-1", "other-chat"]})
    assert out["pending_confirmation"] is True and out["eklenecek_resim"] == 1 and out["eklenecek_sohbet_mesaji"] == 2
    assert db.query(Ticket).count() == 0 and env.mails == []


def test_confirmed_ticket_carries_chat_and_images_and_notifies_the_team(env, db):
    out = tool.open_support_ticket(env.ctx, {**ARGS, "image_ids": ["img-1", "other-chat"], "confirm": True})
    t = db.get(Ticket, out["talep_no"])
    assert t.source == "assistant" and t.user_id == env.user.id and t.category == "bug"
    ctx = json.loads(t.context_json)
    assert ctx["shop"] == "Demo" and ctx["chat"] == ["Kullanıcı: Fotoğraf yüklenmiyor", "Asistan: Hata mesajı ne diyor?"]
    assert [a.filename for a in t.messages[0].attachments] == ["sohbet-resmi-1.png"], "başka sohbetin resmi eklenmez"
    assert env.mails and env.mails[0][0] == t.id and env.mails[0][-1] == "new"
    assert service.user_detail(t)["messages"][0]["attachments"], "kullanıcı kendi talebinde resmi görür"


def test_chat_can_be_left_out_and_short_texts_are_refused(env, db):
    out = tool.open_support_ticket(env.ctx, {**ARGS, "include_chat": False, "confirm": True})
    assert json.loads(db.get(Ticket, out["talep_no"]).context_json).get("chat") is None
    assert "error" in tool.open_support_ticket(env.ctx, {"subject": "a", "body": "b", "confirm": True})


def test_the_screen_rate_limit_applies_to_the_assistant_too(env, db):
    for _ in range(limits.MAX_TICKETS_PER_HOUR):
        assert "talep_no" in tool.open_support_ticket(env.ctx, {**ARGS, "confirm": True})
    assert "error" in tool.open_support_ticket(env.ctx, {**ARGS, "confirm": True})


def test_my_tickets_lists_only_own_requests(env, db):
    mine = tool.open_support_ticket(env.ctx, {**ARGS, "confirm": True})["talep_no"]
    stranger = User(supabase_id="sb-2", email="b@x.co")
    db.add(stranger)
    db.commit()
    theirs = service.create_ticket(db, stranger, "Başkası", "bug", "başkasının talebi", {}, []).id
    assert [r["talep_no"] for r in tool.my_support_tickets(env.ctx, {})["talepler"]] == [mine]
    assert "error" in tool.my_support_tickets(env.ctx, {"ticket_id": theirs}), "başkasının talebi görünmez"
    assert tool.my_support_tickets(env.ctx, {"ticket_id": mine})["mesajlar"][0]["yazan"] == "kullanıcı"


def test_tools_are_registered_everywhere_the_assistant_needs_them():
    names = {"open_support_ticket", "my_support_tickets"}
    assert names <= set(tools.EXECUTORS) and names <= set(tools.TOOL_LABELS) and names <= set(tools.TOOL_LABELS_EN)
    assert names <= tools.LISTING_TOOL_NAMES and names == tools.TOOL_GROUPS["support"]
    assert tools.listing_groups("bunu destek ekibine ilet", None) >= {"support"}
    assert "- DESTEK TALEBİ" in prompt.static_rules("listing", frozenset({"support"})) and "- DESTEK TALEBİ" not in prompt.static_rules("listing")

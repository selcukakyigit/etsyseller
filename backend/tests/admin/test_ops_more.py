"""Yönetim paneli: kalıcı Etsy sayacı, hatadan etkilenen kullanıcılar, yeni hata e-postası ve toplu duyuru e-postası."""
import datetime as dt
import time

import pytest

from app.admin import broadcast
from app.admin.deps import AdminError
from app.admin.models import EmailBroadcast
from app.admin.schemas import BroadcastIn
from app.auth.access import UserAccess
from app.auth.models import User
from app.etsy import call_counter, rate_limit
from app.support import alerts, errors
from app.support.models import ErrorGroup


@pytest.fixture
def counter(db, monkeypatch):
    for name, value in {"_persist": True, "_calls": 0, "_day": "", "_unsaved": {}, "_saved": 0, "_saved_day": "", "MIN_INTERVAL_SECONDS": 0}.items():
        monkeypatch.setattr(rate_limit, name, value)


def test_etsy_counter_survives_restart_and_sees_other_processes(counter):
    today = dt.datetime.utcnow().date()
    for _ in range(3):
        rate_limit.throttle()
    assert rate_limit.calls_today() == 0 or rate_limit.calls_today() == 3  # veritabanı okunmadan önce bellek sayısı
    rate_limit.flush()
    assert call_counter.add(today, 0) == 3 and rate_limit.calls_today() == 3

    rate_limit.throttle()
    assert rate_limit.calls_today() == 4  # henüz yazılmayan da sayılır
    call_counter.add(today, 10)  # başka süreç (worker) ekledi
    rate_limit.flush()
    assert rate_limit.calls_today() == 14

    # "yeniden başlatma": bellek sıfırlanır, toplam veritabanından gelir
    rate_limit._calls, rate_limit._day, rate_limit._unsaved, rate_limit._saved, rate_limit._saved_day = 0, "", {}, 0, ""
    rate_limit.flush()
    assert rate_limit.calls_today() == 14
    assert rate_limit.background_budget_ok()


def test_etsy_counter_keeps_unsaved_when_database_fails(counter, monkeypatch):
    for _ in range(2):
        rate_limit.throttle()

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(call_counter, "add", boom)
    with pytest.raises(RuntimeError):
        rate_limit.flush()
    assert rate_limit._unsaved[rate_limit._today()] == 2  # kaybolmadı, sonraki turda yazılır


def test_error_group_counts_distinct_users_and_alerts_once(db, monkeypatch):
    sent = []
    monkeypatch.setattr(errors.alerts, "notify", lambda *a: sent.append(a))
    users = [User(supabase_id=f"sb-{i}", email=f"u{i}@x.co") for i in range(2)]
    db.add_all(users)
    db.commit()

    errors.record(db, "client", "TypeError: x is undefined", user_id=users[0].id)
    errors.record(db, "client", "TypeError: x is undefined", user_id=users[0].id)  # aynı kullanıcı, tekrar
    errors.record(db, "client", "TypeError: x is undefined", user_id=users[1].id)
    errors.record(db, "client", "TypeError: x is undefined")  # kullanıcısız
    row = errors.list_groups(db, "open")[0]
    assert row["count"] == 4 and row["affected_users"] == 2 and len(sent) == 1  # yalnızca ilk görülüşte haber verildi

    errors.set_status(db, db.query(ErrorGroup).one().id, "resolved")
    errors.record(db, "client", "TypeError: x is undefined", user_id=users[0].id)  # çözülmüşken geri geldi
    assert len(sent) == 2 and errors.list_groups(db, "open")[0]["affected_users"] == 2


def test_alert_email_respects_switch_config_and_hourly_cap(db, monkeypatch):
    calls = []
    monkeypatch.setattr(alerts, "_send", lambda *a: calls.append(a))
    monkeypatch.setattr(alerts, "_sent", [])
    monkeypatch.setattr(alerts, "email_configured", lambda: False)
    alerts.notify("boom", "server")
    time.sleep(0.1)
    assert calls == []  # e-posta yapılandırılmamış

    monkeypatch.setattr(alerts, "email_configured", lambda: True)
    alerts.set_enabled(db, False)
    alerts.notify("boom", "server")
    time.sleep(0.1)
    assert calls == []  # anahtar kapalı

    alerts.set_enabled(db, True)
    for i in range(alerts.MAX_PER_HOUR + 3):
        alerts.notify(f"boom {i}", "server")
    time.sleep(0.3)
    assert len(calls) == alerts.MAX_PER_HOUR  # saatlik tavan


@pytest.fixture
def audience(db, monkeypatch):
    monkeypatch.setattr(broadcast, "PAUSE_SECONDS", 0)
    monkeypatch.setattr(broadcast, "email_configured", lambda: True)
    people = [("a@x.co", "tr", None), ("b@x.co", "en", None), ("c@x.co", "tr", "suspended"), ("d@x.co", "en", "blocked"), ("e@x.co", "en", "active")]
    for i, (email, lang, status) in enumerate(people):
        user = User(supabase_id=f"sb-b{i}", email=email, email_lang=lang)
        db.add(user)
        db.flush()
        if status:
            db.add(UserAccess(user_id=user.id, status=status))
    admin = User(supabase_id="sb-adm", email="admin@x.co")
    db.add(admin)
    db.commit()
    return admin


DATA = BroadcastIn(subject_tr="Bakım", subject_en="Maintenance", body_tr="Bu gece kısa bakım var.", body_en="Short maintenance tonight.")


def _wait_done(db, broadcast_id):
    for _ in range(100):
        db.expire_all()
        row = db.get(EmailBroadcast, broadcast_id)
        if row.status != "sending":
            return row
        time.sleep(0.05)
    raise AssertionError("gönderim bitmedi")


def test_broadcast_preview_skips_suspended_and_blocked(db, audience):
    out = broadcast.preview(db)
    assert (out.recipients, out.tr, out.en) == (4, 1, 3)  # a, b, e + yönetici (aktif)


def test_broadcast_draft_lifecycle(db, audience):
    draft = broadcast.create(db, audience, BroadcastIn(subject_tr="Yarım"))  # yarım taslak kaydedilebilir
    assert draft.status == "draft" and draft.created_by == "admin@x.co"
    with pytest.raises(AdminError):
        broadcast.start(db, draft.id, confirm_count=4)  # eksik taslak gönderilmez
    with pytest.raises(AdminError):
        broadcast.send_test(audience, BroadcastIn(subject_tr="Yarım"))

    assert broadcast.update(db, draft.id, DATA).subject_en == "Maintenance"
    assert [b.id for b in broadcast.list_all(db)] == [draft.id]
    broadcast.delete(db, draft.id)
    with pytest.raises(AdminError):
        broadcast.update(db, draft.id, DATA)


def test_broadcast_sends_in_each_language_and_then_is_locked(db, audience, monkeypatch):
    sent = []
    monkeypatch.setattr(broadcast, "send_email", lambda to, subject, html, text, reply_to=None, **k: sent.append((to[0], subject)) or True)
    draft = broadcast.create(db, audience, DATA)
    with pytest.raises(AdminError):
        broadcast.start(db, draft.id, confirm_count=99)  # alıcı sayısı değişti
    assert sent == []

    assert broadcast.start(db, draft.id, confirm_count=4).status == "sending"
    row = _wait_done(db, draft.id)
    assert (row.status, row.sent, row.failed, row.total) == ("done", 4, 0, 4)
    assert sorted(sent) == [("a@x.co", "Bakım"), ("admin@x.co", "Maintenance"), ("b@x.co", "Maintenance"), ("e@x.co", "Maintenance")]

    with pytest.raises(AdminError):
        broadcast.update(db, draft.id, DATA)  # gönderilmiş kayıt değişmez
    again = broadcast.create(db, audience, DATA)
    with pytest.raises(AdminError):
        broadcast.start(db, again.id, confirm_count=4)  # hemen ikinci gönderim engellenir (bekleme)


def test_broadcast_counts_failures_and_blocks_parallel_send(db, audience, monkeypatch):
    monkeypatch.setattr(broadcast, "send_email", lambda *a, **k: False)
    running = broadcast.create(db, audience, DATA)
    row = db.get(EmailBroadcast, running.id)
    row.status = "sending"
    db.commit()
    other = broadcast.create(db, audience, DATA)
    with pytest.raises(AdminError):
        broadcast.start(db, other.id, confirm_count=4)  # biri sürerken ikincisi başlamaz

    broadcast._run(running.id, [("a@x.co", "tr"), ("b@x.co", "en")])
    db.expire_all()
    done = db.get(EmailBroadcast, running.id)
    assert (done.status, done.failed, done.sent) == ("done", 2, 0) and done.finished_at is not None


def test_broadcast_recovers_interrupted_sends_on_startup(db, audience):
    draft = broadcast.create(db, audience, DATA)
    db.get(EmailBroadcast, draft.id).status = "sending"
    db.commit()
    broadcast.recover(db)
    db.expire_all()
    assert db.get(EmailBroadcast, draft.id).status == "interrupted"


def test_broadcast_test_goes_only_to_the_admin(db, audience, monkeypatch):
    sent = []
    monkeypatch.setattr(broadcast, "send_email", lambda to, subject, html, text, reply_to=None, **k: sent.append((to, subject)) or True)
    broadcast.send_test(audience, DATA)
    assert sent == [(["admin@x.co"], "Bakım"), (["admin@x.co"], "Maintenance")]
    monkeypatch.setattr(broadcast, "email_configured", lambda: False)
    with pytest.raises(AdminError):
        broadcast.send_test(audience, DATA)

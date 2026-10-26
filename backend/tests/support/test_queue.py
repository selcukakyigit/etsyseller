"""Destek kuyruğu: hız sınırları, atama/öncelik/etiket iş kaydı, görünümler, rapor ve uçlar."""
import datetime as dt

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.admin.deps import admin_only
from app.auth.access import UserAccess
from app.auth.models import User
from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
from app.support import limits, queue, report, service, taxonomy


def _user(db, n: int, admin: bool = False) -> User:
    u = User(supabase_id=f"sb-{n}", email=f"u{n}@x.co", name=f"User {n}")
    db.add(u)
    db.flush()
    if admin:
        db.add(UserAccess(user_id=u.id, role="admin", status="active"))
    db.commit()
    return u


@pytest.fixture(autouse=True)
def no_gap(monkeypatch):
    monkeypatch.setattr(limits, "MIN_GAP_SECONDS", 0)  # art arda gönderim sınırı kendi testinde açılır


def _open(db, user, subject="Fotoğraf yüklenmiyor", category="bug", body="Resim yükleyemiyorum"):
    return service.create_ticket(db, user, subject, category, body, {}, [])


def test_ticket_gets_a_number_a_source_and_a_created_event(db):
    user = _user(db, 1)
    t = service.create_ticket(db, user, "Merhaba", "weird", "gövde gövde", {}, [], source="assistant")
    assert t.id and t.category == "other" and t.source == "assistant" and t.priority == "normal"
    assert [(e.kind, e.detail) for e in t.events] == [("created", "assistant")]


def test_new_ticket_rate_limit_is_per_hour(db):
    user = _user(db, 1)
    for _ in range(limits.MAX_TICKETS_PER_HOUR):
        _open(db, user)
    with pytest.raises(HTTPException) as err:
        _open(db, user)
    assert err.value.status_code == 429
    assert _open(db, _user(db, 2)).id, "sınır kullanıcıya özeldir"


def test_user_messages_are_limited_in_total_across_tickets(db, monkeypatch):
    user = _user(db, 1)
    a, b = _open(db, user), _open(db, user)
    monkeypatch.setattr(limits, "MAX_MESSAGES_PER_USER_HOUR", 4)
    service.add_message(db, a, "user", "bir", [])  # iki talebin ilk mesajı da sayılır (2) + bu (3)
    service.add_message(db, b, "user", "iki", [])
    with pytest.raises(HTTPException) as err:
        service.add_message(db, a, "user", "üç", [])
    assert err.value.status_code == 429, "taleplere yayılsa da toplam sınır geçerli"


def test_messages_sent_back_to_back_are_refused(db, monkeypatch):
    user = _user(db, 1)
    t = _open(db, user)
    service.add_message(db, t, "user", "ilk", [])
    monkeypatch.setattr(limits, "MIN_GAP_SECONDS", 60)
    with pytest.raises(HTTPException) as err:
        service.add_message(db, t, "user", "hemen bir daha", [])
    assert err.value.status_code == 429


def test_reply_mail_to_the_team_is_sent_once_per_ten_minutes_per_ticket(db):
    assert limits.allow_team_reply_mail(9001) is True
    assert limits.allow_team_reply_mail(9001) is False
    assert limits.allow_team_reply_mail(9002) is True


def test_admin_changes_are_validated_and_recorded(db):
    owner, boss, other = _user(db, 1), _user(db, 2, admin=True), _user(db, 3)
    t = _open(db, owner)
    staff_ids = {u.id for u in queue.staff(db)}
    assert staff_ids == {boss.id}
    changes = {"assignee_id": boss.id, "priority": "urgent", "labels": ["photos", "nonsense", "photos"], "status": "resolved"}
    assert service.update_ticket(db, t, boss, changes, staff_ids) is True
    assert t.assignee_id == boss.id and t.priority == "urgent" and t.resolved_at is not None
    assert [l.label for l in t.labels] == ["photos"]
    assert [e.kind for e in t.events] == ["created", "status", "assignee", "priority", "labels"]
    assert service.update_ticket(db, t, boss, {"status": "resolved"}, staff_ids) is False, "zaten tamamlanmış: yeniden bildirim yok"
    with pytest.raises(HTTPException) as err:
        service.update_ticket(db, t, boss, {"assignee_id": other.id}, staff_ids)
    assert err.value.status_code == 422, "yalnızca yöneticilere atanır"
    service.update_ticket(db, t, boss, {"labels": ["billing"]}, staff_ids)
    assert [l.label for l in t.labels] == ["billing"]


def test_first_response_time_is_set_by_the_first_public_admin_reply_only(db):
    owner = _user(db, 1)
    t = _open(db, owner)
    service.add_message(db, t, "admin", "iç not", [], internal=True)
    assert t.first_response_at is None
    service.add_message(db, t, "admin", "merhaba", [])
    first = t.first_response_at
    assert first is not None
    service.add_message(db, t, "admin", "bir daha", [])
    assert t.first_response_at == first


def test_views_counts_and_number_search(db):
    owner, boss = _user(db, 1), _user(db, 2, admin=True)
    a, b, c = _open(db, owner, "Alfa"), _open(db, owner, "Beta", "billing"), _open(db, owner, "Gama")
    staff = {boss.id}
    service.update_ticket(db, a, boss, {"assignee_id": boss.id}, staff)
    service.update_ticket(db, c, boss, {"status": "resolved"}, staff)
    b.updated_at = dt.datetime.utcnow() - dt.timedelta(hours=taxonomy.OVERDUE_HOURS + 1)
    db.commit()

    def ids(view, **kw):
        return {i["id"] for i in queue.list_page(db, boss, view=view, **kw)["items"]}

    assert ids("open") == {a.id, b.id} and ids("mine") == {a.id} and ids("unassigned") == {b.id}
    assert ids("overdue") == {b.id} and ids("resolved") == {c.id} and ids("all") == {a.id, b.id, c.id}
    assert queue.counts(db, boss) == {"open": 2, "mine": 1, "unassigned": 1, "unread": 3, "waiting": 0, "overdue": 1, "resolved": 1, "all": 3}
    assert ids("all", q=f"#{b.id}") == {b.id}, "talep numarasıyla bulunur"
    assert ids("all", q="u1@x.co") == {a.id, b.id, c.id}
    assert ids("all", category="billing") == {b.id}


def test_list_is_paginated_and_urgent_comes_first(db, monkeypatch):
    owner, boss = _user(db, 1), _user(db, 2, admin=True)
    monkeypatch.setattr(queue, "PAGE_SIZE", 2)
    ts = [_open(db, owner, f"T{i}") for i in range(3)]
    service.update_ticket(db, ts[2], boss, {"priority": "urgent"}, {boss.id})
    for t in ts:
        t.admin_unread = False
    db.commit()
    first = queue.list_page(db, boss, view="all")
    assert first["total"] == 3 and first["pages"] == 2 and first["items"][0]["id"] == ts[2].id
    assert len(queue.list_page(db, boss, view="all", page=1)["items"]) == 1


def test_detail_shows_internal_notes_events_and_suggests_labels(db):
    owner, boss = _user(db, 1), _user(db, 2, admin=True)
    t = _open(db, owner, "Ödeme yapamıyorum", "billing", "Kredi satın alırken fatura hatası")
    service.add_message(db, t, "admin", "gizli", [], internal=True)
    d = queue.detail(db, service.admin_ticket(db, t.id))
    assert "billing" in d["suggested_labels"] and d["events"][0]["kind"] == "created" and d["messages"][-1]["internal"] is True
    service.update_ticket(db, t, boss, {"labels": ["billing"]}, {boss.id})
    assert queue.detail(db, service.admin_ticket(db, t.id))["suggested_labels"] == []


def test_report_counts_and_medians(db):
    owner, boss = _user(db, 1), _user(db, 2, admin=True)
    t = _open(db, owner)
    service.update_ticket(db, t, boss, {"labels": ["photos"]}, {boss.id})
    t.created_at = dt.datetime.utcnow() - dt.timedelta(hours=10)
    t.first_response_at = t.created_at + dt.timedelta(hours=2)
    db.commit()
    _open(db, owner, "İkinci")
    r = report.build(db, 7)
    assert r["created"] == 2 and r["open_now"] == 2 and r["first_response_hours"] == 2.0
    assert r["by_label"] == {"photos": 1} and r["unlabelled"] == 1 and r["by_source"] == {"web": 2}


@pytest.fixture
def client(db):
    from app import main

    admin = _user(db, 50, admin=True)

    def _db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[get_current_user] = lambda: admin
    main.app.dependency_overrides[admin_only] = lambda: admin
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_admin_endpoints(client, db):
    owner = _user(db, 1)
    t = _open(db, owner)
    opts = client.get("/api/admin/tickets/options").json()
    assert {l["key"] for l in opts["labels"]} == set(taxonomy.LABELS) and len(opts["staff"]) == 1
    page = client.get("/api/admin/tickets", params={"view": "unassigned"}).json()
    assert page["total"] == 1 and page["counts"]["unassigned"] == 1 and page["items"][0]["user"]["email"] == "u1@x.co"
    staff_id = opts["staff"][0]["id"]
    body = client.patch(f"/api/admin/tickets/{t.id}", json={"assignee_id": staff_id, "priority": "low", "labels": ["photos"]}).json()
    assert body["assignee"]["id"] == staff_id and body["priority"] == "low" and body["labels"] == ["photos"]
    assert client.patch(f"/api/admin/tickets/{t.id}", json={"priority": "bogus"}).status_code == 422
    assert client.post("/api/admin/tickets/bulk", json={"ids": [t.id, 99999], "changes": {"status": "resolved"}}).json() == {"updated": 1}
    assert client.get("/api/admin/tickets/report").json()["created"] == 1

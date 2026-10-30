"""Yönetim paneli: gelir, işlem kaydı araması, trend, mağaza listesi, duyuru, CSV ve mesaj yanıtı."""
import datetime as dt
import json

import pytest
from cryptography.fernet import Fernet

from app.admin import announcement, audit, exports, messages, revenue, shops, trends
from app.admin.deps import AdminError
from app.admin.schemas import AnnouncementIn
from app.auth.models import User, Workspace, WorkspaceMember
from app.billing.models import BillingEvent, BillingProduct, CreditLedger
from app.core import crypto
from app.contact.models import ContactMessage
from app.shops.models import OAuthToken, Shop


def _event(db, name, total, currency="USD", variant="111", status="paid", test=False, ws=None, ok=True, **extra):
    attrs = {"status": status, "total": total, "currency": currency, "test_mode": test, "first_order_item": {"variant_id": variant}, **extra}
    db.add(BillingEvent(event_name=name, lemon_id="1", workspace_id=ws, ok=ok, payload=json.dumps({"attributes": attrs})))
    db.commit()


@pytest.fixture
def owner(db):
    user = User(supabase_id="sb-o", email="owner@x.co", name="Owner")
    ws = Workspace(name="W")
    db.add_all([user, ws])
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    db.commit()
    return user, ws


def test_revenue_totals_refunds_test_orders_and_costs(db, owner):
    _, ws = owner
    db.add(BillingProduct(name_tr="Küçük", name_en="Small pack", variant_id="111", credits=100, price_cents=1900))
    db.add(CreditLedger(workspace_id=ws.id, kind="usage", delta=0, credits=5, cost_usd=0.5))
    db.commit()
    _event(db, "order_created", 1900, ws=ws.id)
    _event(db, "order_created", 1900, ws=ws.id)
    _event(db, "order_created", 5000, test=True)  # test: gelire girmez
    _event(db, "order_created", 700, status="pending")  # ödenmemiş: sayılmaz
    _event(db, "order_created", 4000, currency="EUR")
    _event(db, "order_refunded", 1900, ws=ws.id, refunded_amount=900)
    _event(db, "order_created", 100, ok=False)  # işlenemeyen olay: yalnızca hata sayısına girer

    out = revenue.revenue(db, 30)
    usd = next(c for c in out.currencies if c.currency == "USD")
    assert (usd.gross, usd.refunds, usd.net, usd.orders, usd.refunded_orders) == (38.0, 9.0, 29.0, 2, 1)
    assert out.main_currency == "EUR" or out.main_currency == "USD"
    assert out.test_orders == 1 and out.failed_events == 1
    assert out.cost.revenue_usd == 29.0 and out.cost.ai_cost_usd == 0.5 and out.cost.margin_usd == 28.5
    assert out.by_product[0].name in ("Small pack", "#111")


def test_orders_page_lists_owner_email_and_paginates(db, owner):
    _, ws = owner
    db.add(BillingProduct(name_tr="K", name_en="Small pack", variant_id="111", credits=100, price_cents=1900))
    db.commit()
    for _ in range(3):
        _event(db, "order_created", 1900, ws=ws.id)
    page = revenue.orders(db, 30, limit=2, offset=0)
    assert page.total == 3 and len(page.items) == 2
    assert page.items[0].owner_email == "owner@x.co" and page.items[0].product == "Small pack"
    assert len(revenue.orders(db, 30, limit=2, offset=2).items) == 1


def test_audit_search_filters_and_pages(db):
    admin = User(supabase_id="sb-a", email="admin@x.co")
    db.add(admin)
    db.commit()
    audit.record(db, admin, "user.credits", "user:7", "+50 gift")
    audit.record(db, admin, "user.status", "user:8", "blocked")
    audit.record(db, admin, "job.run", "sync")

    assert audit.search(db).total == 3
    assert audit.search(db, action="user.status").total == 1
    assert audit.search(db, q="gift").items[0].action == "user.credits"
    assert audit.search(db, q="100%").total == 0  # joker karakter düz metindir
    assert audit.search(db, admin="other@x.co").total == 0
    assert audit.search(db, date_from=dt.date.today() + dt.timedelta(days=1)).total == 0
    page = audit.search(db, limit=2, offset=2)
    assert len(page.items) == 1 and "job.run" in page.actions


def test_trends_fill_missing_days_and_count_signups(db, owner):
    _, ws = owner
    db.add(CreditLedger(workspace_id=ws.id, kind="usage", delta=-3, credits=3, cost_usd=0.25))
    db.commit()
    out = trends.trends(db, 7)
    assert len(out.points) == 7
    today = out.points[-1]
    assert today.date == dt.datetime.utcnow().date().isoformat()
    assert (today.signups, today.ai_requests, today.credits_spent, today.active_workspaces) == (1, 1, 3, 1)
    assert out.points[0].ai_requests == 0


def test_shops_filters_by_status(db, owner, monkeypatch):
    monkeypatch.setattr(crypto, "_get_fernet", lambda: Fernet(Fernet.generate_key()))
    user, ws = owner
    live = Shop(user_id=user.id, workspace_id=ws.id, etsy_shop_id=1, etsy_user_id=1, shop_name="Live")
    gone = Shop(user_id=user.id, workspace_id=ws.id, etsy_shop_id=2, etsy_user_id=1, shop_name="Gone", access_revoked_at=dt.datetime.utcnow())
    demo = Shop(user_id=user.id, workspace_id=ws.id, etsy_shop_id=3, etsy_user_id=1, shop_name="Demo", is_demo=True)
    db.add_all([live, gone, demo])
    db.flush()
    db.add(OAuthToken(shop_id=live.id, access_token="a", refresh_token="r", expires_at=dt.datetime.utcnow()))
    db.commit()

    names = lambda status: {s.shop_name for s in shops.list_shops(db, status=status).items}  # noqa: E731
    assert names("") == {"Live", "Gone", "Demo"}
    assert names("connected") == {"Live"} and names("revoked") == {"Gone"} and names("demo") == {"Demo"}
    assert names("never") == {"Live"}
    by_name = {s.shop_name: s for s in shops.list_shops(db).items}
    assert by_name["Live"].stale and not by_name["Gone"].stale and not by_name["Demo"].stale
    assert shops.list_shops(db, q="OWNER@x").total == 3 and shops.list_shops(db, q="zzz").total == 0


def test_announcement_needs_both_languages_and_expires(db):
    with pytest.raises(AdminError):
        announcement.save(db, AnnouncementIn(active=True, text_tr="Bakım", text_en=""))
    assert announcement.current() is None

    announcement.save(db, AnnouncementIn(active=True, text_tr="Bakım var", text_en="Maintenance", tone="warning"))
    live = announcement.current()
    assert live and live["tone"] == "warning" and live["text_en"] == "Maintenance"

    announcement.save(db, AnnouncementIn(active=True, text_tr="Bakım var", text_en="Maintenance", ends_at="2000-01-01T00:00:00Z"))
    assert announcement.current() is None
    with pytest.raises(AdminError):
        announcement.save(db, AnnouncementIn(active=False, ends_at="not-a-date"))


def test_csv_cells_cannot_become_formulas(db):
    assert exports.safe_cell("=SUM(A1)") == "'=SUM(A1)"
    assert exports.safe_cell("-1+1") == "'-1+1" and exports.safe_cell(-5) == "-5" and exports.safe_cell(None) == ""
    csv_text = exports.to_csv(["a", "b"], [["=cmd", "ş,ü"]])
    assert csv_text.startswith("﻿a,b") and "'=cmd" in csv_text and '"ş,ü"' in csv_text


def test_users_csv_has_header_and_rows(db, owner):
    text = exports.users_csv(db, "", "", None, None)
    lines = text.lstrip("﻿").splitlines()
    assert lines[0].startswith("id,email") and "owner@x.co" in lines[1]


def test_message_reply_sends_mail_and_marks_handled(db, monkeypatch):
    msg = ContactMessage(name="Ayşe", email="a@x.co", topic="support", message="Yardım lazım lütfen", lang="tr")
    db.add(msg)
    db.commit()
    sent = []
    monkeypatch.setattr(messages, "email_configured", lambda: False)
    with pytest.raises(AdminError):
        messages.reply(db, msg.id, "Merhaba")

    monkeypatch.setattr(messages, "email_configured", lambda: True)
    monkeypatch.setattr(messages, "send_email", lambda to, subject, html, text, reply_to=None, **k: sent.append((to, subject, text)) or True)
    out = messages.reply(db, msg.id, "Çözdük, teşekkürler.")
    assert out.handled and sent[0][0] == ["a@x.co"] and "Çözdük" in sent[0][2] and "Yardım lazım" in sent[0][2]

    monkeypatch.setattr(messages, "send_email", lambda *a, **k: False)
    with pytest.raises(AdminError):
        messages.reply(db, msg.id, "Tekrar")
    with pytest.raises(messages.NotFound):
        messages.reply(db, 9999, "x")

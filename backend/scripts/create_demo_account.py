"""Etsy incelemesi için demo hesap oluşturur (veya demo verisini yeniler).

Kaynak mağazadan yalnızca 20 sipariş ve 20 listing (ve bunlara bağlı ledger, istatistik, yorum kayıtları) kopyalanır.
Alıcı adı, adresi, mesajları, kişiselleştirme metinleri ve takip numaraları sahte değerlerle değiştirilir; satıcı
e-postası silinir. Demo mağazanın Etsy token'ı yoktur ve `is_demo` işaretlidir: Etsy'ye hiçbir istek gitmez
(bkz. app/etsy/client.py DemoShopError).

Kullanım:
  python scripts/create_demo_account.py --source-shop 2              # Supabase kullanıcısı + demo mağaza
  python scripts/create_demo_account.py --source-shop 2 --refresh    # yalnızca demo verisini yeniden kopyalar
Şifre yalnızca ilk oluşturmada bir kez yazdırılır.
"""
import argparse
import datetime as dt
import json
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402

from app.auth.models import User, Workspace, WorkspaceMember  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.db import Base, SessionLocal  # noqa: E402
from app.main import app  # noqa: E402,F401  (tüm modelleri yükler)
from app.orders.derive import derive  # noqa: E402
from app.orders.models import OrderCache  # noqa: E402
from app.shops.models import Shop  # noqa: E402

DEMO_EMAIL = "demo@ulagg.com"
N_ORDERS = 20
N_LISTINGS = 20
N_OPEN_ORDERS = 6  # gönderilmeyi bekleyen siparişler de görünsün
PERSONALIZATION_PROPERTY_ID = 54

# Listing'e bağlı, olduğu gibi kopyalanan tablolar (alıcı verisi içermez).
LISTING_TABLES = ("listing_cache", "listing_stat_snapshots", "listing_health", "listing_costs", "variant_costs")
# Demo mağaza yenilenirken temizlenen tablolar.
DEMO_TABLES = LISTING_TABLES + ("order_cache", "ledger_entries", "fin_payments", "review_cache", "shipping_reference_cache")


def _supabase(method: str, path: str, **kwargs) -> dict:
    resp = httpx.request(
        method,
        f"{settings.supabase_url.rstrip('/')}/auth/v1/admin{path}",
        headers={"apikey": settings.supabase_secret_key, "Authorization": f"Bearer {settings.supabase_secret_key}"},
        timeout=20,
        **kwargs,
    )
    if resp.status_code >= 300:
        raise SystemExit(f"Supabase {method} {path} başarısız ({resp.status_code}): {resp.text}")
    return resp.json()


def _supabase_upsert_user(email: str, password: str) -> str:
    """Kullanıcıyı oluşturur; zaten varsa (ör. yarıda kalmış önceki çalıştırma) şifresini sıfırlar."""
    page = 1
    while True:
        users = _supabase("GET", "/users", params={"page": page, "per_page": 200}).get("users") or []
        found = next((u for u in users if (u.get("email") or "").lower() == email), None)
        if found:
            _supabase("PUT", f"/users/{found['id']}", json={"password": password, "email_confirm": True})
            return found["id"]
        if len(users) < 200:
            break
        page += 1
    body = {"email": email, "password": password, "email_confirm": True, "user_metadata": {"full_name": "Etsy Reviewer"}}
    return _supabase("POST", "/users", json=body)["id"]


def _anonymize_receipt(receipt: dict, n: int) -> dict:
    r = json.loads(json.dumps(receipt))
    buyer = f"Demo Buyer {n}"
    fake_user_id = 1000 + n
    r.update(
        name=buyer,
        first_line=f"{n} Sample Street",
        second_line="",
        city="Sample City",
        zip="00000",
        formatted_address=f"{buyer}\n{n} Sample Street\nSample City 00000\n{r.get('country_iso') or ''}",
        buyer_user_id=fake_user_id,
    )
    r.pop("seller_email", None)
    if r.get("message_from_buyer"):
        r["message_from_buyer"] = "Sample buyer message (the real message is hidden in this demo)."
    if r.get("message_from_seller"):
        r["message_from_seller"] = "Sample seller note."
    if r.get("gift_message"):
        r["gift_message"] = "Sample gift message."
    if r.get("gift_sender"):
        r["gift_sender"] = buyer
    for refund in r.get("refunds") or []:
        refund["note_from_issuer"] = ""
    for i, shipment in enumerate(r.get("shipments") or []):
        shipment["tracking_code"] = f"DEMO{n:03d}{i}"
        shipment.pop("tracking_url", None)
    for t in r.get("transactions") or []:
        t["buyer_user_id"] = fake_user_id
        for v in t.get("variations") or []:
            if v.get("property_id") == PERSONALIZATION_PROPERTY_ID or v.get("question_id"):
                v["formatted_value"] = "Sample personalization"
    return r


def _pick_orders(db, source: Shop) -> list[OrderCache]:
    base = select(OrderCache).where(OrderCache.shop_id == source.id, OrderCache.is_canceled.is_(False))
    open_ = db.scalars(base.where(OrderCache.is_shipped.is_(False), OrderCache.is_paid.is_(True))
                       .order_by(OrderCache.created_at.desc()).limit(N_OPEN_ORDERS)).all()
    done = db.scalars(base.where(OrderCache.is_shipped.is_(True))
                      .order_by(OrderCache.created_at.desc()).limit(N_ORDERS - len(open_))).all()
    return list(open_) + list(done)


def _copy_rows(db, table: str, source_id: int, demo_id: int, where=None, transform=None) -> int:
    t = Base.metadata.tables[table]
    q = select(t).where(t.c.shop_id == source_id)
    if where is not None:
        q = q.where(where(t))
    rows = [dict(r._mapping) for r in db.execute(q)]
    for row in rows:
        row.pop("id", None)
        row["shop_id"] = demo_id
        if transform:
            transform(row)
    _insert(db, t, rows)
    return len(rows)


def _insert(db, table, rows: list[dict]) -> None:
    # Büyük JSON satırları tek seferde gönderilince Supabase bağlantısı kopabiliyor; küçük parçalarla ekle.
    for i in range(0, len(rows), 5):
        db.execute(table.insert(), rows[i : i + 5])


def copy_demo_data(db, source: Shop, demo: Shop) -> None:
    for name in DEMO_TABLES:
        t = Base.metadata.tables[name]
        db.execute(delete(t).where(t.c.shop_id == demo.id))

    orders = _pick_orders(db, source)
    receipt_ids = [o.receipt_id for o in orders]
    for n, o in enumerate(orders, start=1):
        raw = _anonymize_receipt(json.loads(o.raw_json), n)
        row = OrderCache(
            shop_id=demo.id, receipt_id=o.receipt_id, status=o.status, buyer_name=raw["name"],
            grandtotal_amount=o.grandtotal_amount, grandtotal_divisor=o.grandtotal_divisor, currency_code=o.currency_code,
            is_paid=o.is_paid, is_shipped=o.is_shipped, created_at=o.created_at, expected_ship_date=o.expected_ship_date,
            raw_json=json.dumps(raw, ensure_ascii=False), synced_at=dt.datetime.utcnow(),
        )
        for k, v in derive(raw).items():
            setattr(row, k, v)
        db.add(row)

    # Siparişlerde satılan listing'ler önce, kalan yer en çok görüntülenen aktif listing'lerle doldurulur.
    lc = Base.metadata.tables["listing_cache"]
    sold = []
    for o in orders:
        for t in json.loads(o.raw_json).get("transactions") or []:
            if t.get("listing_id") and t["listing_id"] not in sold:
                sold.append(t["listing_id"])
    present = set(db.scalars(select(lc.c.listing_id).where(lc.c.shop_id == source.id, lc.c.listing_id.in_(sold))))
    listing_ids = [lid for lid in sold if lid in present][:N_LISTINGS]
    if len(listing_ids) < N_LISTINGS:
        for lid, raw in db.execute(select(lc.c.listing_id, lc.c.raw_json).where(lc.c.shop_id == source.id).order_by(lc.c.views.desc())):
            if len(listing_ids) >= N_LISTINGS:
                break
            if lid not in listing_ids and json.loads(raw).get("state") == "active":
                listing_ids.append(lid)

    counts = {"order_cache": len(orders)}
    for name in LISTING_TABLES:
        counts[name] = _copy_rows(db, name, source.id, demo.id, where=lambda t: t.c.listing_id.in_(listing_ids))
    counts["ledger_entries"] = _copy_rows(db, "ledger_entries", source.id, demo.id, where=lambda t: t.c.receipt_id.in_(receipt_ids))
    counts["fin_payments"] = _copy_rows(db, "fin_payments", source.id, demo.id, where=lambda t: t.c.receipt_id.in_(receipt_ids))
    counts["shipping_reference_cache"] = _copy_rows(db, "shipping_reference_cache", source.id, demo.id)

    # review_cache'in birincil anahtarı transaction_id (Etsy'de küresel) — kaynak mağazayla çakışmasın diye negatif.
    rc = Base.metadata.tables["review_cache"]
    reviews = [dict(r._mapping) for r in db.execute(
        select(rc).where(rc.c.shop_id == source.id, rc.c.listing_id.in_(listing_ids)).order_by(rc.c.created_at.desc()).limit(20)
    )]
    for r in reviews:
        r.update(shop_id=demo.id, transaction_id=-r["transaction_id"], buyer_user_id=None)
    _insert(db, rc, reviews)
    counts["review_cache"] = len(reviews)

    demo.listings_synced_at = dt.datetime.utcnow()
    demo.icon_url = source.icon_url
    demo.currency = source.currency
    db.commit()
    print("Kopyalandı:", ", ".join(f"{k}={v}" for k, v in counts.items()))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-shop", type=int, required=True, help="Kopyalanacak mağazanın yerel id'si (shops.id)")
    ap.add_argument("--refresh", action="store_true", help="Yalnızca var olan demo mağazanın verisini yeniden kopyala")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        source = db.get(Shop, args.source_shop)
        if source is None or source.is_demo:
            raise SystemExit("Kaynak mağaza bulunamadı (ya da kendisi demo).")

        user = db.scalars(select(User).where(User.email == DEMO_EMAIL)).first()
        password = None
        if user is None:
            if args.refresh:
                raise SystemExit("Demo hesap yok; --refresh olmadan çalıştır.")
            password = secrets.token_urlsafe(12)
            user = User(supabase_id=_supabase_upsert_user(DEMO_EMAIL, password), email=DEMO_EMAIL, name="Etsy Reviewer")
            db.add(user)
            db.flush()
            ws = Workspace(name="Demo workspace")
            db.add(ws)
            db.flush()
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
            db.flush()
        else:
            ws = db.scalars(select(Workspace).join(WorkspaceMember).where(WorkspaceMember.user_id == user.id)).first()

        demo = db.scalars(select(Shop).where(Shop.workspace_id == ws.id, Shop.is_demo.is_(True))).first()
        if demo is None:
            demo = Shop(
                user_id=user.id, workspace_id=ws.id, etsy_shop_id=-source.etsy_shop_id, etsy_user_id=-source.etsy_user_id,
                shop_name=f"{source.shop_name} (Demo)", is_demo=True,
            )
            db.add(demo)
        db.commit()  # hesap kayıtları veri kopyalamadan bağımsız kalsın
        if password:
            print(f"Demo hesap oluşturuldu: {DEMO_EMAIL}  şifre: {password}")

        copy_demo_data(db, source, demo)
    finally:
        db.close()


if __name__ == "__main__":
    main()

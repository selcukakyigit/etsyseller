"""İncelemeciler (Etsy, ödeme sağlayıcıları) için demo hesap oluşturur ya da demo verisini yeniler.

Mağaza tamamen UYDURMA bir örnek mağazadır (bkz. app/demo/seed.py): gerçek bir mağazadan hiçbir şey kopyalanmaz. Etsy belirteci yoktur ve `is_demo`
işaretlidir: Etsy'ye hiçbir istek gitmez (bkz. app/etsy/client.py DemoShopError). Kullanıcılar da aynı örnek mağazayı uygulamadan tek tıkla açabilir.

Kullanım:
  python scripts/create_demo_account.py                                   # demo@ulagg.com: Supabase kullanıcısı + örnek mağaza
  python scripts/create_demo_account.py --email baska@ulagg.com           # ayrı bir incelemeci hesabı
  python scripts/create_demo_account.py --refresh                         # yalnızca var olan demo mağazanın verisini yeniler
Şifre yalnızca hesap ilk oluşturulurken bir kez yazdırılır (var olan hesabın şifresine dokunulmaz).
"""
import argparse
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.auth.models import User, Workspace, WorkspaceMember  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.demo import seed  # noqa: E402
from app.main import app  # noqa: E402,F401  (tüm modelleri yükler)
from app.shops.models import Shop  # noqa: E402

DEMO_EMAIL = "demo@ulagg.com"


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
    body = {"email": email, "password": password, "email_confirm": True, "user_metadata": {"full_name": "Reviewer"}}
    return _supabase("POST", "/users", json=body)["id"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", default=DEMO_EMAIL, help="Demo hesabın e-postası (varsayılan: demo@ulagg.com)")
    ap.add_argument("--refresh", action="store_true", help="Yalnızca var olan demo mağazanın verisini yeniden üret")
    args = ap.parse_args()
    email = args.email.strip().lower()

    db = SessionLocal()
    try:
        user = db.scalars(select(User).where(User.email == email)).first()
        password = None
        if user is None:
            if args.refresh:
                raise SystemExit("Demo hesap yok; --refresh olmadan çalıştır.")
            password = secrets.token_urlsafe(12)
            user = User(supabase_id=_supabase_upsert_user(email, password), email=email, name="Reviewer")
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
                user_id=user.id, workspace_id=ws.id, etsy_shop_id=-(seed.REVIEWER_ID_BASE + ws.id), etsy_user_id=-(seed.REVIEWER_ID_BASE + ws.id),
                shop_name=f"{seed.SHOP_NAME} (Sample)", is_demo=True,
            )
            db.add(demo)
            db.flush()
        counts = seed.seed_shop(db, demo)
        if password:
            print(f"Demo hesap oluşturuldu: {email}  şifre: {password}")
        print("Örnek mağaza hazır:", ", ".join(f"{k}={v}" for k, v in counts.items()))
    finally:
        db.close()


if __name__ == "__main__":
    main()

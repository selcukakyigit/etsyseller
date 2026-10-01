"""Etsy belirteç şifreleme anahtarını döndürür.

Adımlar:
 1. Yeni anahtar üret:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
 2. TOKEN_ENCRYPTION_KEY değerini "YENI,ESKI" yap (Render ve yerel .env). İlki şifreler, hepsi çözer; uygulama çalışmaya devam eder.
 3. Bu betiği çalıştır:  python scripts/rotate_token_key.py --apply   (kayıtlar yeni anahtarla yeniden şifrelenir)
    Önce `python scripts/rotate_token_key.py` ile (--apply olmadan) tüm kayıtların çözülebildiğini doğrula.
 4. TOKEN_ENCRYPTION_KEY'den ESKİ anahtarı kaldır.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.orm.attributes import flag_modified  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402,F401  (tüm modelleri yükler)
from app.shops.models import OAuthToken  # noqa: E402

if __name__ == "__main__":
    apply = "--apply" in sys.argv
    db = SessionLocal()
    try:
        rows = db.query(OAuthToken).all()
        for row in rows:
            _ = row.access_token, row.refresh_token  # çözülemezse burada hata verir
            if apply:
                flag_modified(row, "access_token")
                flag_modified(row, "refresh_token")
        if apply:
            db.commit()
        print(f"{len(rows)} kayıt çözüldü" + (" ve yeniden şifrelendi." if apply else " (değişiklik yapılmadı; --apply ile yeniden şifrele)."))
    finally:
        db.close()

"""Test ortamı. ÖNEMLİ: testler HİÇBİR ZAMAN gerçek veritabanına dokunmaz. `DATABASE_URL`, uygulama içe aktarılmadan ÖNCE geçici bir SQLite dosyasına
çevrilir (ortam değişkeni `.env`'den önceliklidir); gerçek sağlayıcıya da istek atılmaz (sahte sağlayıcı, bkz. fakes.py).

Çalıştırma:  cd backend && .venv/Scripts/python -m pytest tests"""
import os
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="ulagg-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["TOKEN_ENCRYPTION_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.core.config import settings  # noqa: E402

assert settings.database_url.startswith("sqlite"), "testler yalnızca geçici SQLite ile çalışır"

import app.main  # noqa: E402,F401  (tüm modelleri yükler)
from app.core import app_settings  # noqa: E402
from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.research import credentials, discover, providers  # noqa: E402
from tests.fakes import FakeProvider  # noqa: E402


Base.metadata.create_all(engine)  # şema bir kez kurulur; her testte yalnızca satırlar temizlenir (çok daha hızlı)


@pytest.fixture
def db():
    """Her test boş bir veritabanıyla başlar."""
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    app_settings.clear_cache()
    discover._tags_cache.clear()
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def provider(monkeypatch):
    """Sahte araştırma sağlayıcısı + kimlik bilgisi (gerçek DataForSEO'ya istek yok)."""
    fake = FakeProvider()
    monkeypatch.setitem(providers._PROVIDERS, "dataforseo", fake)
    monkeypatch.setitem(credentials._ENV, "dataforseo", lambda: ("login", "password"))
    return fake

"""Açılışta güvenlik kontrolü: Supabase, public şemadaki tabloları publishable key ile PostgREST üzerinden açar. RLS'si kapalı
bir uygulama tablosu ön yüzdeki anahtarla herkesçe okunup yazılabilir. Her yeni tablo, onu oluşturan göçte kilitlenmelidir
(bkz. alembic/versions/0022_rls_lockdown.py); unutulursa burada hata kaydı düşer."""
import logging

from sqlalchemy import text

from app.core.db import engine

log = logging.getLogger(__name__)


def warn_unlocked_tables() -> None:
    if engine.dialect.name != "postgresql":
        return
    try:
        with engine.connect() as conn:
            names = conn.scalars(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version' AND NOT rowsecurity")
            ).all()
    except Exception:  # noqa: BLE001 — kontrol açılışı engellememeli
        log.warning("RLS kontrolü yapılamadı", exc_info=True)
        return
    if names:
        log.error("GÜVENLİK: RLS'si kapalı tablolar PostgREST'e açık olabilir: %s — göçte ENABLE ROW LEVEL SECURITY ekleyin", ", ".join(names))

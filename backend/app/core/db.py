from sqlalchemy import Numeric, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
# Para alanları NUMERIC olarak saklanır (kayan nokta hatası yok); asdecimal=False ile Python tarafında float döner,
# böylece mevcut hesaplama kodu değişmeden çalışır.
MONEY = Numeric(14, 4, asdecimal=False)
PCT = Numeric(8, 4, asdecimal=False)
FX = Numeric(18, 8, asdecimal=False)

engine_kwargs = {"pool_pre_ping": True} if not settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    Base.metadata.create_all(engine)

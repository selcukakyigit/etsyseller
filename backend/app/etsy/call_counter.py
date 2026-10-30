"""Etsy API çağrı sayacının kalıcı günlük toplamı (`etsy_call_daily`). Her çağrıda veritabanına yazılmaz: `rate_limit.throttle` belleğe sayar, bu modül
birikeni birkaç saniyede bir toplu ekler ve güncel toplamı geri okur. Böylece sunucu yeniden başlasa ya da web + worker ayrı süreçler olsa da gün toplamı
doğru kalır (en çok `FLUSH_SECONDS` gecikmeyle). Tablo yoksa ya da veritabanı kapalıysa sayaç yalnızca bellekte çalışmaya devam eder."""
import datetime as dt
import logging
import threading

from sqlalchemy import BigInteger, Date, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, SessionLocal

log = logging.getLogger(__name__)
FLUSH_SECONDS = 15


class EtsyCallDaily(Base):
    __tablename__ = "etsy_call_daily"

    day: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    n: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")


def add(day: dt.date, delta: int) -> int:
    """Günün toplamına `delta` ekler ve yeni toplamı döndürür (iki süreç aynı anda ekleyebilir: artış veritabanında yapılır)."""
    with SessionLocal() as db:
        for _ in range(2):
            if delta and db.execute(update(EtsyCallDaily).where(EtsyCallDaily.day == day).values(n=EtsyCallDaily.n + delta)).rowcount:
                break
            if not delta and db.get(EtsyCallDaily, day) is not None:
                break
            try:
                db.add(EtsyCallDaily(day=day, n=delta))
                db.flush()
                break
            except IntegrityError:  # başka süreç aynı anda günün satırını açtı: güncellemeyi yeniden dene
                db.rollback()
        db.commit()
        return int(db.scalar(select(EtsyCallDaily.n).where(EtsyCallDaily.day == day)) or 0)


_started = threading.Event()


def start(flush) -> None:
    """Arka plan yazıcısını bir kez başlatır; `flush` her `FLUSH_SECONDS`te çağrılır (ilk çağrı hemen: gün toplamını yükler)."""
    if _started.is_set():
        return
    _started.set()

    def loop() -> None:
        stop = threading.Event()
        while not stop.is_set():
            try:
                flush()
            except Exception:  # noqa: BLE001 — sayaç hiçbir zaman uygulamayı düşürmez
                log.exception("Etsy çağrı sayacı yazılamadı")
            stop.wait(FLUSH_SECONDS)

    threading.Thread(target=loop, name="etsy-call-counter", daemon=True).start()

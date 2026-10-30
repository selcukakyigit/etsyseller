"""Yönetim uyarıları: bütçe, bakiye, hata oranı, tıkanan kuyruk, devre kesici. Yalnızca hesaplar; gösterim yönetim panelinde (metinler arayüzde, iki dilde).
Eşikler burada sabittir: ayar ekranını şişirmemek için yalnızca bütçe tavanları ve düşük bakiye eşiği ayardan gelir."""
import datetime as dt
import time
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.research import budget, credentials, policy, worker
from app.research.models import ProviderCall, ResearchJob
from app.research.providers import DEFAULT_PROVIDER, get_provider
from app.research.records import ProviderError

BUDGET_WARN = 0.8  # aylık harcama bu orana gelince uyarı
ERROR_RATE = 0.2  # son 24 saatte hata oranı bunu aşarsa
ERROR_MIN_CALLS = 10  # ... ve en az bu kadar çağrı varsa (az çağrıda oran anlamsız)
QUEUE_STUCK = dt.timedelta(minutes=15)  # çalışması gereken iş bu kadar süredir bekliyorsa kuyruk tıkanmıştır
BALANCE_TTL = 600.0  # sn: bakiye sorgusu (ücretsiz ama ağ çağrısı) bu kadar önbellekte

_balance_cache: tuple[float, float | None] | None = None


@dataclass
class Alert:
    key: str  # budget_warn | budget_full | kind_budget:<tür> | error_rate | breaker | queue_stuck | dead_jobs | low_balance
    level: str  # warn | bad
    value: float | None = None  # keyin anlamına göre: oran (%), dakika, sayı ya da tutar
    limit: float | None = None


def _balance(db: Session) -> float | None:
    """Sağlayıcı bakiyesi (10 dk önbellekte); alınamazsa None (uyarı üretilmez, panel çökmez)."""
    global _balance_cache
    now = time.monotonic()
    if _balance_cache and now - _balance_cache[0] < BALANCE_TTL:
        return _balance_cache[1]
    value = None
    creds = credentials.get(db, DEFAULT_PROVIDER)
    if creds is not None:
        try:
            raw = get_provider().account(creds).get("balance")
            value = None if raw is None else float(raw)
        except (ProviderError, TypeError, ValueError):
            value = None
    _balance_cache = (now, value)
    return value


def clear_cache() -> None:
    global _balance_cache
    _balance_cache = None


def compute(db: Session) -> list[Alert]:
    now = dt.datetime.utcnow()
    out: list[Alert] = []

    spend, cap = budget.month_spend(db), float(policy.get("research_monthly_budget_usd"))
    if cap > 0 and spend >= cap:
        out.append(Alert("budget_full", "bad", round(spend, 2), cap))
    elif cap > 0 and spend >= cap * BUDGET_WARN:
        out.append(Alert("budget_warn", "warn", round(spend / cap * 100), cap))
    for kind in budget.KINDS:
        if budget.over_kind_budget(db, kind):
            out.append(Alert(f"kind_budget:{kind}", "warn", round(budget.kind_spend(db, kind), 2), budget.kind_cap(kind)))

    until = worker.breaker_until(db)
    if until:
        out.append(Alert("breaker", "bad", max(1, round((until - now).total_seconds() / 60))))

    day = now - dt.timedelta(days=1)
    calls = db.scalar(select(func.count(ProviderCall.id)).where(ProviderCall.created_at >= day)) or 0
    errors = db.scalar(select(func.count(ProviderCall.id)).where(ProviderCall.created_at >= day, ProviderCall.ok.is_(False))) or 0
    if calls >= ERROR_MIN_CALLS and errors / calls > ERROR_RATE:
        out.append(Alert("error_rate", "bad", round(errors / calls * 100), round(ERROR_RATE * 100)))

    oldest = db.scalar(select(func.min(ResearchJob.run_after)).where(ResearchJob.status == "queued", ResearchJob.run_after <= now - QUEUE_STUCK))
    if oldest is not None and not until:  # devre kesici açıkken bekleme beklenen durumdur, ayrıca uyarılmaz
        out.append(Alert("queue_stuck", "warn", round((now - oldest).total_seconds() / 60), QUEUE_STUCK.total_seconds() / 60))

    dead = db.scalar(select(func.count(ResearchJob.id)).where(ResearchJob.status == "dead", ResearchJob.finished_at >= day)) or 0
    if dead:
        out.append(Alert("dead_jobs", "warn", dead))

    low, balance = float(policy.get("research_low_balance_usd")), _balance(db)
    if balance is not None and low > 0 and balance < low:
        out.append(Alert("low_balance", "bad" if balance <= 0 else "warn", round(balance, 2), low))
    return out

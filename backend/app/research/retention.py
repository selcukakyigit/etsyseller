"""Araştırma havuzu saklama temizliği (gece, bkz. jobs/retention.py): biten işler ve sağlayıcı çağrı günlüğü sonsuza dek birikmesin.
Maliyet panosu yalnızca son ayları kullanır; ölçüm geçmişi 2 yıl tutulur (daha eskisi trend/kıyas için kullanılmaz)."""
import datetime as dt

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.research.models import KeywordMetric, KeywordTrend, ProviderCall, ResearchJob

JOB_RETENTION = dt.timedelta(days=30)
CALL_RETENTION = dt.timedelta(days=180)
METRIC_RETENTION = dt.timedelta(days=730)
DONE = ("done", "cancelled", "failed", "dead")


def purge(db: Session) -> int:
    now = dt.datetime.utcnow()
    removed = 0
    for stmt in (
        delete(ResearchJob).where(ResearchJob.status.in_(DONE), ResearchJob.finished_at < now - JOB_RETENTION),
        delete(ProviderCall).where(ProviderCall.created_at < now - CALL_RETENTION),
        delete(KeywordMetric).where(KeywordMetric.measured_at < now - METRIC_RETENTION),
        delete(KeywordTrend).where(KeywordTrend.measured_at < now - METRIC_RETENTION),
    ):
        removed += int(db.execute(stmt).rowcount or 0)
    db.commit()
    return removed

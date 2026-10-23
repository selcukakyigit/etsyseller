"""İş yürütücü. Web sürecinden bağımsızdır: yalnızca `run_once` çağrılır (şimdilik zamanlayıcıdan; ayrı worker'a taşınınca kendi giriş noktasından).

Hacim işleri birleştirilir: sağlayıcı istek başına ücretlendirir (1 ya da 1000 kelime aynı) ve dakikada 12 istek sınırı vardır, bu yüzden aynı
pazar/dildeki bekleyen tüm hacim işleri tek istekte toplanır."""
import datetime as dt
import logging

from sqlalchemy.orm import Session

from app.research import budget, credentials, jobs, policy, pool
from app.research.models import ProviderCall, ResearchJob
from app.research.providers import get_provider
from app.research.records import ProviderError, ProviderResponse
from app.research.terms import normalize, researchable

log = logging.getLogger(__name__)
MAX_CALLS_PER_RUN = 5  # bir çalışmada en fazla bu kadar sağlayıcı isteği (Google Ads Live: dakikada 12)
BUDGET_RETRY = dt.timedelta(hours=1)


def _log_call(db: Session, job_ids: list[int], provider: str, market: str, language: str, resp: ProviderResponse | None, error: str = "", ms: int = 0) -> None:
    db.add(ProviderCall(
        job_id=job_ids[0] if job_ids else None, provider=provider, endpoint=resp.endpoint if resp else "-", market=market, language=language,
        items=len(resp.records) if resp else 0, cost_usd=resp.cost_usd if resp else 0, duration_ms=resp.duration_ms if resp else ms, ok=not error, error=error[:300],
    ))


def _run_volume(db: Session, batch: list[ResearchJob]) -> None:
    first = batch[0]
    provider = get_provider(first.provider)
    creds = credentials.get(db, first.provider)
    terms = sorted({t for j in batch for t in jobs.params(j).get("terms", []) if researchable(normalize(t))})
    if not terms:
        for job in batch:
            jobs.finish(job)
        return
    resp = provider.volumes(creds, terms, first.market, first.language)
    rows =pool.get_or_create_terms(db, terms, first.language, "volume")
    pool.add_metrics(
        db, rows, resp.records, provider=first.provider, source="google_ads", market=first.market, language=first.language,
        ttl_days=policy.get("research_ttl_volume_days"),
    )
    _log_call(db, [j.id for j in batch], first.provider, first.market, first.language, resp)
    share = resp.cost_usd / len(batch)
    for job in batch:
        jobs.finish(job, share)


def _run_trend(db: Session, job: ResearchJob) -> None:
    provider = get_provider(job.provider)
    creds = credentials.get(db, job.provider)
    terms = [t for t in jobs.params(job).get("terms", []) if researchable(normalize(t))][: provider.max_trend_terms]
    if not terms:
        jobs.finish(job)
        return
    resp = provider.trends(creds, terms, job.market, job.language)
    rows = pool.get_or_create_terms(db, terms, job.language, "trend")
    pool.add_trends(db, rows, resp.trends, provider=job.provider, market=job.market, language=job.language, ttl_days=policy.get("research_ttl_trend_days"))
    _log_call(db, [job.id], job.provider, job.market, job.language, ProviderResponse(resp.endpoint, [], cost_usd=resp.cost_usd, duration_ms=resp.duration_ms))
    jobs.finish(job, resp.cost_usd)


def _run_suggest(db: Session, job: ResearchJob) -> None:
    provider = get_provider(job.provider)
    creds = credentials.get(db, job.provider)
    p = jobs.params(job)
    seed = normalize(p["seed"])
    questions = bool(p.get("questions"))
    resp = provider.suggestions(creds, seed, job.market, job.language, int(p.get("limit", 100)), questions=questions)
    related = [r for r in resp.records if researchable(r.term)]
    rows = pool.get_or_create_terms(db, [seed] + [r.term for r in related], job.language, "question" if questions else "suggestion")
    # Havuzda zaten TAZE ölçümü olan kelimeler için yeni satır eklenmez (farklı tohumların önerileri çok örtüşür; geçmiş tablosu gereksiz şişmesin).
    fresh = pool.latest_metrics(db, [r.id for r in rows.values()], job.market, job.language)
    now = dt.datetime.utcnow()
    fresh_terms = {t for t, row in rows.items() if row.id in fresh and fresh[row.id].expires_at > now}
    todo = {t: rows[t] for t in {r.term for r in related} if t in rows and (t == seed or t not in fresh_terms)}
    pool.add_metrics(
        db, todo, related, provider=job.provider, source="labs_suggestions", market=job.market,
        language=job.language, ttl_days=policy.get("research_ttl_volume_days"),
    )
    if seed in rows:
        pool.link_suggestions(db, rows[seed].id, [rows[r.term] for r in related if r.term in rows and r.term != seed], relation="question" if questions else "suggestion")
    _log_call(db, [job.id], job.provider, job.market, job.language, resp)
    jobs.finish(job, resp.cost_usd)


def _execute(db: Session, batch: list[ResearchJob]) -> None:
    first = batch[0]
    try:
        if first.kind == "volume":
            _run_volume(db, batch)
        elif first.kind == "trend":
            _run_trend(db, first)
        elif first.kind == "suggest":
            _run_suggest(db, first)
        else:
            raise ProviderError(f"Bilinmeyen iş türü: {first.kind}", transient=False)
        db.commit()
    except ProviderError as exc:
        db.rollback()
        batch = [db.get(ResearchJob, j.id) for j in batch]  # geri alma sonrası taze satırlar
        _log_call(db, [j.id for j in batch], first.provider, first.market, first.language, None, error=str(exc))
        for job in batch:
            jobs.fail(job, str(exc), exc.transient)
        db.commit()
        log.warning("Araştırma işi başarısız (%s): %s", first.kind, exc)


def run_once(db: Session) -> int:
    """Bekleyen işleri sırayla yürütür; çalıştırılan sağlayıcı isteği sayısını döner."""
    if jobs.recover_stuck(db):
        db.commit()
    calls = 0
    while calls < MAX_CALLS_PER_RUN:
        if budget.over_budget(db):
            for job in jobs.claim(db, limit=50):
                jobs.defer(job, "Aylık bütçe doldu; sonraki saatte yeniden denenecek", BUDGET_RETRY)
            db.commit()
            break
        head = jobs.claim(db, limit=1)
        if not head:
            break
        batch = head
        if head[0].kind == "volume":
            limit = get_provider(head[0].provider).max_volume_terms
            size = len(jobs.params(head[0]).get("terms", []))
            for job in jobs.claim(db, same_as=head[0], limit=50):
                n = len(jobs.params(job).get("terms", []))
                if size + n > limit:
                    jobs.defer(job, "", dt.timedelta(0))  # sığmadı: sonraki turda
                    continue
                batch.append(job)
                size += n
        db.commit()  # `running` kilitleri hemen görünür olsun
        if credentials.get(db, head[0].provider) is None:
            for job in batch:
                jobs.fail(job, "Araştırma sağlayıcısı yapılandırılmamış", transient=False)
            db.commit()
            continue
        _execute(db, batch)
        calls += 1
    return calls

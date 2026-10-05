"""Kredi motoru: fiyatlama, bakiye, harcama ve yükleme.

Fiyat: işlemin sağlayıcı maliyeti (USD, katalogdaki model fiyatlarından) × kâr çarpanı ÷ bir kredinin USD değeri,
yukarı yuvarlanır, en az 1 kredi. Model fiyatı girilmemişse maliyet 0 sayılır ve işlem en az ücreti (1 kredi) öder.

Kredi sistemi panelden açılana kadar (`credits_enabled`) kullanım yalnızca kaydedilir (maliyet raporu için), bakiyeden
düşülmez ve hiçbir istek engellenmez. Açılınca bakiyesi 0 ya da altındaki çalışma alanının AI isteği 402 alır.
Harcama önce plan kovasından düşer, yetmezse satın alınan kovadan (eşzamanlı isteklerde birkaç kredi eksiye inebilir)."""
import datetime as dt
import logging
import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.catalog import ResolvedModel
from app.billing.models import CreditBalance, CreditLedger
from app.core import app_settings
from app.core.db import SessionLocal

log = logging.getLogger(__name__)

# Panelden değişen ayarlar ve varsayılanları.
DEFAULTS = {
    "credits_enabled": False,  # kapalıyken yalnızca ölçülür, düşülmez/engellenmez
    "credit_markup": 3.0,  # sağlayıcı maliyetinin kaç katı kredi olarak alınır
    "credit_usd": 0.01,  # bir kredinin kullanıcıya satış değeri (USD)
    "signup_credits": 0,  # yeni (ya da ilk kez bakiyesi oluşan) çalışma alanına bir kerelik hediye
}
MIN_CREDITS = 1


def setting(key: str):
    value = app_settings.get(key, DEFAULTS[key])
    return type(DEFAULTS[key])(value) if value is not None else DEFAULTS[key]


def enabled() -> bool:
    return bool(setting("credits_enabled"))


@dataclass(frozen=True)
class Price:
    cost_usd: float
    credits: int


def price(model: ResolvedModel, input_tokens: int = 0, output_tokens: int = 0, units: int = 0) -> Price:
    cost = (
        input_tokens * (model.input_usd_per_mtok or 0) / 1_000_000
        + output_tokens * (model.output_usd_per_mtok or 0) / 1_000_000
        + units * (model.unit_usd or 0)
    )
    credit_usd = setting("credit_usd") or DEFAULTS["credit_usd"]
    credits = math.ceil(round(cost * setting("credit_markup") / credit_usd, 6))
    return Price(cost_usd=round(cost, 6), credits=max(MIN_CREDITS, credits))


def _balance(db: Session, workspace_id: int, lock: bool = False) -> CreditBalance:
    """Çalışma alanının bakiye satırı; yoksa oluşturulur ve varsa hoş geldin kredisi bir kez yüklenir."""
    stmt = select(CreditBalance).where(CreditBalance.workspace_id == workspace_id)
    row = db.scalar(stmt.with_for_update() if lock else stmt)
    if row is not None:
        return row
    gift = int(setting("signup_credits"))
    row = CreditBalance(workspace_id=workspace_id, plan=0, purchased=0, updated_at=dt.datetime.utcnow())
    db.add(row)
    try:
        db.flush()
    except IntegrityError:  # başka bir istek aynı anda oluşturdu
        db.rollback()
        return db.scalar(stmt.with_for_update() if lock else stmt)
    if gift > 0:
        row.purchased += gift
        db.add(CreditLedger(workspace_id=workspace_id, kind="grant", bucket="purchased", delta=gift, credits=gift, ref=f"signup:{workspace_id}", note="Hoş geldin kredisi"))
    return row


def balance(db: Session, workspace_id: int) -> tuple[int, int]:
    """(plan, satın alınan). Satır yoksa oluşturur (hoş geldin kredisi dahil) ve commit eder."""
    row = _balance(db, workspace_id)
    db.commit()
    return row.plan, row.purchased


def has_credits(workspace_id: int) -> bool:
    """Kredi sistemi kapalıysa her zaman True. Okuma hatasında da True (kredi defteri sorunu AI'ı kilitlemesin)."""
    if not enabled():
        return True
    db = SessionLocal()
    try:
        plan, purchased = balance(db, workspace_id)
        return plan + purchased > 0
    except SQLAlchemyError:
        log.exception("Kredi bakiyesi okunamadı (ws=%s); istek engellenmedi", workspace_id)
        return True
    finally:
        db.close()


def charge_usage(
    workspace_id: int, user_id: int | None, task: str, model: ResolvedModel, input_tokens: int = 0, output_tokens: int = 0, units: int = 0,
) -> Price:
    """Bir AI çağrısının bedelini kaydeder (sistem açıksa bakiyeden düşer). Kendi oturumunu açar ve commit eder: çağıranın
    işlemine karışmaz, ileride ayrı bir worker'dan da aynen çağrılabilir."""
    p = price(model, input_tokens, output_tokens, units)
    common = dict(
        workspace_id=workspace_id, user_id=user_id, kind="usage", credits=p.credits, task=task, model=f"{model.provider}/{model.model_id}"[:120],
        cost_usd=p.cost_usd, input_tokens=input_tokens or None, output_tokens=output_tokens or None, units=units or None,
    )
    db = SessionLocal()
    try:
        if not enabled():
            db.add(CreditLedger(bucket="none", delta=0, **common))
        else:
            row = _balance(db, workspace_id, lock=True)
            from_plan = min(max(row.plan, 0), p.credits)
            from_purchased = p.credits - from_plan
            row.plan -= from_plan
            row.purchased -= from_purchased
            row.updated_at = dt.datetime.utcnow()
            # Bir çağrı = bir defter satırı (maliyet raporu çift saymasın); iki kovadan birden düştüyse "mixed".
            bucket = "mixed" if from_plan and from_purchased else ("plan" if from_plan else "purchased")
            db.add(CreditLedger(bucket=bucket, delta=-p.credits, **common))
        db.commit()
    finally:
        db.close()
    return p


def _ref_used(db: Session, ref: str | None) -> bool:
    return bool(ref) and db.scalar(select(CreditLedger.id).where(CreditLedger.ref == ref)) is not None


def grant(db: Session, workspace_id: int, amount: int, *, kind: str, bucket: str = "purchased", ref: str | None = None, note: str = "", user_id: int | None = None) -> bool:
    """Kredi yükler (satın alma, hediye, iade). `ref` daha önce işlendiyse hiçbir şey yapmaz ve False döner. Commit eder."""
    if _ref_used(db, ref):
        return False
    row = _balance(db, workspace_id, lock=True)
    setattr(row, bucket, getattr(row, bucket) + amount)
    row.updated_at = dt.datetime.utcnow()
    db.add(CreditLedger(workspace_id=workspace_id, user_id=user_id, kind=kind, bucket=bucket, delta=amount, credits=amount, ref=ref, note=note[:300]))
    try:
        db.commit()
    except IntegrityError:  # aynı ref'li olay aynı anda işlendi
        db.rollback()
        return False
    return True


def reset_plan(db: Session, workspace_id: int, amount: int, *, ref: str, note: str = "") -> bool:
    """Abonelik dönemi başında plan kovasını `amount`'a eşitler (kalan plan kredisi devretmez). Commit eder."""
    if _ref_used(db, ref):
        return False
    row = _balance(db, workspace_id, lock=True)
    delta = amount - row.plan
    row.plan = amount
    row.updated_at = dt.datetime.utcnow()
    db.add(CreditLedger(workspace_id=workspace_id, kind="plan_reset", bucket="plan", delta=delta, credits=amount, ref=ref, note=note[:300]))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


def clear_plan(db: Session, workspace_id: int, *, ref: str, note: str = "") -> bool:
    """Abonelik bitince plan kovası sıfırlanır; satın alınan krediler kalır."""
    return reset_plan(db, workspace_id, 0, ref=ref, note=note)

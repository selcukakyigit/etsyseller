"""Maliyet dağıtım planı: bir işin "nereye yazılsın" kararı (tür + hedefler + dağıtılmayan kalanın dış pay sahibi). İş kaydında JSON olarak durur;
burada yalnızca sabitler ve okuma vardır (dağıtımın kendisi `allocation.py`)."""
import json

from app.supply import paint, weights
from app.supply.models import SupplyJob

MAX_TARGETS = 100
ESTIMATED = "estimated"  # tahmini maliyete göre: lazer süresi payı + malzeme; gerçek tutar bu oranlarla bölünür
SPLIT_MODES = ("price", "qty", "manual", *weights.WEIGHT_MODES, ESTIMATED, paint.MODE)


def plan_of(job: SupplyJob) -> dict:
    try:
        plan = json.loads(job.allocation_plan or "{}")
    except json.JSONDecodeError:
        plan = {}
    if isinstance(plan, list):  # eski biçim
        plan = {"mode": "qty", "targets": plan}
    return {"mode": plan.get("mode") if plan.get("mode") in SPLIT_MODES else "price", "targets": plan.get("targets") or [],
            "remainder_party_id": plan.get("remainder_party_id")}

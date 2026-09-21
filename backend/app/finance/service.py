"""Finans: Etsy ledger + ödeme verisini yerele indirir, sipariş/ürün/ülke/müşteri bazında kâr raporu üretir.

Para birimi: Etsy ödeme hesabı (ledger) bazı mağazalarda mağaza para biriminden farklıdır (ör. mağaza USD, hesap TRY).
Her siparişin kuru `ödeme brüt tutarı / sipariş genel toplamı` ile bulunur ve o siparişin tüm ledger satırları
mağaza para birimine bu kurla çevrilir. Siparişe bağlı olmayan giderler (reklam, yenileme…) aylık ortanca kurla çevrilir."""
import datetime as dt
import html
import json
import logging
import statistics
import threading
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.etsy.client import EtsyClient
from app.finance.models import CostHistory, FinPayment, LedgerEntry, ListingCost, OrderCost, VariantCost
from app.listings.models import ListingCache
from app.orders.models import OrderCache
from app.shops.models import Shop

log = logging.getLogger(__name__)

_state: dict[int, dict] = {}
WINDOW = 30 * 86400

FEE_LABELS = {
    "transaction": "İşlem ücreti",
    "processing_fee": "Ödeme işleme ücreti",
    "regulatory_fee": "Düzenleyici işletme ücreti",
    "other_fee": "Diğer sipariş ücretleri",
}
OVERHEAD_LABELS = {"ads": "Etsy Ads / reklam", "listing_fees": "Listeleme ve yenileme", "other": "Diğer giderler"}


def variant_key(t: dict) -> str:
    """İşlem satırındaki seçenekleri (boyut, renk…) tek metne çevirir; kişiselleştirme/serbest metin alanları hariç."""
    parts = []
    for v in t.get("variations") or []:
        name = (v.get("formatted_name") or "").strip()
        if name.lower() == "personalization" or v.get("question_id"):
            continue
        parts.append(f"{html.unescape(name)}: {html.unescape((v.get('formatted_value') or '').strip())}")
    return " | ".join(sorted(parts))[:300]


def _load_history(db: Session, shop: Shop) -> dict[tuple[int, str], list[CostHistory]]:
    out: dict[tuple[int, str], list[CostHistory]] = defaultdict(list)
    for h in db.scalars(select(CostHistory).where(CostHistory.shop_id == shop.id).order_by(CostHistory.valid_until, CostHistory.id)):
        out[(h.listing_id, h.variant_key)].append(h)
    return out


def unit_cost_for(t: dict, costs: dict, vcosts: dict, hist: dict, on: dt.date) -> tuple[float, bool]:
    """Öncelik: seçenek maliyeti > listing maliyeti. Maliyet sonradan değiştirilmişse siparişin tarihine (`on`) uyan
    sürüm kullanılır. Döner: (adet başına maliyet+kargo, tanımlı mı)."""
    lid = t.get("listing_id")
    key = (lid, variant_key(t))
    src = vcosts.get(key)
    hist_key = key
    if src is None:
        src = costs.get(lid)
        hist_key = (lid, "")
    if src is None:
        return 0.0, False
    unit, ship, pct = src.unit_cost, src.shipping_cost, src.cost_pct
    for h in hist.get(hist_key, []):  # valid_until artan sırada; ilk uyan en eski sürümdür
        if on < h.valid_until:
            unit, ship, pct = h.unit_cost, h.shipping_cost, h.cost_pct
            break
    return unit + pct / 100 * _money(t.get("price")) + ship, True


def category(ledger_type: str) -> str:
    t = ledger_type.lower()
    if t == "payment_gross":
        return "gross"
    if t == "sales_tax" or ("tax" in t and "vat" not in t):
        return "tax"
    if t == "transaction":
        return "transaction"
    if t == "payment_processing_fee":
        return "processing_fee"
    if t == "regulatory_operating_fee":
        return "regulatory_fee"
    if "refund" in t:
        return "refund"
    if t.startswith("disburse") or "disburse" in t:
        return "transfer"
    if "prolist" in t or "offsite" in t or "ads" in t:
        return "ads"
    if "renew" in t or "listing" in t or "auto_renew" in t:
        return "listing_fees"
    return "other"


# ------------------------------------------------------------------ senkronizasyon

def sync_status(db: Session, shop: Shop) -> dict:
    st = _state.get(shop.id, {})
    n = db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.shop_id == shop.id)) or 0
    last = db.scalar(select(func.max(LedgerEntry.created_ts)).where(LedgerEntry.shop_id == shop.id))
    return {
        "running": bool(st.get("running")),
        "entries": n,
        "last_entry": dt.datetime.utcfromtimestamp(last).isoformat() if last else None,
        "progress": st.get("progress", 0.0),
        "phase": st.get("phase", ""),
        "error": st.get("error"),
    }


def start_sync(shop: Shop, full: bool = False) -> bool:
    st = _state.setdefault(shop.id, {})
    if st.get("running"):
        return False
    st.update(running=True, progress=0.0, phase="Başlıyor", error=None)
    threading.Thread(target=_run, args=(shop.id, full), daemon=True).start()
    return True


def _run(shop_id: int, full: bool) -> None:
    db = SessionLocal()
    st = _state[shop_id]
    try:
        shop = db.get(Shop, shop_id)
        client = EtsyClient(db, shop)
        _sync_ledger(db, client, shop, st, full)
        _sync_payments(db, client, shop, st)
        _link_receipts(db, shop)
    except Exception as exc:  # noqa: BLE001
        log.exception("Finance sync failed for shop %s", shop_id)
        st["error"] = str(exc)[:300]
    finally:
        st.update(running=False, phase="")
        db.close()


def _sync_ledger(db: Session, client: EtsyClient, shop: Shop, st: dict, full: bool) -> None:
    first_order = db.scalar(select(func.min(OrderCache.created_at)).where(OrderCache.shop_id == shop.id))
    if first_order is None:
        return
    start = int(first_order.replace(tzinfo=dt.timezone.utc).timestamp()) - 86400
    last = None if full else db.scalar(select(func.max(LedgerEntry.created_ts)).where(LedgerEntry.shop_id == shop.id))
    if last:
        start = max(start, last - 3 * 86400)  # artımlı: son kayıttan 3 gün geriden
    end = int(dt.datetime.now(dt.timezone.utc).timestamp())
    known = {e for (e,) in db.execute(select(LedgerEntry.entry_id).where(LedgerEntry.shop_id == shop.id))}
    total_windows = max(1, (end - start) // WINDOW + 1)
    st["phase"] = "Etsy hesap hareketleri indiriliyor"
    w = 0
    lo = start
    while lo <= end:
        hi = min(lo + WINDOW, end)
        offset = 0
        while True:
            page = client.request(
                "GET",
                f"/shops/{shop.etsy_shop_id}/payment-account/ledger-entries",
                params={"min_created": lo, "max_created": hi, "limit": 100, "offset": offset},
            )
            rows = page.get("results") or []
            for r in rows:
                if r["entry_id"] in known:
                    continue
                known.add(r["entry_id"])
                ref_type = r.get("reference_type") or ""
                ref_id = str(r.get("reference_id") or "")
                db.add(
                    LedgerEntry(
                        shop_id=shop.id,
                        entry_id=r["entry_id"],
                        created_ts=r.get("created_timestamp") or r.get("create_date") or 0,
                        amount=r.get("amount") or 0,
                        currency=r.get("currency") or "",
                        ledger_type=r.get("ledger_type") or r.get("description") or "",
                        reference_type=ref_type,
                        reference_id=ref_id,
                        receipt_id=int(ref_id) if ref_type == "receipt" and ref_id.isdigit() else None,
                    )
                )
            db.commit()
            offset += len(rows)
            if not rows or offset >= page.get("count", 0):
                break
        w += 1
        st["progress"] = min(0.6, 0.6 * w / total_windows)
        lo = hi + 1


def _sync_payments(db: Session, client: EtsyClient, shop: Shop, st: dict) -> None:
    have = {p for (p,) in db.execute(select(FinPayment.payment_id).where(FinPayment.shop_id == shop.id))}
    need = sorted(
        {
            int(r)
            for (r,) in db.execute(
                select(LedgerEntry.reference_id)
                .where(LedgerEntry.shop_id == shop.id)
                .where(LedgerEntry.reference_type.in_(["shop_payment", "processing_fee"]))
                .distinct()
            )
            if r.isdigit() and int(r) not in have
        }
    )
    st["phase"] = "Ödemeler siparişlerle eşleniyor"
    for i in range(0, len(need), 50):
        batch = need[i : i + 50]
        page = client.request(
            "GET", f"/shops/{shop.etsy_shop_id}/payments", params={"payment_ids": ",".join(map(str, batch))}
        )
        for p in page.get("results") or []:
            gross = p.get("amount_gross") or {}
            fees = p.get("amount_fees") or {}
            db.add(
                FinPayment(
                    shop_id=shop.id,
                    payment_id=p["payment_id"],
                    receipt_id=p["receipt_id"],
                    gross_minor=gross.get("amount") or 0,
                    fees_minor=fees.get("amount") or 0,
                    currency=p.get("currency") or gross.get("currency_code") or "",
                )
            )
        db.commit()
        st["progress"] = 0.6 + 0.4 * min(1.0, (i + 50) / max(1, len(need)))


def _link_receipts(db: Session, shop: Shop) -> None:
    """Ledger satırlarının sipariş bağlantısını tamamlar (işlem -> sipariş, ödeme -> sipariş)."""
    pay = {p: r for p, r in db.execute(select(FinPayment.payment_id, FinPayment.receipt_id).where(FinPayment.shop_id == shop.id))}
    tx: dict[int, int] = {}
    for rid, raw in db.execute(select(OrderCache.receipt_id, OrderCache.raw_json).where(OrderCache.shop_id == shop.id)):
        for t in json.loads(raw).get("transactions") or []:
            tx[t["transaction_id"]] = rid
    rows = db.scalars(
        select(LedgerEntry).where(LedgerEntry.shop_id == shop.id).where(LedgerEntry.receipt_id.is_(None))
        .where(LedgerEntry.reference_type.in_(["transaction", "shop_payment", "processing_fee"]))
    ).all()
    for e in rows:
        if not e.reference_id.isdigit():
            continue
        rid = tx.get(int(e.reference_id)) if e.reference_type == "transaction" else pay.get(int(e.reference_id))
        if rid:
            e.receipt_id = rid
    db.commit()


# ------------------------------------------------------------------ rapor

def _money(m: dict | None) -> float:
    return (m["amount"] / (m.get("divisor") or 100)) if m else 0.0


def _ym(d: dt.datetime) -> str:
    return f"{d.year}-{d.month:02d}"


def _shift_year(d: dt.date, years: int) -> dt.date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 Şubat
        return d.replace(year=d.year + years, day=28)


def _order_finance(db: Session, shop: Shop) -> tuple[list[dict], dict, dict]:
    """Her sipariş için kur ve ledger toplamları (mağaza para biriminde). Ayrıca aylık ortanca kur ve kapsam."""
    pays = {r: (g, c) for r, g, c in db.execute(select(FinPayment.receipt_id, FinPayment.gross_minor, FinPayment.currency).where(FinPayment.shop_id == shop.id))}
    by_receipt: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for rid, lt, s in db.execute(
        select(LedgerEntry.receipt_id, LedgerEntry.ledger_type, func.sum(LedgerEntry.amount))
        .where(LedgerEntry.shop_id == shop.id).where(LedgerEntry.receipt_id.is_not(None))
        .group_by(LedgerEntry.receipt_id, LedgerEntry.ledger_type)
    ):
        by_receipt[rid][category(lt)] += s
    orders = []
    fx_by_month: dict[str, list[float]] = defaultdict(list)
    for row in db.scalars(select(OrderCache).where(OrderCache.shop_id == shop.id)):
        raw = json.loads(row.raw_json)
        grand = _money(raw.get("grandtotal"))
        fx = None
        gross = pays.get(row.receipt_id)
        if gross and grand > 0:
            fx = (gross[0] / 100) / grand
            fx_by_month[_ym(row.created_at)].append(fx)
        orders.append({"row": row, "raw": raw, "grand": grand, "fx": fx, "led": by_receipt.get(row.receipt_id)})
    med = {m: statistics.median(v) for m, v in fx_by_month.items()}
    return orders, med, {"linked": len(by_receipt)}


def _overhead(db: Session, shop: Shop, med: dict[str, float], overall_fx: float) -> list[tuple[str, str, float]]:
    """Siparişe bağlı olmayan giderler: (ay, kategori, tutar[mağaza para birimi, pozitif = gider])."""
    out: list[tuple[str, str, float]] = []
    for ts, lt, cur, amt in db.execute(
        select(LedgerEntry.created_ts, LedgerEntry.ledger_type, LedgerEntry.currency, LedgerEntry.amount)
        .where(LedgerEntry.shop_id == shop.id).where(LedgerEntry.receipt_id.is_(None))
    ):
        cat = category(lt)
        if cat in ("transfer", "gross", "tax") or amt >= 0:
            continue
        d = dt.datetime.utcfromtimestamp(ts)
        out.append((_ym(d), cat if cat in OVERHEAD_LABELS else "other", (-amt / 100) / med.get(_ym(d), overall_fx)))
    return out


def report(db: Session, shop: Shop, start: dt.date, end: dt.date, country: str = "", collect: list | None = None, compare: list[int] | None = None) -> dict:
    """`compare`: karşılaştırılacak yıl farkları (1 = geçen yıl); ilki ana karşılaştırmadır (KPI/ülke), en fazla 4 tane.
    `collect` verilirse seçili dönemdeki her siparişin satırı (Excel dışa aktarma için) oraya eklenir."""
    orders, med, cov = _order_finance(db, shop)
    fxs = [f for o in orders if (f := o["fx"])]
    overall_fx = statistics.median(fxs) if fxs else 1.0
    costs = {c.listing_id: c for c in db.scalars(select(ListingCost).where(ListingCost.shop_id == shop.id))}
    vcosts = {(v.listing_id, v.variant_key): v for v in db.scalars(select(VariantCost).where(VariantCost.shop_id == shop.id))}
    hist = _load_history(db, shop)
    overrides = {o.receipt_id: o.cost for o in db.scalars(select(OrderCost).where(OrderCost.shop_id == shop.id))}
    titles = {}
    images = {}
    for lid, rawj in db.execute(select(ListingCache.listing_id, ListingCache.raw_json).where(ListingCache.shop_id == shop.id)):
        j = json.loads(rawj)
        titles[lid] = j.get("title", "")
        imgs = j.get("images") or []
        images[lid] = (imgs[0].get("url_170x135") if imgs else "") or ""

    def blank():
        return {"orders": 0, "sales": 0.0, "fees": 0.0, "refunds": 0.0, "cogs": 0.0, "fee_types": defaultdict(float), "units": 0}

    def compute(a: dt.date, b: dt.date, rows_out: list | None = None):
        months: dict[str, dict] = defaultdict(blank)
        countries: dict[str, dict] = defaultdict(blank)
        customers: dict[str, dict] = {}
        products: dict[int, dict] = {}
        total = blank()
        unknown_fee_orders = 0
        for o in orders:
            row, raw = o["row"], o["raw"]
            if not (a <= row.created_at.date() <= b) or (country and row.country_iso != country):
                continue
            total["all_orders"] = total.get("all_orders", 0) + 1
            if row.is_canceled:
                total["canceled"] = total.get("canceled", 0) + 1
                continue
            fx = o["fx"] or overall_fx
            led = o["led"] or {}
            grand = o["grand"]
            tax = -led.get("tax", 0) / 100 / fx if led else _money(raw.get("total_tax_cost"))
            sales = grand - tax
            refunds = sum(_money(r.get("amount")) for r in (raw.get("refunds") or []) if (r.get("status") or "").upper() in ("SUCCESS", "COMPLETED", ""))
            if refunds > 0:
                total["refunded_orders"] = total.get("refunded_orders", 0) + 1
            fee_types = {k: -led.get(k, 0) / 100 / fx for k in FEE_LABELS if k in led}
            if not led:
                unknown_fee_orders += 1
            fees = sum(fee_types.values())
            txs = raw.get("transactions") or []
            item_total = sum(_money(t.get("price")) * (t.get("quantity") or 1) for t in txs) or 1.0
            item_costs = [unit_cost_for(t, costs, vcosts, hist, row.created_at.date())[0] * (t.get("quantity") or 1) for t in txs]
            override = overrides.get(row.receipt_id)
            if override is not None:
                item_costs = [override * _money(t.get("price")) * (t.get("quantity") or 1) / item_total for t in txs]
            cogs = sum(item_costs)
            for t, item_cost in zip(txs, item_costs):
                qty = t.get("quantity") or 1
                share = _money(t.get("price")) * qty / item_total
                p = products.setdefault(
                    t.get("listing_id") or 0,
                    {"listing_id": t.get("listing_id") or 0, "title": titles.get(t.get("listing_id")) or t.get("title") or "", "units": 0, "sales": 0.0, "fees": 0.0, "refunds": 0.0, "cogs": 0.0, "variants": {}},
                )
                p["units"] += qty
                p["sales"] += share * sales
                p["fees"] += fees * share
                p["refunds"] += refunds * share
                p["cogs"] += item_cost
                vk = variant_key(t)
                v = p["variants"].setdefault(vk, {"key": vk, "units": 0, "sales": 0.0, "fees": 0.0, "cogs": 0.0})
                v["units"] += qty
                v["sales"] += share * sales
                v["fees"] += fees * share
                v["cogs"] += item_cost
            if rows_out is not None:
                rows_out.append(
                    {
                        "receipt_id": row.receipt_id,
                        "date": row.created_at.date().isoformat(),
                        "buyer": row.buyer_name,
                        "country": row.country_iso,
                        "items": "; ".join(
                            f"{t.get('quantity') or 1}x {html.unescape(t.get('title') or '')[:80]}" + (f" [{variant_key(t)}]" if variant_key(t) else "")
                            for t in txs
                        ),
                        "grand": grand,
                        "tax": tax,
                        "sales": sales,
                        "refunds": refunds,
                        "transaction_fee": fee_types.get("transaction", 0.0),
                        "processing_fee": fee_types.get("processing_fee", 0.0),
                        "regulatory_fee": fee_types.get("regulatory_fee", 0.0),
                        "other_fee": fee_types.get("other_fee", 0.0),
                        "cogs": cogs,
                        "manual_cost": override is not None,
                        "profit": sales - refunds - fees - cogs,
                        "fees_known": bool(led),
                    }
                )
            for bucket in (months[_ym(row.created_at)], countries[row.country_iso or "??"], total):
                bucket["orders"] += 1
                bucket["sales"] += sales
                bucket["fees"] += fees
                bucket["refunds"] += refunds
                bucket["cogs"] += cogs
                bucket["units"] += sum((t.get("quantity") or 1) for t in txs)
                for k, v in fee_types.items():
                    bucket["fee_types"][k] += v
            key = str(raw.get("buyer_user_id") or row.buyer_name)
            cu = customers.setdefault(key, {"name": row.buyer_name or "—", "country": row.country_iso, "orders": 0, "sales": 0.0, "last": ""})
            cu["orders"] += 1
            cu["sales"] += sales
            cu["last"] = max(cu["last"], row.created_at.date().isoformat())
        return months, countries, customers, products, total, unknown_fee_orders

    offsets = list(dict.fromkeys(o for o in (compare or [1]) if 1 <= o <= 15))[:4] or [1]
    pstart, pend = _shift_year(start, -offsets[0]), _shift_year(end, -offsets[0])
    cur = compute(start, end, collect)
    prev = compute(pstart, pend)

    # Siparişe bağlı olmayan giderler (reklam vb.)
    ov = _overhead(db, shop, med, overall_fx)

    def overhead_sum(a: dt.date, b: dt.date):
        y, m = a.year, a.month
        keys = set()
        while (y, m) <= (b.year, b.month):
            keys.add(f"{y}-{m:02d}")
            m += 1
            if m > 12:
                y, m = y + 1, 1
        by_type: dict[str, float] = defaultdict(float)
        by_month: dict[str, float] = defaultdict(float)
        for mm, c, v in ov:
            if mm in keys:
                by_type[c] += v
                by_month[mm] += v
        return by_type, by_month

    ov_cur, ovm_cur = overhead_sum(start, end)
    ov_prev, ovm_prev = overhead_sum(pstart, pend)

    def month_keys(a: dt.date, b: dt.date, shift=0):
        y, m = a.year + shift, a.month
        out = []
        while (y, m) <= (b.year + shift, b.month):
            out.append(f"{y}-{m:02d}")
            m += 1
            if m > 12:
                y, m = y + 1, 1
        return out

    def kpi(t, ovt):
        overhead = sum(ovt.values())
        profit = t["sales"] - t["refunds"] - t["fees"] - overhead - t["cogs"]
        return {
            "orders": t["orders"], "units": t["units"], "sales": t["sales"], "refunds": t["refunds"], "fees": t["fees"],
            "overhead": overhead, "cogs": t["cogs"], "profit": profit,
            "margin": (profit / t["sales"] * 100) if t["sales"] else 0.0,
            "aov": (t["sales"] / t["orders"]) if t["orders"] else 0.0,
            "etsy_share": ((t["fees"] + overhead) / t["sales"] * 100) if t["sales"] else 0.0,
            "ads": ovt.get("ads", 0.0),
            "ads_pct": (ovt.get("ads", 0.0) / t["sales"] * 100) if t["sales"] else 0.0,
            "all_orders": t.get("all_orders", 0),
            "canceled": t.get("canceled", 0),
            "refunded_orders": t.get("refunded_orders", 0),
            "problem_pct": ((t.get("canceled", 0) + t.get("refunded_orders", 0)) / t["all_orders"] * 100) if t.get("all_orders") else 0.0,
            "fee_types": {FEE_LABELS[k]: v for k, v in t["fee_types"].items()},
            "overhead_types": {OVERHEAD_LABELS[k]: v for k, v in ovt.items()},
        }

    cur_keys, prev_keys = month_keys(start, end), month_keys(start, end, -offsets[0])
    extras = []
    for o in offsets[1:]:
        a2, b2 = _shift_year(start, -o), _shift_year(end, -o)
        extras.append((o, compute(a2, b2), overhead_sum(a2, b2)[1], month_keys(start, end, -o)))
    series = []
    for i, (ck, pk) in enumerate(zip(cur_keys, prev_keys)):
        c, p = cur[0].get(ck, blank()), prev[0].get(pk, blank())
        cmp_extra = []
        for o, ex, exm, exk in extras:
            e = ex[0].get(exk[i], blank())
            cmp_extra.append({"offset": o, "sales": e["sales"], "orders": e["orders"], "profit": e["sales"] - e["refunds"] - e["fees"] - exm.get(exk[i], 0.0) - e["cogs"]})
        series.append({
            "cmp": cmp_extra,
            "month": ck,
            "sales": c["sales"], "fees": c["fees"], "overhead": ovm_cur.get(ck, 0.0), "cogs": c["cogs"],
            "profit": c["sales"] - c["refunds"] - c["fees"] - ovm_cur.get(ck, 0.0) - c["cogs"], "orders": c["orders"],
            "prev_sales": p["sales"], "prev_fees": p["fees"], "prev_orders": p["orders"],
            "prev_profit": p["sales"] - p["refunds"] - p["fees"] - ovm_prev.get(pk, 0.0) - p["cogs"],
        })

    country_rows = []
    for iso, c in sorted(cur[1].items(), key=lambda kv: -kv[1]["sales"])[:12]:
        pc = prev[1].get(iso, blank())
        country_rows.append({"iso": iso, "orders": c["orders"], "sales": c["sales"], "prev_orders": pc["orders"], "prev_sales": pc["sales"]})

    customers = sorted(cur[2].values(), key=lambda c: -c["sales"])[:15]

    prod_rows = []
    for p in cur[3].values():
        c = costs.get(p["listing_id"])
        profit = p["sales"] - p["refunds"] - p["fees"] - p["cogs"]
        prod_rows.append({
            **{k: v for k, v in p.items() if k != "variants"}, "image": images.get(p["listing_id"], ""), "profit": profit,
            "margin": (profit / p["sales"] * 100) if p["sales"] else 0.0,
            "unit_cost": c.unit_cost if c else None, "shipping_cost": c.shipping_cost if c else None,
            "cost_pct": c.cost_pct if c else None,
            "variants": sorted(
                (_variant_row(v, vcosts.get((p["listing_id"], v["key"]))) for v in p["variants"].values()),
                key=lambda v: -v["sales"],
            ),
        })
    prod_rows.sort(key=lambda r: -r["sales"])

    return {
        "offsets": offsets,
        "range": {"start": start.isoformat(), "end": end.isoformat(), "prev_start": pstart.isoformat(), "prev_end": pend.isoformat()},
        "currency": (orders[0]["raw"]["grandtotal"]["currency_code"] if orders else "USD"),
        "coverage": {"orders_in_range": cur[4]["orders"], "orders_without_fees": cur[5], "fx_median": overall_fx},
        "kpi": kpi(cur[4], ov_cur),
        "prev_kpi": kpi(prev[4], ov_prev),
        "series": series,
        "countries": country_rows,
        "customers": customers,
        "products": prod_rows if collect is not None else prod_rows[:60],
        "available_countries": sorted({o["row"].country_iso for o in orders if o["row"].country_iso}),
        "first_year": min((o["row"].created_at.year for o in orders), default=start.year),
    }


def _variant_row(v: dict, vc: VariantCost | None) -> dict:
    return {
        **v,
        "unit_cost": vc.unit_cost if vc else None,
        "shipping_cost": vc.shipping_cost if vc else None,
        "cost_pct": vc.cost_pct if vc else None,
    }


def _archive(db: Session, shop: Shop, listing_id: int, key: str, row, new: tuple[float, float, float], fix_past: bool) -> None:
    """Var olan (ve sıfırdan farklı) maliyet değişiyorsa eski sürümü bugüne kadarki siparişler için saklar.
    İlk kez girilen maliyet ya da `fix_past` (geçmişi de düzelt) ise sürüm saklanmaz: yeni değer tüm geçmişe uygulanır."""
    if fix_past:
        # Geçmişi düzelt: saklanmış eski sürümler silinir, yeni değer tüm geçmişe uygulanır.
        for h in db.scalars(select(CostHistory).where(CostHistory.shop_id == shop.id, CostHistory.listing_id == listing_id, CostHistory.variant_key == key)):
            db.delete(h)
        return
    if row is None:
        return
    old = (row.unit_cost, row.shipping_cost, row.cost_pct)
    if not any(old) or old == new:
        return
    db.add(
        CostHistory(
            shop_id=shop.id, listing_id=listing_id, variant_key=key, valid_until=dt.datetime.utcnow().date(),
            unit_cost=old[0], shipping_cost=old[1], cost_pct=old[2],
        )
    )


def set_cost(db: Session, shop: Shop, listing_id: int, unit_cost: float, shipping_cost: float, cost_pct: float = 0.0, fix_past: bool = False) -> None:
    new = (max(0.0, unit_cost), max(0.0, shipping_cost), min(1000.0, max(0.0, cost_pct)))
    row = db.scalar(select(ListingCost).where(ListingCost.shop_id == shop.id, ListingCost.listing_id == listing_id))
    _archive(db, shop, listing_id, "", row, new, fix_past)
    if row is None:
        row = ListingCost(shop_id=shop.id, listing_id=listing_id)
        db.add(row)
    row.unit_cost, row.shipping_cost, row.cost_pct = new
    row.updated_at = dt.datetime.utcnow()
    db.commit()


def set_variant_cost(db: Session, shop: Shop, listing_id: int, key: str, unit_cost: float, shipping_cost: float, cost_pct: float, fix_past: bool = False) -> None:
    new = (max(0.0, unit_cost), max(0.0, shipping_cost), min(1000.0, max(0.0, cost_pct)))
    row = db.scalar(select(VariantCost).where(VariantCost.shop_id == shop.id, VariantCost.listing_id == listing_id, VariantCost.variant_key == key))
    _archive(db, shop, listing_id, key[:300], row, new, fix_past)
    if row is None:
        row = VariantCost(shop_id=shop.id, listing_id=listing_id, variant_key=key[:300])
        db.add(row)
    row.unit_cost, row.shipping_cost, row.cost_pct = new
    db.commit()


def clear_variant_cost(db: Session, shop: Shop, listing_id: int, key: str) -> None:
    row = db.scalar(select(VariantCost).where(VariantCost.shop_id == shop.id, VariantCost.listing_id == listing_id, VariantCost.variant_key == key))
    if row is not None:
        db.delete(row)
        db.commit()


def set_order_cost(db: Session, shop: Shop, receipt_id: int, cost: float | None, note: str = "") -> None:
    row = db.scalar(select(OrderCost).where(OrderCost.shop_id == shop.id, OrderCost.receipt_id == receipt_id))
    if cost is None:
        if row is not None:
            db.delete(row)
            db.commit()
        return
    if row is None:
        row = OrderCost(shop_id=shop.id, receipt_id=receipt_id)
        db.add(row)
    row.cost = max(0.0, cost)
    row.note = note[:255]
    db.commit()


def orders_costs(db: Session, shop: Shop, start: dt.date, end: dt.date, q: str = "", page: int = 0, per_page: int = 30) -> dict:
    """Siparişler ve maliyetleri: otomatik hesap (seçenek/listing maliyetinden) ve elle girilmiş düzeltme."""
    costs = {c.listing_id: c for c in db.scalars(select(ListingCost).where(ListingCost.shop_id == shop.id))}
    vcosts = {(v.listing_id, v.variant_key): v for v in db.scalars(select(VariantCost).where(VariantCost.shop_id == shop.id))}
    hist = _load_history(db, shop)
    overrides = {o.receipt_id: o for o in db.scalars(select(OrderCost).where(OrderCost.shop_id == shop.id))}
    stmt = (
        select(OrderCache)
        .where(OrderCache.shop_id == shop.id, OrderCache.is_canceled.is_(False))
        .where(OrderCache.created_at >= dt.datetime.combine(start, dt.time.min))
        .where(OrderCache.created_at <= dt.datetime.combine(end, dt.time.max))
        .order_by(OrderCache.created_at.desc())
    )
    if q.strip():
        stmt = stmt.where(OrderCache.search_text.like(f"%{q.strip().lower()}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    out = []
    for row in db.scalars(stmt.offset(page * per_page).limit(per_page)):
        raw = json.loads(row.raw_json)
        txs = raw.get("transactions") or []
        resolved = [unit_cost_for(t, costs, vcosts, hist, row.created_at.date()) for t in txs]
        o = overrides.get(row.receipt_id)
        out.append(
            {
                "receipt_id": row.receipt_id,
                "date": row.created_at.date().isoformat(),
                "buyer": row.buyer_name,
                "country": row.country_iso,
                "total": _money(raw.get("grandtotal")),
                "items": [
                    {"title": html.unescape(t.get("title") or ""), "quantity": t.get("quantity") or 1, "variant": variant_key(t), "defined": r[1]}
                    for t, r in zip(txs, resolved)
                ],
                "auto_cost": sum(r[0] * (t.get("quantity") or 1) for t, r in zip(txs, resolved)),
                "override": o.cost if o else None,
                "note": o.note if o else "",
            }
        )
    return {"total": total, "orders": out}


LEDGER_LABELS = {
    "transaction": "İşlem ücreti",
    "processing_fee": "Ödeme işleme ücreti",
    "regulatory_fee": "Düzenleyici işletme ücreti",
    "tax": "Alıcıdan alınan vergi (Etsy tarafından ödenir)",
    "refund": "İade",
    "ads": "Reklam",
    "listing_fees": "Listeleme / yenileme",
}


def order_detail(db: Session, shop: Shop, receipt_id: int) -> dict | None:
    """Tek siparişin Etsy'deki gibi ayrıntısı: sipariş bilgileri, kalemler ve kazanç (alıcının ödediği, ücretler, net)."""
    row = db.scalar(select(OrderCache).where(OrderCache.shop_id == shop.id, OrderCache.receipt_id == receipt_id))
    if row is None:
        return None
    raw = json.loads(row.raw_json)
    grand = _money(raw.get("grandtotal"))
    currency = (raw.get("grandtotal") or {}).get("currency_code", "USD")
    pay = db.execute(select(FinPayment.gross_minor, FinPayment.currency).where(FinPayment.shop_id == shop.id, FinPayment.receipt_id == receipt_id)).first()
    fx = (pay[0] / 100 / grand) if pay and grand > 0 else None
    entries = db.scalars(
        select(LedgerEntry).where(LedgerEntry.shop_id == shop.id, LedgerEntry.receipt_id == receipt_id).order_by(LedgerEntry.created_ts, LedgerEntry.id)
    ).all()

    fees = []
    for e in entries:
        cat = category(e.ledger_type)
        if cat == "gross":
            continue
        rate = fx or 1.0
        fees.append({
            "label": LEDGER_LABELS.get(cat, e.ledger_type),
            "type": e.ledger_type,
            "amount": e.amount / 100 / rate,
            "original": e.amount / 100,
            "original_currency": e.currency,
        })
    fees_total = sum(f["amount"] for f in fees)

    costs = {c.listing_id: c for c in db.scalars(select(ListingCost).where(ListingCost.shop_id == shop.id))}
    vcosts = {(v.listing_id, v.variant_key): v for v in db.scalars(select(VariantCost).where(VariantCost.shop_id == shop.id))}
    hist = _load_history(db, shop)
    override = db.scalar(select(OrderCost).where(OrderCost.shop_id == shop.id, OrderCost.receipt_id == receipt_id))
    images = {}
    for lid, rj in db.execute(select(ListingCache.listing_id, ListingCache.raw_json).where(ListingCache.shop_id == shop.id)):
        imgs = json.loads(rj).get("images") or []
        if imgs:
            images[lid] = imgs[0].get("url_170x135") or ""

    items = []
    auto_cost = 0.0
    for t in raw.get("transactions") or []:
        qty = t.get("quantity") or 1
        unit, defined = unit_cost_for(t, costs, vcosts, hist, row.created_at.date())
        auto_cost += unit * qty
        items.append({
            "transaction_id": t.get("transaction_id"),
            "listing_id": t.get("listing_id"),
            "title": html.unescape(t.get("title") or ""),
            "image": images.get(t.get("listing_id"), ""),
            "quantity": qty,
            "price": _money(t.get("price")),
            "shipping": _money(t.get("shipping_cost")),
            "sku": t.get("sku") or "",
            "variations": [
                {"name": html.unescape(v.get("formatted_name") or ""), "value": html.unescape(v.get("formatted_value") or "")}
                for v in t.get("variations") or []
            ],
            "unit_cost": unit,
            "cost_defined": defined,
        })
    cogs = override.cost if override else auto_cost
    refunds = [
        {"amount": _money(r.get("amount")), "reason": r.get("reason") or "", "status": r.get("status") or ""}
        for r in raw.get("refunds") or []
    ]
    items_price = _money(raw.get("total_price"))
    discount = _money(raw.get("discount_amt"))
    shipping = _money(raw.get("total_shipping_cost"))
    gift_wrap = _money(raw.get("gift_wrap_price"))
    earned = grand + fees_total
    address = {
        "name": raw.get("name") or "",
        "lines": [x for x in (raw.get("first_line"), raw.get("second_line")) if x],
        "city": raw.get("city") or "",
        "state": raw.get("state") or "",
        "zip": raw.get("zip") or "",
        "country_iso": raw.get("country_iso") or "",
    }
    return {
        "receipt_id": receipt_id,
        "currency": currency,
        "created": row.created_at.isoformat(),
        "status": raw.get("status") or row.status,
        "is_gift": bool(raw.get("is_gift")),
        "gift_message": raw.get("gift_message") or "",
        "buyer": row.buyer_name,
        "buyer_message": raw.get("message_from_buyer") or "",
        "seller_note": raw.get("message_from_seller") or "",
        "address": address,
        "expected_ship": row.expected_ship_date.date().isoformat() if row.expected_ship_date else None,
        "shipments": [
            {"carrier": sh.get("carrier_name") or "", "tracking": sh.get("tracking_code") or ""}
            for sh in raw.get("shipments") or []
        ],
        "items": items,
        "earnings": {
            "buyer_paid": grand,
            "items_price": items_price,
            "discount": discount,
            "shipping": shipping,
            "gift_wrap": gift_wrap,
            "subtotal": items_price - discount,
            "before_tax": grand - _money(raw.get("total_tax_cost")) - _money(raw.get("total_vat_cost")),
            "tax_paid": _money(raw.get("total_tax_cost")) + _money(raw.get("total_vat_cost")),
            "fees": fees,
            "fees_total": fees_total,
            "earned": earned,
            "has_ledger": bool(entries),
            "fx": fx,
            "refunds": refunds,
            "cost": cogs,
            "cost_manual": override is not None,
            "auto_cost": auto_cost,
            "profit": earned - sum(r["amount"] for r in refunds) - cogs,
        },
    }

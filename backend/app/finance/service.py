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
from types import SimpleNamespace
from collections import Counter, defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.fingerprint import ResultCache, fingerprints
from app.core.i18n import get_lang, tr
import copy
from app.etsy.client import EtsyClient
from app.finance.models import FinPayment, LedgerEntry, ListingCost, OrderCost, VariantCost
from app.listings.models import ListingCache
from app.orders.models import OrderCache
from app.shops.models import Shop

log = logging.getLogger(__name__)

_state: dict[int, dict] = {}
ORDER_FIXED_ID = -1  # listing_costs içinde "sipariş başına sabit gider" için ayrılmış sahte listing_id
WINDOW = 30 * 86400

# Etiketler (Türkçe, İngilizce); hangisinin gösterileceği isteğin arayüz diline göre seçilir (core/i18n.py).
FEE_LABELS = {
    "transaction": ("İşlem ücreti", "Transaction fee"),
    "processing_fee": ("Ödeme işleme ücreti", "Processing fee"),
    "regulatory_fee": ("Düzenleyici işletme ücreti", "Regulatory operating fee"),
    "offsite_ads": ("Offsite Ads ücreti", "Offsite Ads fee"),
    "other_fee": ("Diğer sipariş ücretleri", "Other order fees"),
}
OVERHEAD_LABELS = {
    "ads": ("Etsy Ads / reklam", "Etsy Ads"),
    "listing_fees": ("Listeleme ve yenileme", "Listing and renewal fees"),
    "other": ("Diğer (abonelik, KDV, kredi)", "Other (subscription, VAT, credits)"),
}


def variant_key(t: dict) -> str:
    """İşlem satırındaki seçenekleri (boyut, renk…) tek metne çevirir; kişiselleştirme/serbest metin alanları hariç."""
    parts = []
    for v in t.get("variations") or []:
        name = (v.get("formatted_name") or "").strip()
        if name.lower() == "personalization" or v.get("question_id"):
            continue
        parts.append(f"{html.unescape(name)}: {html.unescape((v.get('formatted_value') or '').strip())}")
    return " | ".join(sorted(parts))[:300]


def cost_parts(t: dict, costs: dict, vcosts: dict, kc: float = 1.0, ship_override: float | None = None) -> dict:
    """Bir sipariş kaleminin ADET BAŞINA maliyetinin parçaları — her zaman GÜNCEL maliyetle (eski sürüm/geçmiş yok).
    Seçenek maliyeti ilan geneli maliyeti alan alan ezer (boş alan ilandan devralınır). `kc`: siparişin para biriminden rapor para birimine çarpan (fiyat %
    için). Dijital ürünlerde kargo yoktur. `ship_override`: bu kalem için yüklenen kargo faturalarından gelen GERÇEK adet
    başına kargo (nakliye + gümrük + ek hizmet toplamı) — verilmişse elle yazılan kargonun YERİNE geçer; elle yazılan
    değer yalnızca faturası olmayan siparişlerde tahmin olarak kullanılır. Döner: {unit, pct, ship, ship_source ("fatura" | "elle" | ""), defined}."""
    lid = t.get("listing_id")
    digital = bool(t.get("is_digital"))
    key = (lid, variant_key(t))
    real_ship = None if digital else ship_override

    # ALAN ALAN devralma: seçenekte boş (0) bırakılan alan ilan geneli kayıttan gelir; dolu alan onu ezer. Böylece ilana ortak
    # maliyet, seçeneğe yalnızca farklı olan alan (ör. kargo) yazılabilir. (0 = "girilmemiş"; 0 yazarak ana değer ezilemez.)
    v, l = vcosts.get(key), costs.get(lid)
    pick = lambda field: (getattr(v, field) if v else 0.0) or (getattr(l, field) if l else 0.0)  # noqa: E731
    unit, ship, pct = pick("unit_cost"), pick("shipping_cost"), pick("cost_pct")
    if not (unit or ship or pct):
        if real_ship is None:
            return {"unit": 0.0, "pct": 0.0, "ship": 0.0, "ship_source": "", "defined": digital}
        return {"unit": 0.0, "pct": 0.0, "ship": real_ship, "ship_source": "fatura", "defined": True}
    source = "elle" if ship else ""
    if digital:
        ship, source = 0.0, ""
    elif real_ship is not None:  # siparişin GERÇEK kargo faturası varsa o esastır; elle yazılan yalnızca faturasız siparişlerde tahmindir
        ship, source = real_ship, "fatura"
    return {"unit": unit, "pct": pct / 100 * _money(t.get("price")) * kc, "ship": ship, "ship_source": source, "defined": True}


def unit_cost_for(t: dict, costs: dict, vcosts: dict, kc: float = 1.0, ship_override: float | None = None) -> tuple[float, bool]:
    """`cost_parts`'ın toplamı: (adet başına maliyet+kargo, tanımlı mı)."""
    c = cost_parts(t, costs, vcosts, kc, ship_override)
    return c["unit"] + c["pct"] + c["ship"], c["defined"]


def _ship_overrides(inv_order: dict, receipt_id: int, txs: list[dict]) -> list[float | None]:
    """Siparişin her kalemi için faturalardan gelen gerçek ADET BAŞINA kargo (fatura yoksa None)."""
    out: list[float | None] = []
    for t in txs:
        actual = inv_order.get((receipt_id, t.get("listing_id") or 0, variant_key(t)))
        out.append(actual / (t.get("quantity") or 1) if actual is not None else None)
    return out


def _fixed_cost(costs: dict) -> float:
    """Sipariş başına sabit gider (ambalaj, etiket…)."""
    src = costs.get(ORDER_FIXED_ID)
    return src.unit_cost if src is not None else 0.0


def _all_digital(txs: list[dict]) -> bool:
    return bool(txs) and all(t.get("is_digital") for t in txs)


def category(ledger_type: str) -> str:
    """Ledger türünü kategoriye ayırır. `*_refund` (ücret iadesi) satırları asıl türüyle aynı kategoriye girer; böylece
    işaretli toplamda ücret iadeleri ilgili ücretten düşer. Müşteriye yapılan iade ledger'ı (REFUND*) ayrı tutulur:
    iadeler siparişlerin kendi iade tutarlarından hesaplanır, aynı iade iki kez sayılmasın."""
    t = ledger_type.lower()
    base = t[: -len("_refund")] if t.endswith("_refund") else t
    if base in ("payment_gross", "payment"):
        return "gross"
    if base in ("sales_tax", "refund_reversal_sales_tax"):
        return "tax"
    if base in ("transaction", "transaction_quantity", "shipping_transaction", "gift_wrap_fees", "gift_wrap"):
        return "transaction"
    if base in ("payment_processing_fee", "vat_on_processing_fees"):
        return "processing_fee"
    if base == "regulatory_operating_fee":
        return "regulatory_fee"
    if base == "offsite_ads_fee":
        return "offsite_ads"
    if t.startswith("refund"):
        return "refund"
    if "disburse" in t or t in ("recoup", "envoy_reversal"):
        return "transfer"
    if base == "prolist":
        return "ads"
    if base.startswith(("renew", "listing", "auto_renew")):
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
        "phase": tr(st.get("phase", ""), _PHASE_EN.get(st.get("phase", ""), st.get("phase", ""))),
        "error": st.get("error"),
    }


# Arka plan iş parçacığı isteğin dilini bilmez; aşama Türkçe saklanır, durum sorgusunda çevrilir.
_PHASE_EN = {
    "Başlıyor": "Starting",
    "Etsy hesap hareketleri indiriliyor": "Downloading Etsy account activity",
    "Ödemeler siparişlerle eşleniyor": "Matching payments to orders",
}


def start_sync(shop: Shop, full: bool = False) -> bool:
    st = _state.setdefault(shop.id, {})
    if st.get("running"):
        return False
    st.update(running=True, progress=0.0, phase="Başlıyor", error=None)
    threading.Thread(target=_run, args=(shop.id, full), daemon=True).start()
    return True


def run_sync_now(shop: Shop) -> bool:
    """Zamanlanmış iş için: senkronu çağıran iş parçacığında, bitene kadar çalıştırır (ayrı thread açmaz).
    Ledger her 30 günlük pencereden sonra kaydedildiği için yarıda kesilirse bir sonraki çalıştırma kaldığı yerden devam eder."""
    st = _state.setdefault(shop.id, {})
    if st.get("running"):
        return False
    st.update(running=True, progress=0.0, phase="Başlıyor", error=None)
    _run(shop.id, False)
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


ORDER_FEE_BUCKETS = ("transaction", "processing_fee", "regulatory_fee", "offsite_ads")


def _fx_tables(db: Session, shop: Shop) -> dict:
    """Kur tabloları (yalnızca sipariş sütunları ve ödeme tutarlarından; JSON açmaz, hızlıdır).
    Rapor para birimi `R` = en çok sipariş alınan para birimi. `own[rid]` = ödeme hesabı birimi / sipariş para birimi,
    `med[(para birimi, ay)]` aynı oranın aylık ortancası."""
    rows = db.execute(
        select(OrderCache.receipt_id, OrderCache.grandtotal_amount, OrderCache.grandtotal_divisor, OrderCache.currency_code, OrderCache.created_at)
        .where(OrderCache.shop_id == shop.id)
    ).all()
    pays = {r: g for r, g in db.execute(select(FinPayment.receipt_id, FinPayment.gross_minor).where(FinPayment.shop_id == shop.id))}
    counts = Counter(c for _, _, _, c, _ in rows)
    # Mağaza sahibi ayarlardan elle sabitlediyse (Shop.currency) onu kullan; yoksa siparişlerde en çok geçen para birimi.
    report_ccy = shop.currency or (counts.most_common(1)[0][0] if counts else "USD")
    own: dict[int, float] = {}
    per: dict[tuple[str, str], list[float]] = defaultdict(list)
    allc: dict[str, list[float]] = defaultdict(list)
    meta: dict[int, tuple[str, str]] = {}
    for rid, amt, div, ccy, created in rows:
        ym = _ym(created)
        meta[rid] = (ccy, ym)
        g = pays.get(rid)
        grand = amt / (div or 100)
        if g and grand > 0:
            fx = g / 100 / grand
            own[rid] = fx
            per[(ccy, ym)].append(fx)
            allc[ccy].append(fx)
    return {
        "R": report_ccy,
        "med": {k: statistics.median(v) for k, v in per.items()},
        "overall": {c: statistics.median(v) for c, v in allc.items()},
        "own": own,
        "meta": meta,
    }


def _factors(tbl: dict, rid: int) -> tuple[float, float]:
    """(kc, kl): kc = sipariş para biriminden rapor para birimine çarpan; kl = ledger ana birimden rapor para birimine.
    Sipariş rapor para biriminde ise kc=1 ve kl siparişin kendi ödeme kurudur (tam doğru). Başka para birimindeyse
    ödeme hesabı üzerinden çevrilir: tutar × (hesap/sipariş kuru) ÷ (hesap/rapor kuru, ayın ortancası)."""
    R = tbl["R"]
    ccy, ym = tbl["meta"].get(rid, (R, ""))
    med_r = tbl["med"].get((R, ym)) or tbl["overall"].get(R) or 1.0
    own = tbl["own"].get(rid)
    if ccy == R:
        return 1.0, 1.0 / (own or med_r)
    fx_c = own or tbl["med"].get((ccy, ym)) or tbl["overall"].get(ccy)
    return ((fx_c / med_r) if fx_c else 1.0), 1.0 / med_r


ORDER_FEE_BUCKETS = ("transaction", "processing_fee", "regulatory_fee", "offsite_ads")


# _order_finance TÜM sipariş geçmişini JSON'dan çözüp ledger'la eşliyor — mağaza büyüdükçe pahalılaşan tek işlem.
# `report()` seçilen dönem + her karşılaştırma yılı için bunu tekrar tekrar süzüyordu (aynı veriyi 2-4 kez); sonuç,
# tarih aralığı ne olursa olsun rapor her açılışta TÜM geçmişe göre yeniden hesaplanıyordu. Etsy'listing performansındaki
# `_sales_index` ile aynı desen: veri (sipariş/ödeme) değişmediği sürece bir kere hesaplanır, sonraki her rapor isteği
# yerelden (anında) döner; yalnızca "Etsy'den güncelle" ya da yeni bir sipariş gelince yeniden kurulur.
_finance_cache: dict[int, tuple[tuple, tuple[list[dict], dict, dict]]] = {}
_finance_lock = threading.Lock()


def _finance_version(db: Session, shop: Shop) -> tuple:
    n, last = db.execute(select(func.count(), func.max(OrderCache.synced_at)).where(OrderCache.shop_id == shop.id)).one()
    pays = db.scalar(select(func.count()).select_from(FinPayment).where(FinPayment.shop_id == shop.id)) or 0
    ln, ll = db.execute(select(func.count(), func.max(LedgerEntry.created_ts)).where(LedgerEntry.shop_id == shop.id)).one()
    return (n, str(last), pays, ln, ll, shop.currency)


_TX_KEYS = ("transaction_id", "listing_id", "title", "price", "quantity", "is_digital", "sku", "shipping_cost")


def _slim_receipt(raw: dict) -> dict:
    """Rapor için gereken alanlar. Ham sipariş JSON'unun tamamı (ürün açıklamaları, adresler…) bellekte tutulmaz:
    önbellek tüm sipariş geçmişini taşıdığı için bu, 512 MB'lık sunucuda belleğin dolup sürecin çökmesine yol açıyordu."""
    return {
        "grandtotal": raw.get("grandtotal"),
        "total_tax_cost": raw.get("total_tax_cost"),
        "buyer_user_id": raw.get("buyer_user_id"),
        "refunds": [{"amount": r.get("amount"), "status": r.get("status")} for r in raw.get("refunds") or []],
        "shipments": [{"tracking_code": sh.get("tracking_code")} for sh in raw.get("shipments") or [] if sh.get("tracking_code")],
        "transactions": [
            {
                **{k: t.get(k) for k in _TX_KEYS},
                "variations": [
                    {"formatted_name": v.get("formatted_name"), "formatted_value": v.get("formatted_value"), "question_id": v.get("question_id")}
                    for v in t.get("variations") or []
                ],
            }
            for t in raw.get("transactions") or []
        ],
    }


def _order_finance(db: Session, shop: Shop) -> tuple[list[dict], dict, dict]:
    """Her sipariş için ledger toplamları ve para birimi çarpanları. Ayrıca rapor para biriminde aylık ortanca kur."""
    version = _finance_version(db, shop)
    with _finance_lock:
        cached = _finance_cache.get(shop.id)
        if cached and cached[0] == version:
            return cached[1]

    tbl = _fx_tables(db, shop)
    pays = {
        r: (g, c, f)
        for r, g, c, f in db.execute(
            select(FinPayment.receipt_id, FinPayment.gross_minor, FinPayment.currency, FinPayment.fees_minor).where(FinPayment.shop_id == shop.id)
        )
    }
    by_receipt: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    has_pp: set[int] = set()
    for rid, lt, s in db.execute(
        select(LedgerEntry.receipt_id, LedgerEntry.ledger_type, func.sum(LedgerEntry.amount))
        .where(LedgerEntry.shop_id == shop.id).where(LedgerEntry.receipt_id.is_not(None))
        .group_by(LedgerEntry.receipt_id, LedgerEntry.ledger_type)
    ):
        cat = category(lt)
        if cat in ("gross", "tax", "transfer", "refund") or cat in ORDER_FEE_BUCKETS:
            key = cat
        else:
            key = "other_fee"  # siparişe bağlı diğer ücret/kredi (buyer_fee vb.)
        by_receipt[rid][key] += s
        if lt == "PAYMENT_PROCESSING_FEE":
            has_pp.add(rid)
    orders = []
    cols = (OrderCache.receipt_id, OrderCache.created_at, OrderCache.country_iso, OrderCache.is_canceled, OrderCache.buyer_name,
            OrderCache.status, OrderCache.expected_ship_date, OrderCache.raw_json)
    # Parça parça okunur (tüm ham JSON'lar aynı anda belleğe alınmaz); ORM nesnesi yerine hafif bir kayıt tutulur.
    for rid, created_at, country_iso, is_canceled, buyer_name, status, expected_ship_date, raw_json in db.execute(
        select(*cols).where(OrderCache.shop_id == shop.id).execution_options(yield_per=200)
    ):
        raw = _slim_receipt(json.loads(raw_json))
        row = SimpleNamespace(receipt_id=rid, created_at=created_at, country_iso=country_iso, is_canceled=is_canceled,
                              buyer_name=buyer_name, status=status, expected_ship_date=expected_ship_date)
        kc, kl = _factors(tbl, row.receipt_id)
        gross = pays.get(row.receipt_id)
        led = by_receipt.get(row.receipt_id)
        if led is not None and row.receipt_id not in has_pp and gross and gross[2]:
            # Eski tip ödemelerde (ledger'da `PAYMENT`) işleme ücreti ayrı satır değildir; ödeme kaydındaki tutar kullanılır.
            led = dict(led)
            led["processing_fee"] = led.get("processing_fee", 0) - gross[2]
        orders.append({"row": row, "raw": raw, "grand": _money(raw.get("grandtotal")), "fx": tbl["own"].get(row.receipt_id), "kc": kc, "kl": kl, "led": led})
    R = tbl["R"]
    med_r = {ym: v for (c, ym), v in tbl["med"].items() if c == R}
    result = (orders, med_r, {"R": R, "overall_r": tbl["overall"].get(R) or 1.0})
    with _finance_lock:
        _finance_cache[shop.id] = (version, result)
    return result


def _overhead(db: Session, shop: Shop, med: dict[str, float], overall_fx: float) -> list[tuple[dt.date, str, str, float]]:
    """Siparişe bağlı olmayan giderler: (tarih, ay, kategori, tutar[mağaza para birimi; pozitif = gider, negatif = kredi/iade]).
    Banka aktarımları, vergi ve müşteri iadeleri hariçtir (iadeler siparişlerin kendi iade tutarından gelir)."""
    out: list[tuple[dt.date, str, str, float]] = []
    for ts, lt, amt in db.execute(
        select(LedgerEntry.created_ts, LedgerEntry.ledger_type, LedgerEntry.amount)
        .where(LedgerEntry.shop_id == shop.id).where(LedgerEntry.receipt_id.is_(None))
    ):
        cat = category(lt)
        if cat in ("transfer", "gross", "tax", "refund"):
            continue
        d = dt.datetime.utcfromtimestamp(ts)
        out.append((d.date(), _ym(d), cat if cat in OVERHEAD_LABELS else "other", (-amt / 100) / med.get(_ym(d), overall_fx)))
    return out


# Hesaplanmış rapor sonuçları (dashboard ve Finans sayfası aynı dönemi tekrar tekrar ister). Geçerlilik: siparişler/ödemeler/
# ledger sürümü + maliyet, fatura ve listing tablolarının parmak izi + arayüz dili (etiketler dile göre).
_REPORT_SOURCES = ("listing_costs", "variant_costs", "order_costs", "shipping_invoices", "listing_cache")
_report_cache = ResultCache(max_items=60)


def report(db: Session, shop: Shop, start: dt.date, end: dt.date, country: str = "", collect: list | None = None, compare: list[int] | None = None) -> dict:
    if collect is not None:  # Excel dışa aktarma sipariş satırlarını da ister; önbelleğe alınmaz
        return _report(db, shop, start, end, country, collect, compare)
    fp = fingerprints(db, _REPORT_SOURCES, shop.id)
    if fp is None:
        return _report(db, shop, start, end, country, None, compare)
    key = (shop.id, start, end, country, tuple(compare or ()), get_lang(), _finance_version(db, shop), fp)
    cached = _report_cache.get(key)
    if cached is None:
        cached = _report(db, shop, start, end, country, None, compare)
        _report_cache.set(key, cached)
    return copy.deepcopy(cached)  # çağıran sonucu değiştirse bile önbellek bozulmasın


def _report(db: Session, shop: Shop, start: dt.date, end: dt.date, country: str = "", collect: list | None = None, compare: list[int] | None = None) -> dict:
    """`compare`: karşılaştırılacak yıl farkları (1 = geçen yıl); ilki ana karşılaştırmadır (KPI/ülke), en fazla 4 tane.
    `collect` verilirse seçili dönemdeki her siparişin satırı (Excel dışa aktarma için) oraya eklenir."""
    orders, med, cov = _order_finance(db, shop)
    overall_fx = cov["overall_r"]
    costs = {c.listing_id: c for c in db.scalars(select(ListingCost).where(ListingCost.shop_id == shop.id))}
    vcosts = {(v.listing_id, v.variant_key): v for v in db.scalars(select(VariantCost).where(VariantCost.shop_id == shop.id))}
    from app.finance import invoices as _invoices  # döngüsel import'tan kaçınmak için burada
    inv_ship = _invoices.invoice_totals(db, shop)  # yalnızca tabloda bilgi göstermek için (toplam/ağırlık/adet)
    inv_order = _invoices.order_shipping(db, shop)  # (sipariş, listing, seçenek) -> gerçek kargo; maliyette kullanılır
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
            kc, kl = o["kc"], o["kl"]  # kc: sipariş para birimi -> rapor para birimi, kl: ledger -> rapor para birimi
            led = o["led"] or {}
            grand = o["grand"] * kc
            tax = -led.get("tax", 0) / 100 * kl if led else _money(raw.get("total_tax_cost")) * kc
            sales = grand - tax
            refunds = sum(_money(r.get("amount")) for r in (raw.get("refunds") or []) if (r.get("status") or "").upper() in ("SUCCESS", "COMPLETED", "")) * kc
            if refunds > 0:
                total["refunded_orders"] = total.get("refunded_orders", 0) + 1
            fee_types = {k: -led.get(k, 0) / 100 * kl for k in FEE_LABELS if k in led}
            if not led:
                unknown_fee_orders += 1
            fees = sum(fee_types.values())
            txs = raw.get("transactions") or []
            item_total = sum(_money(t.get("price")) * (t.get("quantity") or 1) for t in txs) or 1.0
            ship_ov = _ship_overrides(inv_order, row.receipt_id, txs)
            resolved_costs = [unit_cost_for(t, costs, vcosts, kc, sv) for t, sv in zip(txs, ship_ov)]
            item_costs = [r[0] * (t.get("quantity") or 1) for t, r in zip(txs, resolved_costs)]
            fixed = 0.0 if _all_digital(txs) else _fixed_cost(costs)
            if fixed:  # sipariş başına sabit gider (ambalaj, etiket): kalemlere fiyat payına göre dağıtılır
                item_costs = [c + fixed * _money(t.get("price")) * (t.get("quantity") or 1) / item_total for t, c in zip(txs, item_costs)]
            override = overrides.get(row.receipt_id)
            if override is not None:
                item_costs = [override * _money(t.get("price")) * (t.get("quantity") or 1) / item_total for t in txs]
            cogs = sum(item_costs)
            for t, item_cost, r in zip(txs, item_costs, resolved_costs):
                qty = t.get("quantity") or 1
                share = _money(t.get("price")) * qty / item_total
                p = products.setdefault(
                    t.get("listing_id") or 0,
                    {"listing_id": t.get("listing_id") or 0, "title": titles.get(t.get("listing_id")) or t.get("title") or "", "units": 0, "sales": 0.0, "fees": 0.0, "refunds": 0.0, "cogs": 0.0, "variants": {}, "is_digital": False, "buyers": set()},
                )
                p["units"] += qty
                if row.buyer_name:
                    p["buyers"].add(row.buyer_name)
                if t.get("is_digital"):
                    p["is_digital"] = True
                p["sales"] += share * sales
                p["fees"] += fees * share
                p["refunds"] += refunds * share
                p["cogs"] += item_cost
                vk = variant_key(t)
                inv = inv_ship.get((t.get("listing_id"), vk)) or inv_ship.get((t.get("listing_id"), ""))
                v = p["variants"].setdefault(
                    vk,
                    {
                        "key": vk, "units": 0, "sales": 0.0, "fees": 0.0, "refunds": 0.0, "cogs": 0.0,
                        "is_digital": bool(t.get("is_digital")),
                        "weight_kg": inv.get("weight_kg") if inv else None,
                        "invoice_amount": 0.0,  # yalnızca SEÇİLİ DÖNEMDEKİ faturalı siparişlerden toplanır (aşağıda)
                        "invoice_count": 0,
                        "orders": [],  # bu seçenekteki siparişler (faturalı/faturasız) — tıklayınca detay için; faturası yoksa atılır
                    },
                )
                v["units"] += qty
                v["sales"] += share * sales
                v["fees"] += fees * share
                v["refunds"] += refunds * share
                v["cogs"] += item_cost
                actual = inv_order.get((row.receipt_id, t.get("listing_id") or 0, vk))
                if actual is not None and not t.get("is_digital"):
                    v["invoice_amount"] += actual
                    v["invoice_count"] += 1
                if not t.get("is_digital"):
                    v["orders"].append({
                        "receipt_id": row.receipt_id, "buyer": row.buyer_name or "", "date": row.created_at.date().isoformat(),
                        "tracking": next((sh.get("tracking_code") for sh in raw.get("shipments") or [] if sh.get("tracking_code")), ""),
                        "invoice": actual,
                    })
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
                        "offsite_ads_fee": fee_types.get("offsite_ads", 0.0),
                        "other_fee": fee_types.get("other_fee", 0.0),
                        "cogs": cogs,
                        "manual_cost": override is not None,
                        "cost_defined": override is not None or all(r[1] for r in resolved_costs),
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
    order_rows: list = collect if collect is not None else []  # sipariş bazlı kâr listeleri için (dışa aktarma da aynı listeyi kullanır)
    cur = compute(start, end, order_rows)
    prev = compute(pstart, pend)

    # Siparişe bağlı olmayan giderler (reklam vb.)
    ov = _overhead(db, shop, med, overall_fx)

    if country:
        ov = []  # reklam/yenileme giderleri ülkeye atanamaz; ülke filtresinde dahil edilmez

    def overhead_sum(a: dt.date, b: dt.date):
        by_type: dict[str, float] = defaultdict(float)
        by_month: dict[str, float] = defaultdict(float)
        for d, mm, c, v in ov:
            if a <= d <= b:
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
            "ads": ovt.get("ads", 0.0) + t["fee_types"].get("offsite_ads", 0.0),
            "ads_pct": ((ovt.get("ads", 0.0) + t["fee_types"].get("offsite_ads", 0.0)) / t["sales"] * 100) if t["sales"] else 0.0,
            "all_orders": t.get("all_orders", 0),
            "canceled": t.get("canceled", 0),
            "refunded_orders": t.get("refunded_orders", 0),
            "problem_pct": ((t.get("canceled", 0) + t.get("refunded_orders", 0)) / t["all_orders"] * 100) if t.get("all_orders") else 0.0,
            "fee_types": {tr(*FEE_LABELS[k]): v for k, v in t["fee_types"].items()},
            "overhead_types": {tr(*OVERHEAD_LABELS[k]): v for k, v in ovt.items()},
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

    def brief(r: dict) -> dict:
        first = r["items"].split("; ")[0]
        return {
            "receipt_id": r["receipt_id"], "date": r["date"], "buyer": r["buyer"] or "", "country": r["country"] or "",
            "title": first.split("x ", 1)[-1] if "x " in first else first, "item_count": r["items"].count("; ") + 1,
            "sales": r["sales"], "cogs": r["cogs"], "profit": r["profit"], "cost_defined": r["cost_defined"],
            "margin": (r["profit"] / r["sales"] * 100) if r["sales"] else 0.0,
        }

    # Sipariş kârı = satış − iade − Etsy ücreti − maliyet (reklam/abonelik gibi ortak giderler hariç). Maliyeti hiç girilmemiş
    # siparişlerin kârı şişkin görünür (maliyet 0), sıralamayı bozmasın diye listelere alınmaz; kaç tane olduğu ayrıca döner.
    costed = [r for r in order_rows if r["cost_defined"]]
    top_orders = [brief(r) for r in sorted(costed, key=lambda r: -r["profit"])[:10]]
    worst_orders = [brief(r) for r in sorted(costed, key=lambda r: r["profit"])[:10]]
    orders_no_cost = len(order_rows) - len(costed)

    prod_rows = []
    for p in cur[3].values():
        c = costs.get(p["listing_id"])
        profit = p["sales"] - p["refunds"] - p["fees"] - p["cogs"]
        prod_rows.append({
            **{k: v for k, v in p.items() if k not in ("variants", "buyers")}, "image": images.get(p["listing_id"], ""), "profit": profit,
            "buyers": sorted(p["buyers"], key=str.lower),  # ürün aramasında müşteri adıyla da bulunabilsin
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
        "currency": cov["R"],
        "settings": {"order_fixed_cost": costs[ORDER_FIXED_ID].unit_cost if ORDER_FIXED_ID in costs else 0.0},
        "coverage": {"orders_in_range": cur[4]["orders"], "orders_without_fees": cur[5], "fx_median": overall_fx},
        "kpi": kpi(cur[4], ov_cur),
        "prev_kpi": kpi(prev[4], ov_prev),
        "series": series,
        "countries": country_rows,
        "customers": customers,
        "top_orders": top_orders,
        "worst_orders": worst_orders,
        "orders_no_cost": orders_no_cost,
        "products": prod_rows[:500],
        "overhead_excluded": bool(country),
        "available_countries": sorted({o["row"].country_iso for o in orders if o["row"].country_iso}),
        "first_year": min((o["row"].created_at.year for o in orders), default=start.year),
    }


def _variant_row(v: dict, vc: VariantCost | None) -> dict:
    v = {**v, "orders": v["orders"] if v.get("invoice_count") else []}  # sipariş listesi yalnızca faturası olan seçeneklerde gider (yük küçük kalsın)
    return {
        **v,
        "unit_cost": vc.unit_cost if vc else None,
        "shipping_cost": vc.shipping_cost if vc else None,
        "cost_pct": vc.cost_pct if vc else None,
    }


def set_cost(db: Session, shop: Shop, listing_id: int, unit_cost: float, shipping_cost: float, cost_pct: float = 0.0) -> None:
    """İlan geneli maliyet. Sürüm/geçmiş yok: girilen değer TÜM siparişler için (geçmiş dahil) geçerlidir."""
    row = db.scalar(select(ListingCost).where(ListingCost.shop_id == shop.id, ListingCost.listing_id == listing_id))
    if row is None:
        row = ListingCost(shop_id=shop.id, listing_id=listing_id)
        db.add(row)
    row.unit_cost, row.shipping_cost, row.cost_pct = max(0.0, unit_cost), max(0.0, shipping_cost), min(1000.0, max(0.0, cost_pct))
    row.updated_at = dt.datetime.utcnow()
    db.commit()


def set_order_fixed_cost(db: Session, shop: Shop, amount: float) -> None:
    """Sipariş başına sabit gider (ambalaj, etiket…); tüm siparişlere uygulanır."""
    set_cost(db, shop, ORDER_FIXED_ID, amount, 0.0, 0.0)


def set_variant_cost(db: Session, shop: Shop, listing_id: int, key: str, unit_cost: float, shipping_cost: float, cost_pct: float) -> None:
    row = db.scalar(select(VariantCost).where(VariantCost.shop_id == shop.id, VariantCost.listing_id == listing_id, VariantCost.variant_key == key))
    if row is None:
        row = VariantCost(shop_id=shop.id, listing_id=listing_id, variant_key=key[:300])
        db.add(row)
    row.unit_cost, row.shipping_cost, row.cost_pct = max(0.0, unit_cost), max(0.0, shipping_cost), min(1000.0, max(0.0, cost_pct))
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


def _order_nets(db: Session, shop: Shop, orders: dict[int, tuple[float, float, float]]) -> dict[int, dict]:
    """Verilen siparişler için Etsy sonrası net kazanç (alıcının ödediği − ücretler − vergi), rapor para biriminde.
    `orders`: {receipt_id: (sipariş tutarı [sipariş para birimi], kc, kl)}. order_detail ile aynı mantık, toplu sorgu."""
    if not orders:
        return {}
    rids = list(orders)
    pays = {
        r: (g, f)
        for r, g, f in db.execute(
            select(FinPayment.receipt_id, FinPayment.gross_minor, FinPayment.fees_minor).where(FinPayment.shop_id == shop.id, FinPayment.receipt_id.in_(rids))
        )
    }
    ents: dict[int, list[LedgerEntry]] = defaultdict(list)
    for e in db.scalars(select(LedgerEntry).where(LedgerEntry.shop_id == shop.id, LedgerEntry.receipt_id.in_(rids))):
        ents[e.receipt_id].append(e)
    out: dict[int, dict] = {}
    for rid, (grand, kc, kl) in orders.items():
        es = ents.get(rid)
        if not es:
            out[rid] = {"earned": grand * kc, "sales": grand * kc, "fees_known": False}
            continue
        g = pays.get(rid)
        total = tax = 0.0  # ledger ana birimi
        has_pp = False
        for e in es:
            cat = category(e.ledger_type)
            if cat == "gross":
                continue
            v = e.amount / 100
            total += v
            if cat == "tax":
                tax += -v
            if e.ledger_type == "PAYMENT_PROCESSING_FEE":
                has_pp = True
        if not has_pp and g and g[1]:
            total -= g[1] / 100  # eski tip ödeme: işleme ücreti ödeme kaydında
        out[rid] = {"earned": grand * kc + total * kl, "sales": grand * kc - tax * kl, "fees_known": True}
    return out


def orders_costs(db: Session, shop: Shop, start: dt.date, end: dt.date, q: str = "", page: int = 0, per_page: int = 30) -> dict:
    """Siparişler ve maliyetleri: otomatik hesap (seçenek/listing maliyetinden) ve elle girilmiş düzeltme."""
    costs = {c.listing_id: c for c in db.scalars(select(ListingCost).where(ListingCost.shop_id == shop.id))}
    vcosts = {(v.listing_id, v.variant_key): v for v in db.scalars(select(VariantCost).where(VariantCost.shop_id == shop.id))}
    overrides = {o.receipt_id: o for o in db.scalars(select(OrderCost).where(OrderCost.shop_id == shop.id))}
    tbl = _fx_tables(db, shop)
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
    page_rows = db.scalars(stmt.offset(page * per_page).limit(per_page)).all()
    parsed = {r.receipt_id: json.loads(r.raw_json) for r in page_rows}
    factors = {rid: _factors(tbl, rid) for rid in parsed}
    nets = _order_nets(db, shop, {rid: (_money(raw.get("grandtotal")), *factors[rid]) for rid, raw in parsed.items()})
    from app.finance import invoices as _invoices  # döngüsel import'tan kaçınmak için burada

    inv_order = _invoices.order_shipping(db, shop)
    out = []
    for row in page_rows:
        raw = parsed[row.receipt_id]
        kc, _kl = factors[row.receipt_id]
        txs = raw.get("transactions") or []
        on = row.created_at.date()
        ship_ov = _ship_overrides(inv_order, row.receipt_id, txs)
        resolved = [unit_cost_for(t, costs, vcosts, kc, sv) for t, sv in zip(txs, ship_ov)]
        fixed = 0.0 if _all_digital(txs) else _fixed_cost(costs)
        o = overrides.get(row.receipt_id)
        net = nets[row.receipt_id]
        grand = _money(raw.get("grandtotal"))
        out.append(
            {
                "receipt_id": row.receipt_id,
                "date": row.created_at.date().isoformat(),
                "buyer": row.buyer_name,
                "country": row.country_iso,
                "total": grand * kc,
                "original_currency": tbl["meta"][row.receipt_id][0],
                "original_total": grand,
                "items": [
                    {"title": html.unescape(t.get("title") or ""), "quantity": t.get("quantity") or 1, "variant": variant_key(t), "defined": r[1]}
                    for t, r in zip(txs, resolved)
                ],
                "auto_cost": sum(r[0] * (t.get("quantity") or 1) for t, r in zip(txs, resolved)) + fixed,
                "fixed_cost": fixed,
                "auto_defined": bool(resolved) and all(r[1] for r in resolved),
                "invoice_ship": sum(sv * (t.get("quantity") or 1) for t, sv in zip(txs, ship_ov) if sv is not None) if any(sv is not None for sv in ship_ov) else None,
                "earned": net["earned"],
                "sales": net["sales"],
                "refunds": sum(_money(rf.get("amount")) for rf in (raw.get("refunds") or []) if (rf.get("status") or "").upper() in ("SUCCESS", "COMPLETED", "")) * kc,
                "fees_known": net["fees_known"],
                "override": o.cost if o else None,
                "note": o.note if o else "",
            }
        )
    return {"total": total, "orders": out, "currency": tbl["R"]}


LEDGER_LABELS = {
    "transaction": ("İşlem ücreti", "Transaction fee"),
    "processing_fee": ("Ödeme işleme ücreti", "Processing fee"),
    "regulatory_fee": ("Düzenleyici işletme ücreti", "Regulatory operating fee"),
    "tax": ("Alıcıdan alınan vergi (Etsy tarafından ödenir)", "Tax collected from buyer (paid by Etsy)"),
    "refund": ("İade düzeltmesi", "Refund adjustment"),
    "offsite_ads": ("Offsite Ads ücreti", "Offsite Ads fee"),
    "ads": ("Reklam", "Ads"),
    "listing_fees": ("Listeleme / yenileme", "Listing / renewal"),
}

TYPE_LABELS = {
    "vat_on_processing_fees": ("Ödeme işleme ücreti KDV'si", "VAT on processing fees"),
    "shipping_transaction": ("Kargo işlem ücreti", "Shipping transaction fee"),
    "transaction_quantity": ("İşlem ücreti (ek adet)", "Transaction fee (extra quantity)"),
    "gift_wrap_fees": ("Hediye paketi ücreti", "Gift wrap fee"),
    "buyer_fee": ("Alıcı ücreti", "Buyer fee"),
    "regulatory_operating_fee_refund": ("Düzenleyici ücret iadesi", "Regulatory fee refund"),
    "transaction_refund": ("İşlem ücreti iadesi", "Transaction fee refund"),
    "offsite_ads_fee_refund": ("Offsite Ads ücreti iadesi", "Offsite Ads fee refund"),
    "refund_reversal_sales_tax": ("Vergi iadesi düzeltmesi", "Sales tax refund reversal"),
}


def order_detail(db: Session, shop: Shop, receipt_id: int) -> dict | None:
    """Tek siparişin Etsy'deki gibi ayrıntısı: sipariş bilgileri, kalemler ve kazanç. Tutarlar rapor para biriminde
    (sipariş başka para birimindeyse `original_*` alanlarında asıl tutar bulunur)."""
    row = db.scalar(select(OrderCache).where(OrderCache.shop_id == shop.id, OrderCache.receipt_id == receipt_id))
    if row is None:
        return None
    raw = json.loads(row.raw_json)
    tbl = _fx_tables(db, shop)
    kc, kl = _factors(tbl, receipt_id)
    grand_orig = _money(raw.get("grandtotal"))
    grand = grand_orig * kc
    orig_ccy = (raw.get("grandtotal") or {}).get("currency_code", tbl["R"])
    pay = db.execute(select(FinPayment.gross_minor, FinPayment.currency, FinPayment.fees_minor).where(FinPayment.shop_id == shop.id, FinPayment.receipt_id == receipt_id)).first()
    entries = db.scalars(
        select(LedgerEntry).where(LedgerEntry.shop_id == shop.id, LedgerEntry.receipt_id == receipt_id).order_by(LedgerEntry.created_ts, LedgerEntry.id)
    ).all()

    fees = []
    for e in entries:
        cat = category(e.ledger_type)
        if cat == "gross":
            continue
        fees.append({
            "label": tr(*TYPE_LABELS[e.ledger_type.lower()]) if e.ledger_type.lower() in TYPE_LABELS
            else tr(*LEDGER_LABELS[cat]) if cat in LEDGER_LABELS else e.ledger_type,
            "type": e.ledger_type,
            "amount": e.amount / 100 * kl,
            "original": e.amount / 100,
            "original_currency": e.currency,
        })
    if entries and pay and pay[2] and not any(e.ledger_type == "PAYMENT_PROCESSING_FEE" for e in entries):
        # Eski tip ödeme: işleme ücreti ledger'da ayrı satır değil, ödeme kaydında.
        fees.append({
            "label": "Ödeme işleme ücreti",
            "type": "PAYMENT_PROCESSING_FEE",
            "amount": -pay[2] / 100 * kl,
            "original": -pay[2] / 100,
            "original_currency": pay[1] or "",
        })
    fees_total = sum(f["amount"] for f in fees)

    costs = {c.listing_id: c for c in db.scalars(select(ListingCost).where(ListingCost.shop_id == shop.id))}
    vcosts = {(v.listing_id, v.variant_key): v for v in db.scalars(select(VariantCost).where(VariantCost.shop_id == shop.id))}
    override = db.scalar(select(OrderCost).where(OrderCost.shop_id == shop.id, OrderCost.receipt_id == receipt_id))
    images = {}
    for lid, rj in db.execute(select(ListingCache.listing_id, ListingCache.raw_json).where(ListingCache.shop_id == shop.id)):
        imgs = json.loads(rj).get("images") or []
        if imgs:
            images[lid] = imgs[0].get("url_170x135") or ""

    from app.finance import invoices as _invoices  # döngüsel import'tan kaçınmak için burada

    txs = raw.get("transactions") or []
    on = row.created_at.date()
    ship_ov = _ship_overrides(_invoices.order_shipping(db, shop), receipt_id, txs)
    items = []
    auto_items = 0.0
    for t, sv in zip(txs, ship_ov):
        qty = t.get("quantity") or 1
        parts = cost_parts(t, costs, vcosts, kc, sv)
        unit, defined = parts["unit"] + parts["pct"] + parts["ship"], parts["defined"]
        auto_items += unit * qty
        items.append({
            "transaction_id": t.get("transaction_id"),
            "listing_id": t.get("listing_id"),
            "title": html.unescape(t.get("title") or ""),
            "image": images.get(t.get("listing_id"), ""),
            "quantity": qty,
            "price": _money(t.get("price")) * kc,
            "shipping": _money(t.get("shipping_cost")) * kc,
            "sku": t.get("sku") or "",
            "is_digital": bool(t.get("is_digital")),
            "variations": [
                {"name": html.unescape(v.get("formatted_name") or ""), "value": html.unescape(v.get("formatted_value") or "")}
                for v in t.get("variations") or []
            ],
            "unit_cost": unit,
            "cost_defined": defined,
            "cost_parts": {"unit": parts["unit"], "pct": parts["pct"], "ship": parts["ship"], "ship_source": parts["ship_source"]},
        })
    fixed = 0.0 if _all_digital(txs) else _fixed_cost(costs)
    auto_cost = auto_items + fixed
    cogs = override.cost if override else auto_cost
    refunds = [
        {"amount": _money(r.get("amount")) * kc, "reason": r.get("reason") or "", "status": r.get("status") or ""}
        for r in raw.get("refunds") or []
    ]
    items_price = _money(raw.get("total_price")) * kc
    discount = _money(raw.get("discount_amt")) * kc
    shipping = _money(raw.get("total_shipping_cost")) * kc
    gift_wrap = _money(raw.get("gift_wrap_price")) * kc
    tax_paid = (_money(raw.get("total_tax_cost")) + _money(raw.get("total_vat_cost"))) * kc
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
        "currency": tbl["R"],
        "original_currency": orig_ccy,
        "original_total": grand_orig,
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
            "before_tax": grand - tax_paid,
            "tax_paid": tax_paid,
            "fees": fees,
            "fees_total": fees_total,
            "earned": earned,
            "has_ledger": bool(entries),
            "fx": (1 / kl) if kl else None,
            "refunds": refunds,
            "cost": cogs,
            "shipping_lines": _invoices.order_lines(db, shop, receipt_id),
            "cost_manual": override is not None,
            "auto_cost": auto_cost,
            "fixed_cost": fixed,
            "profit": earned - sum(r["amount"] for r in refunds) - cogs,
        },
    }

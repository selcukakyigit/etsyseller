"""Örnek mağaza verisi: tamamen UYDURMA bir seramik/ev dekoru mağazası (5 ilan, her birinde 2 görsel, video yok; yaklaşık 48 sipariş; finans, istatistik,
yorum). Gerçek bir mağazadan hiçbir şey kopyalanmaz; üretim deterministiktir (aynı çalıştırma aynı veriyi verir, yalnızca tarihler "bugün"e göre kayar).

Veri, Etsy'den gelmiş gibi aynı biçimde yazılır (ham JSON + türetilmiş sütunlar), böylece ekranlar ve servisler gerçek mağazadakiyle aynı kodla çalışır.
Örnek mağazanın Etsy belirteci yoktur ve `is_demo` işaretlidir: Etsy'ye hiçbir istek gitmez (bkz. app/etsy/client.py DemoShopError).
"""
import datetime as dt
import json
import random

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import Base
from app.finance.models import FinPayment, LedgerEntry, ListingCost, VariantCost
from app.listings.models import ListingCache, ListingHealth, ListingStatSnapshot
from app.orders.derive import derive
from app.orders.models import OrderCache
from app.shops.models import ReviewCache, ShippingReferenceCache, Shop

CURRENCY = "USD"
SHOP_NAME = "Terra & Ember Ceramics"
FIRST_LISTING_ID = 9_000_000_001
FIRST_RECEIPT_ID = 8_000_000_001
N_ORDERS = 48
N_OPEN = 6  # gönderilmeyi bekleyen siparişler
HISTORY_DAYS = 120
STATS_DAYS = 60
PERSONALIZATION_PROPERTY_ID = 54
# Örnek mağazaların `etsy_shop_id` değeri (benzersizdir) gerçek Etsy numaralarıyla çakışmasın diye negatif ve çalışma alanına özeldir. Kullanıcının tek tıkla
# açtığı örnek mağazalar (-2e9 - çalışma alanı) gerçek mağaza bağlanınca silinir; incelemeci hesaplarınınki (-3e9 - çalışma alanı) silinmez.
SELF_SERVICE_ID_BASE = 2_000_000_000
REVIEWER_ID_BASE = 3_000_000_000

COUNTRIES = [("US", "United States", 60), ("GB", "United Kingdom", 12), ("CA", "Canada", 8), ("DE", "Germany", 8), ("AU", "Australia", 6), ("FR", "France", 6)]

# Her ilan: ad, başlık, açıklama, etiketler, malzemeler, fiyat (sent), stok, görsel anahtarı, satış ağırlığı, maliyet, kargo maliyeti, görüntülenme, favori,
# sağlık durumu (aşama, darboğaz, not). İlanlar bilerek farklı durumlarda: biri iyi optimize, ikisinin SEO'su zayıf, biri dönüşümde takılı.
LISTINGS = [
    {
        "key": "mug", "section": 11, "title": "Speckled Stoneware Coffee Mug, Handmade Ceramic Mug 12 oz, Microwave Safe Gift for Coffee Lovers",
        "description": (
            "Our speckled stoneware mug is wheel-thrown by hand and glazed in a warm oat white with natural iron speckles. Every mug is slightly different, "
            "which is part of the charm.\n\nDetails\n- Holds 12 oz (350 ml)\n- Dishwasher and microwave safe\n- Food-safe lead-free glaze\n- Comfortable handle that fits two fingers\n\n"
            "Care: wash in warm water, avoid sudden temperature changes.\n\nA thoughtful gift for coffee and tea lovers, housewarmings and birthdays. "
            "Ships in recycled, fully protective packaging within 3-5 business days."
        ),
        "tags": ["ceramic mug", "coffee mug", "handmade mug", "stoneware mug", "speckled mug", "pottery mug", "tea cup", "gift for her", "gift for him", "housewarming gift", "kitchen decor", "birthday gift", "wheel thrown"],
        "materials": ["stoneware clay", "food safe glaze"], "price": 2800, "qty": 40, "weight": 40, "cost": 9.5, "ship_cost": 5.2, "views": 5400, "favs": 310,
        "health": ("stable", None, "Strong listing: keep as is."),
    },
    {
        "key": "planter", "section": 12, "title": "Hand Thrown Ceramic Planter with Drainage Hole and Saucer, Indoor Plant Pot in Terracotta or Sage",
        "description": (
            "A hand-thrown planter with a drainage hole and a matching saucer, made to give indoor plants a home that looks as good as the plant.\n\n"
            "Choose your size:\n- Small: 4 in (10 cm)\n- Medium: 6 in (15 cm)\n- Large: 8 in (20 cm)\n\nColors: terracotta glaze or soft sage. "
            "Each piece is made to order and finished by hand, so small variations are normal.\n\nPlants are not included."
        ),
        "tags": ["ceramic planter", "plant pot", "indoor planter", "succulent pot", "drainage planter", "terracotta pot", "sage green", "plant lover gift", "home decor", "handmade pottery", "plant saucer", "windowsill planter", "boho decor"],
        "materials": ["stoneware clay", "ceramic glaze"], "price": 3600, "qty": 30, "weight": 22, "cost": 12.0, "ship_cost": 6.4, "views": 3100, "favs": 140,
        "health": ("watching", None, "Collecting data."),
        "variants": [("Small", 3600, 9.5), ("Medium", 4600, 13.5), ("Large", 6200, 19.0)],
    },
    {
        "key": "candle", "section": 13, "title": "Soy Candle in Ceramic Jar",
        "description": "Hand poured soy candle in a ceramic jar. Reusable jar. Nice gift.",
        "tags": ["soy candle", "ceramic candle", "candle gift", "handmade candle", "home fragrance", "scented candle", "cozy gift", "reusable jar"],
        "materials": ["soy wax", "ceramic jar"], "price": 3400, "qty": 25, "weight": 8, "cost": 10.5, "ship_cost": 5.4, "views": 900, "favs": 28,
        "health": ("flagged", "seo", "Few views for the age of the listing: the title, tags and description are too thin for search."),
    },
    {
        "key": "bowls", "section": 12, "shipping_profile": 2, "title": "Ceramic Nesting Bowl Set of 3, Handmade Stoneware Serving Bowls for Kitchen and Table, Wedding Registry Gift",
        "description": (
            "A set of three nesting stoneware bowls in soft blue-grey glaze, designed to be used every day: cereal, salad, snacks, dips.\n\n"
            "Sizes: 4 in, 6 in and 8 in across. Dishwasher, microwave and oven safe. They nest together to save shelf space.\n\n"
            "Made by hand in small batches, which means each set is one of a kind. Packed with extra care for safe delivery."
        ),
        "tags": ["nesting bowls", "ceramic bowl set", "serving bowls", "stoneware bowls", "kitchen gift", "wedding registry", "handmade bowls", "salad bowl", "blue grey ceramic", "housewarming gift", "tableware", "pottery set", "cereal bowl"],
        "materials": ["stoneware clay", "food safe glaze"], "price": 7200, "qty": 12, "weight": 14, "cost": 26.0, "ship_cost": 9.5, "views": 1700, "favs": 96,
        "health": ("watching", None, "Collecting data."),
    },
    {
        "key": "dish", "section": 13, "title": "Personalized Ceramic Ring Dish with Name, Custom Jewelry Tray Bridesmaid Gift, Engagement Trinket Dish",
        "description": (
            "A small ceramic dish for rings and little treasures, personalized with the name of your choice in a hand-painted script.\n\n"
            "How to order: choose the dish, then type the name in the personalization box (up to 12 characters). "
            "Please check the spelling carefully, as personalized items cannot be returned.\n\nSize: about 4 in (10 cm). Ready to ship in 5-7 business days."
        ),
        "tags": ["ring dish", "personalized gift", "custom jewelry tray", "bridesmaid gift", "name ring dish", "engagement gift", "trinket dish", "wedding gift", "ceramic dish", "mothers day gift", "jewelry holder", "custom name", "bridal party"],
        "materials": ["porcelain", "ceramic glaze"], "price": 2400, "qty": 60, "weight": 20, "cost": 6.0, "ship_cost": 4.2, "views": 4200, "favs": 260,
        "health": ("flagged", "conversion", "Many views but few sales: check price, photos and the personalization instructions."),
    },
]


def _ts(d: dt.datetime) -> int:
    return int(d.replace(tzinfo=dt.timezone.utc).timestamp())


def _money(cents: int) -> dict:
    return {"amount": int(cents), "divisor": 100, "currency_code": CURRENCY}


def _image_url(key: str, n: int) -> str:
    return f"{settings.frontend_url.rstrip('/')}/demo/{key}-{n}.svg"


def _images(listing_id: int, key: str, title: str) -> list[dict]:
    alts = {"mug": ["Speckled stoneware coffee mug", "Top view of the mug"], "planter": ["Ceramic planter with a green plant", "Planter and saucer in two colors"],
            "candle": ["Soy candle in a ceramic jar", "Top view of the candle"], "bowls": ["Set of three nesting ceramic bowls", "Nesting bowls seen from above"],
            "dish": ["Ceramic ring dish with a name", "Ring dish with two rings"]}[key]
    out = []
    for i in (1, 2):
        url = _image_url(key, i)
        out.append({
            "listing_id": listing_id, "listing_image_id": listing_id * 10 + i, "rank": i, "hex_code": "#EFE6DA", "red": 239, "green": 230, "blue": 218,
            "alt_text": alts[i - 1], "url_75x75": url, "url_170x135": url, "url_570xN": url, "url_fullxfull": url, "full_height": 1000, "full_width": 1000,
        })
    return out


def _inventory(spec: dict, listing_id: int, now_ts: int) -> dict:
    """Etsy'nin envanter biçimi: varyasyonlu ilanda her boyut ayrı ürün, aksi hâlde tek ürün."""
    variants = spec.get("variants")
    if not variants:
        return {"products": [{"product_id": listing_id * 10, "sku": f"{spec['key'].upper()}-01", "is_deleted": False, "property_values": [],
                              "offerings": [{"offering_id": listing_id * 10, "quantity": spec["qty"], "is_enabled": True, "is_deleted": False, "price": _money(spec["price"])}]}],
                "price_on_property": [], "quantity_on_property": [], "sku_on_property": []}
    products = []
    for i, (name, price, _) in enumerate(variants, start=1):
        products.append({
            "product_id": listing_id * 10 + i, "sku": f"{spec['key'].upper()}-{name[:1]}", "is_deleted": False,
            "property_values": [{"property_id": 100, "property_name": "Size", "scale_id": None, "value_ids": [1000 + i], "values": [name]}],
            "offerings": [{"offering_id": listing_id * 10 + i, "quantity": spec["qty"] // len(variants), "is_enabled": True, "is_deleted": False, "price": _money(price)}],
        })
    return {"products": products, "price_on_property": [100], "quantity_on_property": [100], "sku_on_property": [100]}


def _listing_raw(spec: dict, index: int, now: dt.datetime) -> dict:
    listing_id = FIRST_LISTING_ID + index
    created = now - dt.timedelta(days=240 - index * 35)
    return {
        "listing_id": listing_id, "user_id": 1, "shop_id": 1, "title": spec["title"], "description": spec["description"], "state": "active",
        "creation_timestamp": _ts(created), "original_creation_timestamp": _ts(created), "last_modified_timestamp": _ts(now - dt.timedelta(days=12 + index)),
        "ending_timestamp": _ts(now + dt.timedelta(days=90)), "quantity": spec["qty"], "url": None,
        "num_favorers": spec["favs"], "views": spec["views"], "price": _money(spec["price"]),
        "tags": spec["tags"], "materials": spec["materials"], "style": [], "taxonomy_id": 1, "shipping_profile_id": spec.get("shipping_profile", 1), "return_policy_id": 1,
        "readiness_state_id": 1, "shop_section_id": spec["section"], "processing_min": 3, "processing_max": 5, "who_made": "i_did", "when_made": "made_to_order", "is_supply": False, "item_weight": spec["weight"],
        "item_weight_unit": "oz", "is_customizable": spec["key"] == "dish", "is_personalizable": spec["key"] == "dish",
        "personalization_is_required": spec["key"] == "dish", "personalization_char_count_max": 12, "personalization_instructions": "Type the name exactly as it should appear." if spec["key"] == "dish" else None,
        "has_variations": bool(spec.get("variants")), "should_auto_renew": True, "language": "en-US", "listing_type": "physical", "production_partners": [],
        "images": _images(listing_id, spec["key"], spec["title"]), "videos": [],
    }


def _reference_data(shop: Shop) -> dict:
    """Kargo/iade/hazırlık/bölüm/mağaza profili: sayfalar bunları Etsy'den çekip yerel önbelleğe yazar; örnek mağaza Etsy'ye hiç gitmediği için
    aynı biçimde hazır yazılır (bkz. shops/reference_cache.py). Listing'lerdeki `shipping_profile_id`, `shop_section_id` ile tutarlıdır."""
    def dest(dest_id: int, profile: int, country: str | None, region: str, cost: int, extra: int, lo: int, hi: int) -> dict:
        return {
            "shipping_profile_destination_id": dest_id, "shipping_profile_id": profile, "origin_country_iso": "US", "destination_country_iso": country,
            "destination_region": region, "primary_cost": _money(cost), "secondary_cost": _money(extra), "shipping_carrier_id": 0, "mail_class": None,
            "min_delivery_days": lo, "max_delivery_days": hi,
        }

    def profile(pid: int, title: str, us: int, intl: int) -> dict:
        return {
            "shipping_profile_id": pid, "title": title, "user_id": 1, "min_processing_days": 3, "max_processing_days": 5, "processing_days_display_label": "3-5 business days",
            "origin_country_iso": "US", "origin_postal_code": "00000", "profile_type": "manual", "is_deleted": False, "domestic_handling_fee": 0.0, "international_handling_fee": 0.0,
            "shipping_profile_destinations": [dest(pid * 10 + 1, pid, "US", "none", us, 200, 3, 6), dest(pid * 10 + 2, pid, None, "eu", intl, 400, 7, 14), dest(pid * 10 + 3, pid, None, "non_eu", intl + 300, 400, 8, 16)],
            "shipping_profile_upgrades": [],
        }

    return {
        "shipping_profiles": [profile(1, "Standard shipping", 595, 1495), profile(2, "Heavy and fragile items", 995, 2495)],
        "return_policies": [{"return_policy_id": 1, "accepts_returns": True, "accepts_exchanges": False, "return_deadline": 30}],
        "readiness_state_definitions": [{
            "readiness_state_id": 1, "readiness_state": "made_to_order", "min_processing_time": 3, "max_processing_time": 5, "processing_time_unit": "days",
            "min_processing_days": 3, "max_processing_days": 5, "processing_days_display_label": "3-5 business days",
        }],
        "sections": [
            {"shop_section_id": 11, "title": "Mugs and cups", "rank": 1, "user_id": 1, "active_listing_count": 1},
            {"shop_section_id": 12, "title": "Planters and decor", "rank": 2, "user_id": 1, "active_listing_count": 2},
            {"shop_section_id": 13, "title": "Gifts", "rank": 3, "user_id": 1, "active_listing_count": 2},
        ],
        "production_partners": [],
        "shop_profile": {
            "shop_id": shop.etsy_shop_id, "shop_name": shop.shop_name, "title": "Handmade ceramics for everyday life",
            "announcement": "Sample shop with made-up data. Nothing here is a real shop.", "url": None, "icon_url_fullxfull": None, "image_url_760x100": None,
            "num_favorers": 482, "listing_active_count": len(LISTINGS), "is_vacation": False, "vacation_message": None, "review_count": 8, "review_average": 4.9,
        },
    }


def clear_data(db: Session, shop_id: int) -> None:
    """Örnek mağazanın tüm yerel verisini siler (mağaza satırı kalır). Yenileme ve silmeden önce kullanılır."""
    for table in reversed(Base.metadata.sorted_tables):
        if table.name != "shops" and "shop_id" in table.c:
            db.execute(table.delete().where(table.c.shop_id == shop_id))


def _pick_country(rng: random.Random) -> tuple[str, str]:
    r, acc = rng.uniform(0, sum(c[2] for c in COUNTRIES)), 0
    for iso, name, weight in COUNTRIES:
        acc += weight
        if r <= acc:
            return iso, name
    return COUNTRIES[0][0], COUNTRIES[0][1]


def seed_shop(db: Session, shop: Shop, now: dt.datetime | None = None) -> dict:
    """Örnek mağazayı doldurur (önce eski veriyi siler). Sayıları döner."""
    now = (now or dt.datetime.utcnow()).replace(microsecond=0)
    rng = random.Random(20260101)
    clear_data(db, shop.id)

    # --- ilanlar, maliyetler, sağlık, istatistik
    raws: list[dict] = []
    for i, spec in enumerate(LISTINGS):
        raw = _listing_raw(spec, i, now)
        raws.append(raw)
        lid = raw["listing_id"]
        db.add(ListingCache(
            shop_id=shop.id, listing_id=lid, title=spec["title"], views=spec["views"], favorites=spec["favs"], raw_json=json.dumps(raw, ensure_ascii=False),
            inventory_json=json.dumps(_inventory(spec, lid, _ts(now))), properties_json="[]", variation_images_json="[]", personalization_json="[]", extras_synced=True,
            synced_at=now,
        ))
        db.add(ListingCost(shop_id=shop.id, listing_id=lid, unit_cost=spec["cost"], shipping_cost=spec["ship_cost"], cost_pct=0.0, updated_at=now))
        for name, _, cost in spec.get("variants") or []:
            db.add(VariantCost(shop_id=shop.id, listing_id=lid, variant_key=f"Size: {name}", unit_cost=cost, shipping_cost=spec["ship_cost"], cost_pct=0.0))
        stage, bottleneck, note = spec["health"]
        db.add(ListingHealth(shop_id=shop.id, listing_id=lid, stage=stage, bottleneck=bottleneck, note=note, window_start=now - dt.timedelta(days=45),
                             attempts=1 if stage == "flagged" else 0, tried_bottlenecks="[]", evaluated_at=now))
        # Günlük birikimli görüntülenme/favori: son STATS_DAYS gün, bugüne doğru artarak toplam değere ulaşır.
        v0, f0 = int(spec["views"] * 0.78), int(spec["favs"] * 0.8)
        for d in range(STATS_DAYS, -1, -1):
            frac = 1 - d / STATS_DAYS
            db.add(ListingStatSnapshot(
                shop_id=shop.id, listing_id=lid, views=int(v0 + (spec["views"] - v0) * frac), favorites=int(f0 + (spec["favs"] - f0) * frac),
                captured_at=now - dt.timedelta(days=d, hours=1),
            ))

    # --- siparişler
    weights = [s["weight"] for s in LISTINGS]
    entry_id, payment_id, tx_id = 7_000_000_000, 6_000_000_000, 5_000_000_000
    receipts: list[dict] = []
    for n in range(1, N_ORDERS + 1):
        open_order = n <= N_OPEN
        age_days = rng.uniform(0.2, 5) if open_order else rng.uniform(6, HISTORY_DAYS)
        created = now - dt.timedelta(days=age_days)
        iso, country = _pick_country(rng)
        receipt_id = FIRST_RECEIPT_ID + n
        buyer = f"Demo Buyer {n}"
        picks = [rng.choices(range(len(LISTINGS)), weights)[0]] + ([rng.choices(range(len(LISTINGS)), weights)[0]] if rng.random() < 0.25 else [])
        txs, subtotal, ship_total = [], 0, 0
        for pos, idx in enumerate(picks):
            spec, raw = LISTINGS[idx], raws[idx]
            qty = 2 if rng.random() < 0.15 else 1
            price, variations = spec["price"], []
            if spec.get("variants"):
                name, price, _ = rng.choice(spec["variants"])
                variations.append({"property_id": 100, "value_id": 1, "formatted_name": "Size", "formatted_value": name})
            if spec["key"] == "dish":
                variations.append({"property_id": PERSONALIZATION_PROPERTY_ID, "value_id": None, "formatted_name": "Personalization", "formatted_value": rng.choice(["Emma", "Olivia", "Sofia", "Mia", "Lena"]), "question_id": 1})
            ship = int(round(spec["ship_cost"] * 100 * (1.0 if iso == "US" else 1.7))) if pos == 0 else int(round(spec["ship_cost"] * 100 * 0.4))
            tx_id += 1
            subtotal += price * qty
            ship_total += ship
            txs.append({
                "transaction_id": tx_id, "listing_id": raw["listing_id"], "title": spec["title"], "price": _money(price), "quantity": qty, "sku": spec["key"].upper(),
                "is_digital": False, "shipping_cost": _money(ship), "variations": variations, "paid_timestamp": _ts(created),
                "expected_ship_date": _ts(created + dt.timedelta(days=5)), "shipping_method": "Standard shipping", "shipping_upgrade": None, "buyer_user_id": 1000 + n,
            })
        grand = subtotal + ship_total
        shipped = not open_order
        ship_ts = _ts(created + dt.timedelta(days=2))
        if shipped:
            for t in txs:
                t["shipped_timestamp"] = ship_ts
        receipt = {
            "receipt_id": receipt_id, "status": "Completed" if shipped else "Paid", "name": buyer, "first_line": f"{n} Sample Street", "second_line": "", "city": "Sample City",
            "state": "", "zip": "00000", "country_iso": iso, "formatted_address": f"{buyer}\n{n} Sample Street\nSample City 00000\n{country}", "buyer_user_id": 1000 + n,
            "is_paid": True, "is_shipped": shipped, "is_gift": rng.random() < 0.12, "gift_message": None, "message_from_buyer": "Please pack it carefully, it is a gift!" if rng.random() < 0.12 else None,
            "created_timestamp": _ts(created), "grandtotal": _money(grand), "subtotal": _money(subtotal), "total_price": _money(subtotal), "total_shipping_cost": _money(ship_total),
            "total_tax_cost": _money(0), "discount_amt": _money(0), "transactions": txs, "refunds": [],
            "shipments": ([{"carrier_name": "USPS" if iso == "US" else "DHL", "tracking_code": f"DEMO{n:05d}", "shipment_notification_timestamp": ship_ts}] if shipped else []),
        }
        if receipt["is_gift"]:
            receipt["gift_message"] = "Happy birthday!"
            receipt["gift_sender"] = buyer
        receipts.append(receipt)
        row = OrderCache(
            shop_id=shop.id, receipt_id=receipt_id, status=receipt["status"], buyer_name=buyer, grandtotal_amount=grand, grandtotal_divisor=100, currency_code=CURRENCY,
            is_paid=True, is_shipped=shipped, created_at=created, expected_ship_date=created + dt.timedelta(days=5), raw_json=json.dumps(receipt, ensure_ascii=False), synced_at=now,
            delivered_at=(created + dt.timedelta(days=7)) if shipped and age_days > 12 else None,
        )
        for k, v in derive(receipt).items():
            setattr(row, k, v)
        db.add(row)

        # --- finans: ödeme + Etsy ücretleri (sent, ledger para birimi = mağaza para birimi)
        payment_id += 1
        db.add(FinPayment(shop_id=shop.id, payment_id=payment_id, receipt_id=receipt_id, gross_minor=grand, fees_minor=0, currency=CURRENCY))
        base_ts = _ts(created) + 3600
        lines = [("PAYMENT_GROSS", grand), ("TRANSACTION", -round(0.065 * (subtotal + ship_total))), ("PAYMENT_PROCESSING_FEE", -round(0.03 * grand + 25))]
        if rng.random() < 0.12:
            lines.append(("OFFSITE_ADS_FEE", -round(0.15 * subtotal)))
        for ledger_type, amount in lines:
            entry_id += 1
            db.add(LedgerEntry(shop_id=shop.id, entry_id=entry_id, created_ts=base_ts, amount=amount, currency=CURRENCY, ledger_type=ledger_type,
                               reference_type="shop_payment" if ledger_type == "PAYMENT_GROSS" else "transaction", reference_id=str(payment_id), receipt_id=receipt_id))

    # Siparişe bağlı olmayan giderler: aylık ilan ücreti ve yenileme
    for month in range(4):
        entry_id += 1
        db.add(LedgerEntry(shop_id=shop.id, entry_id=entry_id, created_ts=_ts(now - dt.timedelta(days=month * 30 + 3)), amount=-20 * 14, currency=CURRENCY,
                           ledger_type="LISTING", reference_type="listing", reference_id="0", receipt_id=None))

    # --- yorumlar (5 puan ağırlıklı)
    reviews = ["Beautiful and well packed, exactly as pictured.", "Lovely quality. The glaze is gorgeous!", "Fast shipping and a perfect gift.", "Slightly smaller than I expected but very nice.", "Love it, will order again."]
    for n in range(8):
        rc_id = -(shop.id * 100 + n + 1)
        db.add(ReviewCache(
            transaction_id=rc_id, shop_id=shop.id, listing_id=raws[n % len(raws)]["listing_id"], buyer_user_id=None, rating=5 if n != 3 else 4, review=reviews[n % len(reviews)],
            language="en", image_url=None, created_at=now - dt.timedelta(days=3 + n * 6), synced_at=now,
        ))

    for kind, value in _reference_data(shop).items():
        db.add(ShippingReferenceCache(shop_id=shop.id, kind=kind, data_json=json.dumps(value, ensure_ascii=False), updated_at=now))

    shop.listings_synced_at = now
    shop.currency = CURRENCY
    db.commit()
    return {"listings": len(raws), "orders": len(receipts), "open_orders": N_OPEN}

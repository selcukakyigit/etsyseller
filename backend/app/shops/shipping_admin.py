"""Mağaza düzeyinde kargo / işlem / iade yönetimi (Etsy Shop Manager > Shipping settings).

Bunlar mağazadaki TÜM listing'leri etkiler; hepsi Etsy'de `shops_w` yetkisi ister. Yazma istekleri
application/x-www-form-urlencoded gönderilir (Etsy'nin bu uçları JSON değil form bekler).
"""

import json
import logging
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import ttl_cache
from app.etsy.client import EtsyApiError, EtsyClient
from app.listings.models import ListingCache
from app.shops.models import Shop

log = logging.getLogger("app.shipping")

RETURN_DEADLINES = (7, 14, 21, 30, 45, 60, 90)


# ------------------------------------------------------------------ modeller ----

class ProcessingProfileIn(BaseModel):
    readiness_state: Literal["ready_to_ship", "made_to_order"]
    min_processing_time: int = Field(ge=1, le=60)
    max_processing_time: int = Field(ge=1, le=60)
    processing_time_unit: Literal["days", "weeks"] = "days"

    @model_validator(mode="after")
    def _order(self):
        if self.max_processing_time < self.min_processing_time:
            raise ValueError("En fazla süre, en az süreden küçük olamaz.")
        return self


class ReturnPolicyIn(BaseModel):
    accepts_returns: bool
    accepts_exchanges: bool
    return_deadline: int | None = None

    @model_validator(mode="after")
    def _deadline(self):
        if (self.accepts_returns or self.accepts_exchanges) and self.return_deadline not in RETURN_DEADLINES:
            raise ValueError(f"İade süresi şunlardan biri olmalı: {', '.join(map(str, RETURN_DEADLINES))}")
        return self


class DestinationIn(BaseModel):
    id: int | None = None  # mevcut hedef; yoksa yeni eklenir
    destination_country_iso: str | None = None
    destination_region: Literal["eu", "non_eu"] | None = None  # ikisi de boşsa "Diğer tüm ülkeler"
    primary_cost: float = Field(ge=0)
    secondary_cost: float = Field(ge=0)
    # Bazı mevcut hedeflerde teslimat süresi kargo servisinden hesaplanır (gün yok); bunlara dokunulmaz.
    min_delivery_days: int | None = Field(default=None, ge=1, le=90)
    max_delivery_days: int | None = Field(default=None, ge=1, le=90)

    @model_validator(mode="after")
    def _check(self):
        if self.destination_country_iso and self.destination_region:
            raise ValueError("Bir hedef ya ülke ya da bölge olabilir, ikisi birden olamaz.")
        if (self.min_delivery_days is None) != (self.max_delivery_days is None):
            raise ValueError("Teslimat günü için hem en az hem en fazla değer gerekir.")
        if self.min_delivery_days is not None and self.max_delivery_days < self.min_delivery_days:
            raise ValueError("En fazla teslimat günü, en azdan küçük olamaz.")
        return self

    def require_days(self) -> None:
        if self.min_delivery_days is None:
            raise ValueError("Yeni hedef için teslimat günleri (en az / en fazla) gerekli.")


class ShippingProfileIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    origin_country_iso: str = Field(min_length=2, max_length=2)
    origin_postal_code: str | None = None
    destinations: list[DestinationIn] = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def _unique(self):
        keys = [(d.destination_country_iso or "", d.destination_region or "") for d in self.destinations]
        if len(set(keys)) != len(keys):
            raise ValueError("Aynı hedef birden fazla kez eklenmiş.")
        return self


# ------------------------------------------------------------------ yardımcılar ----

def _client(db: Session, shop: Shop) -> tuple[EtsyClient, str]:
    return EtsyClient(db, shop), f"/shops/{shop.etsy_shop_id}"


def _done(shop: Shop) -> None:
    ttl_cache.clear((shop.id,))  # kargo/iade/işlem listeleri bir sonraki okumada tazelensin


def listing_counts(db: Session, shop: Shop, key: str) -> dict[int, int]:
    """Yerel önbellekteki listing'lerden, verilen alanı (ör. shipping_profile_id) kullanan listing sayıları."""
    counts: dict[int, int] = {}
    for raw in db.scalars(select(ListingCache.raw_json).where(ListingCache.shop_id == shop.id)):
        value = json.loads(raw).get(key)
        if value:
            counts[value] = counts.get(value, 0) + 1
    return counts


def _loc(d: DestinationIn) -> dict:
    if d.destination_country_iso:
        return {"destination_country_iso": d.destination_country_iso.upper()}
    if d.destination_region:
        return {"destination_region": d.destination_region}
    return {}  # her ikisi de yok = "Diğer tüm ülkeler" (Etsy: everywhere)


def _dest_body(d: DestinationIn, with_location: bool) -> dict:
    body: dict = {"primary_cost": d.primary_cost, "secondary_cost": d.secondary_cost}
    if d.min_delivery_days is not None:
        body["min_delivery_days"] = d.min_delivery_days
        body["max_delivery_days"] = d.max_delivery_days
    if with_location:
        body.update(_loc(d))
    return body


def _same_cost(a: dict | None, b: float) -> bool:
    return a is not None and abs(a["amount"] / a["divisor"] - b) < 0.005


# ------------------------------------------------------------------ işlem profili ----

def create_processing_profile(db: Session, shop: Shop, p: ProcessingProfileIn) -> dict:
    client, base = _client(db, shop)
    res = client.request("POST", f"{base}/readiness-state-definitions", data=p.model_dump())
    log.info("İşlem profili oluşturuldu: %s", res.get("readiness_state_id") if isinstance(res, dict) else res)
    _done(shop)
    return res


def update_processing_profile(db: Session, shop: Shop, profile_id: int, p: ProcessingProfileIn) -> dict:
    client, base = _client(db, shop)
    res = client.request("PUT", f"{base}/readiness-state-definitions/{profile_id}", data=p.model_dump())
    _done(shop)
    return res


def delete_processing_profile(db: Session, shop: Shop, profile_id: int) -> None:
    if listing_counts(db, shop, "readiness_state_id").get(profile_id):
        raise EtsyApiError(400, "Bu işlem profili listing'lerde kullanılıyor; önce o listing'leri başka profile taşı.")
    client, base = _client(db, shop)
    client.request("DELETE", f"{base}/readiness-state-definitions/{profile_id}")
    _done(shop)


# ------------------------------------------------------------------ iade politikası ----

def create_return_policy(db: Session, shop: Shop, p: ReturnPolicyIn) -> dict:
    client, base = _client(db, shop)
    res = client.request("POST", f"{base}/policies/return", data=_return_body(p))
    _done(shop)
    return res


def update_return_policy(db: Session, shop: Shop, policy_id: int, p: ReturnPolicyIn) -> dict:
    client, base = _client(db, shop)
    res = client.request("PUT", f"{base}/policies/return/{policy_id}", data=_return_body(p))
    _done(shop)
    return res


def delete_return_policy(db: Session, shop: Shop, policy_id: int) -> None:
    if listing_counts(db, shop, "return_policy_id").get(policy_id):
        raise EtsyApiError(400, "Bu iade politikası listing'lerde kullanılıyor; önce o listing'leri başka politikaya taşı.")
    client, base = _client(db, shop)
    client.request("DELETE", f"{base}/policies/return/{policy_id}")
    _done(shop)


def _return_body(p: ReturnPolicyIn) -> dict:
    body: dict = {"accepts_returns": p.accepts_returns, "accepts_exchanges": p.accepts_exchanges}
    if p.return_deadline:
        body["return_deadline"] = p.return_deadline
    return body


# ------------------------------------------------------------------ kargo profili ----

def create_shipping_profile(db: Session, shop: Shop, p: ShippingProfileIn) -> dict:
    """Profil ilk hedefle oluşturulur, kalan hedefler tek tek eklenir. Yarıda hata olursa yeni (henüz
    kullanılmayan) profil geri silinir; böylece yarım profil kalmaz."""
    for d in p.destinations:
        d.require_days()
    client, base = _client(db, shop)
    # "Diğer tüm ülkeler" hedefi konumsuzdur; profil oluştururken konumlu bir hedefle başlamak daha güvenli.
    ordered = sorted(p.destinations, key=lambda d: 0 if _loc(d) else 1)
    first, rest = ordered[0], ordered[1:]
    body = {
        "title": p.title.strip(),
        "origin_country_iso": p.origin_country_iso.upper(),
        **_dest_body(first, with_location=True),
    }
    if p.origin_postal_code:
        body["origin_postal_code"] = p.origin_postal_code.strip()
    created = client.request("POST", f"{base}/shipping-profiles", data=body)
    pid = created["shipping_profile_id"]
    try:
        for d in rest:
            client.request("POST", f"{base}/shipping-profiles/{pid}/destinations", data=_dest_body(d, with_location=True))
    except Exception:
        log.warning("Profil %s tamamlanamadı, geri siliniyor", pid)
        try:
            client.request("DELETE", f"{base}/shipping-profiles/{pid}")
        except Exception:  # noqa: BLE001
            log.exception("Yarım kalan profil %s silinemedi", pid)
        raise
    _done(shop)
    log.info("Kargo profili oluşturuldu: %s (%s hedef)", pid, len(p.destinations))
    return client.request("GET", f"{base}/shipping-profiles/{pid}")


def update_shipping_profile(db: Session, shop: Shop, profile_id: int, p: ShippingProfileIn) -> dict:
    """Yalnızca değişenleri gönderir. Sıra: yeni hedefler → güncellemeler → silinenler (hiçbir an 0 hedef kalmaz)."""
    client, base = _client(db, shop)
    live = client.request("GET", f"{base}/shipping-profiles/{profile_id}")
    live_dests = {d["shipping_profile_destination_id"]: d for d in live.get("shipping_profile_destinations", [])}

    head: dict = {}
    if p.title.strip() != live.get("title"):
        head["title"] = p.title.strip()
    if p.origin_country_iso.upper() != live.get("origin_country_iso"):
        head["origin_country_iso"] = p.origin_country_iso.upper()
    if (p.origin_postal_code or "") != (live.get("origin_postal_code") or ""):
        head["origin_postal_code"] = (p.origin_postal_code or "").strip()

    wanted_ids = {d.id for d in p.destinations if d.id}
    unknown = wanted_ids - set(live_dests)
    if unknown:
        raise EtsyApiError(409, "Profil Etsy'de bu arada değişmiş; sayfayı yenileyip tekrar dene.")

    for d in p.destinations:
        if d.id is None:
            d.require_days()
            client.request("POST", f"{base}/shipping-profiles/{profile_id}/destinations", data=_dest_body(d, with_location=True))
    if head:
        client.request("PUT", f"{base}/shipping-profiles/{profile_id}", data=head)
    for d in p.destinations:
        if d.id is None:
            continue
        cur = live_dests[d.id]
        unchanged = (
            _same_cost(cur.get("primary_cost"), d.primary_cost)
            and _same_cost(cur.get("secondary_cost"), d.secondary_cost)
            and (d.min_delivery_days is None or cur.get("min_delivery_days") == d.min_delivery_days)
            and (d.max_delivery_days is None or cur.get("max_delivery_days") == d.max_delivery_days)
        )
        if not unchanged:
            # Mevcut hedefin konumu düzenlenmez (yalnızca ücret ve teslimat günleri).
            client.request(
                "PUT", f"{base}/shipping-profiles/{profile_id}/destinations/{d.id}", data=_dest_body(d, with_location=False)
            )
    for did in set(live_dests) - wanted_ids:
        client.request("DELETE", f"{base}/shipping-profiles/{profile_id}/destinations/{did}")
    _done(shop)
    log.info("Kargo profili güncellendi: %s", profile_id)
    return client.request("GET", f"{base}/shipping-profiles/{profile_id}")


def delete_shipping_profile(db: Session, shop: Shop, profile_id: int) -> None:
    n = listing_counts(db, shop, "shipping_profile_id").get(profile_id, 0)
    if n:
        raise EtsyApiError(400, f"Bu kargo profili {n} listing'de kullanılıyor; önce onları başka profile taşı.")
    client, base = _client(db, shop)
    client.request("DELETE", f"{base}/shipping-profiles/{profile_id}")
    _done(shop)
    log.info("Kargo profili silindi: %s", profile_id)

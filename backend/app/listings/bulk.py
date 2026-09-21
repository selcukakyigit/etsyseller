"""Toplu işlemler (Etsy Shop Manager'daki "Editing options / Activate / Deactivate / Renew").

Yerel-önce: değişiklikler Etsy'ye GİTMEZ; her listing'in yerel sürümüne (ListingLocal) yazılır ve listede
"Yayınlanmamış" görünür. Etsy'ye mevcut "Etsy'de yayınla" akışıyla (üç yönlü karşılaştırmalı) gider.
Silme tek istisnadır: geri alınamaz, doğrudan Etsy'ye gider.
"""

import copy
import json
import math
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.etsy.client import EtsyClient
from app.listings import drafts, service
from app.listings.models import DraftFile, ListingCache, ListingDraft, ListingLocal
from app.shops.models import Shop

TITLE_MAX = 140
TAG_MAX_LEN = 20
TAGS_MAX = 13
MIN_PRICE = 0.20


# ------------------------------------------------------------------ modeller ----

class TextOp(BaseModel):
    mode: Literal["prefix", "suffix", "find_replace", "set"]
    text: str = ""
    find: str = ""
    replace: str = ""

    @model_validator(mode="after")
    def _check(self):
        if self.mode == "find_replace" and not self.find:
            raise ValueError("Bulunacak metin boş olamaz.")
        if self.mode in ("prefix", "suffix", "set") and not self.text:
            raise ValueError("Metin boş olamaz.")
        return self


class TagsOp(BaseModel):
    add: list[str] = []
    remove: list[str] = []

    @field_validator("add")
    @classmethod
    def _tags(cls, tags: list[str]):
        clean = [t.strip() for t in tags if t.strip()]
        for t in clean:
            if len(t) > TAG_MAX_LEN:
                raise ValueError(f'"{t}" etiketi {TAG_MAX_LEN} karakteri aşıyor.')
        return clean


class PriceOp(BaseModel):
    mode: Literal["percent", "amount", "set"]
    value: float
    rounding: Literal["none", "x.99", "x.00"] = "none"

    @model_validator(mode="after")
    def _check(self):
        if self.mode == "set" and self.value < MIN_PRICE:
            raise ValueError(f"Fiyat en az {MIN_PRICE} olmalı.")
        if self.mode == "percent" and self.value <= -100:
            raise ValueError("Yüzde -100'ün altına inemez.")
        return self


class BulkChanges(BaseModel):
    state: Literal["active", "inactive"] | None = None
    title: TextOp | None = None
    description: TextOp | None = None
    tags: TagsOp | None = None
    price: PriceOp | None = None
    shop_section_id: int | None = None
    shipping_profile_id: int | None = None
    return_policy_id: int | None = None
    readiness_state_id: int | None = None
    should_auto_renew: bool | None = None
    production_partner_ids: list[int] | None = None

    @model_validator(mode="after")
    def _any(self):
        if not self.model_dump(exclude_none=True):
            raise ValueError("Hiçbir değişiklik seçilmedi.")
        return self


class BulkStageIn(BaseModel):
    listing_ids: list[int] = Field(min_length=1, max_length=500)
    changes: BulkChanges


# ------------------------------------------------------------------ yardımcılar ----

def snapshot_cached(row: ListingCache) -> dict:
    """Etsy hâlinin çalışma kopyası biçiminde özeti — YALNIZCA yerel önbellekten (Etsy'ye istek atmaz).
    Önbellekte henüz olmayan alanlar (kişiselleştirme, varyasyon fotoğrafları) None bırakılır; yayın bunlara dokunmaz."""
    edit = service._listing_edit_out(row).model_dump()
    personalization = None
    links = None
    if row.extras_synced:
        personalization = {"questions": [service._clean_question(q).model_dump() for q in json.loads(row.personalization_json or "[]")]}
        vimg = service._unescape(json.loads(row.variation_images_json or "[]"))
        links = {
            "property_id": vimg[0]["property_id"] if vimg else None,
            "images": {v["value"]: v["image_id"] for v in vimg if v.get("value")},
        }
    return {**edit, "personalization": personalization, "managed_property_ids": [], "variation_links": links}


def _text(value: str, op: TextOp) -> str:
    if op.mode == "prefix":
        return op.text + value
    if op.mode == "suffix":
        return value + op.text
    if op.mode == "find_replace":
        return value.replace(op.find, op.replace)
    return op.text


def _round(v: float, rounding: str) -> float:
    if rounding == "x.99":
        return math.ceil(v) - 0.01
    if rounding == "x.00":
        return float(round(v))
    return round(v, 2)


def _apply_price(inventory: dict, op: PriceOp) -> str | None:
    """Tüm tekliflere aynı dönüşüm uygulanır; böylece fiyat *_on_property gruplarında tutarlı kalır."""
    for product in inventory.get("products", []):
        for off in product.get("offerings", []):
            price = off.get("price")
            if isinstance(price, dict):
                cur = price["amount"] / price["divisor"]
            elif isinstance(price, (int, float)):
                cur = float(price)
            else:
                continue
            new = op.value if op.mode == "set" else cur * (1 + op.value / 100) if op.mode == "percent" else cur + op.value
            new = _round(new, op.rounding)
            if new < MIN_PRICE:
                return f"Fiyat {MIN_PRICE} altına düşer ({cur:.2f} → {new:.2f})."
            if isinstance(price, dict):
                price["amount"] = int(round(new * price["divisor"]))
            else:
                off["price"] = new
    return None


def apply_changes(work: dict, c: BulkChanges) -> str | None:
    """Çalışma kopyasına değişiklikleri uygular; geçersizse hata metni döner (o listing atlanır)."""
    if c.title:
        work["title"] = _text(work["title"], c.title)
        if not work["title"].strip():
            return "Başlık boş kalır."
        if len(work["title"]) > TITLE_MAX:
            return f"Başlık {TITLE_MAX} karakteri aşar ({len(work['title'])})."
    if c.description:
        work["description"] = _text(work["description"], c.description)
    if c.tags:
        tags = list(work["tags"])
        drop = {t.strip().lower() for t in c.tags.remove}
        tags = [t for t in tags if t.lower() not in drop]
        have = {t.lower() for t in tags}
        for t in c.tags.add:
            if t.lower() not in have:
                tags.append(t)
                have.add(t.lower())
        if len(tags) > TAGS_MAX:
            return f"{TAGS_MAX} etiket sınırı aşılır ({len(tags)})."
        work["tags"] = tags
    if c.price:
        err = _apply_price(work["inventory"], c.price)
        if err:
            return err
    for key in ("shop_section_id", "shipping_profile_id", "return_policy_id", "should_auto_renew", "production_partner_ids", "state"):
        v = getattr(c, key)
        if v is not None:
            work[key] = v
    if c.readiness_state_id is not None:
        for product in work["inventory"].get("products", []):
            for off in product.get("offerings", []):
                off["readiness_state_id"] = c.readiness_state_id
    return None


def _sig(work: dict) -> str:
    return json.dumps(work, sort_keys=True, ensure_ascii=False)


# ------------------------------------------------------------------ işlemler ----

def bulk_stage(db: Session, shop: Shop, payload: BulkStageIn) -> list[dict]:
    """Seçili listing'lerin yerel sürümlerine değişiklikleri işler. Her listing için {id, ok, changed, error}."""
    rows = {
        r.listing_id: r
        for r in db.scalars(
            select(ListingCache).where(ListingCache.shop_id == shop.id).where(ListingCache.listing_id.in_(payload.listing_ids))
        ).all()
    }
    results: list[dict] = []
    for lid in payload.listing_ids:
        row = rows.get(lid)
        if lid < 0:
            results.append({"id": lid, "ok": False, "changed": False, "error": "Yeni (henüz yayınlanmamış) listing toplu işlemlere dahil değil; düzenleme sayfasından yönet."})
            continue
        if row is None:
            results.append({"id": lid, "ok": False, "changed": False, "error": "Listing yerelde yok (senkronize et)."})
            continue
        live = snapshot_cached(row)
        local = drafts._local_row(db, shop, lid)
        work = json.loads(local.data_json) if local else copy.deepcopy(live)
        err = apply_changes(work, payload.changes)
        if err:
            results.append({"id": lid, "ok": False, "changed": False, "error": err})
            continue
        if _sig(work) == _sig(live):
            drafts.discard_local(db, shop, lid)  # Etsy ile aynı: yerel sürüme gerek yok
            results.append({"id": lid, "ok": True, "changed": False, "error": None})
            continue
        drafts.save_local(db, shop, lid, work, live)
        results.append({"id": lid, "ok": True, "changed": True, "error": None})
    return results


def delete_listing(db: Session, shop: Shop, listing_id: int) -> None:
    """Etsy'den kalıcı siler (geri alınamaz; `listings_d` yetkisi gerekir) ve yerel kayıtları temizler.
    Henüz Etsy'de olmayan yeni (negatif kimlikli) listing için yalnızca yerel kayıt iptal edilir."""
    if listing_id < 0:
        drafts.discard_local(db, shop, listing_id)
        return
    EtsyClient(db, shop).request("DELETE", f"/listings/{listing_id}")
    for model in (ListingLocal, ListingDraft, DraftFile, ListingCache):
        for r in db.scalars(select(model).where(model.shop_id == shop.id).where(model.listing_id == listing_id)).all():
            db.delete(r)
    db.commit()

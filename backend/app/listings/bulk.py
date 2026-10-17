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
from app.listings import drafts, fields, inventory_edit, service, templates
from app.core import blobstore
from app.listings.models import DraftFile, ListingCache, ListingDraft, ListingLocal
from app.listings.selection import ListingFilter, select_rows
from app.shops.models import Shop
from app.taxonomy import service as taxonomy_service

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


class AttributeItem(BaseModel):
    name: str
    values: list[str]


class BulkChanges(BaseModel):
    state: Literal["active", "inactive"] | None = None
    quantity: int | None = Field(default=None, ge=1, le=inventory_edit.MAX_QUANTITY)  # tüm kombinasyonların stoğu
    attributes: list[AttributeItem] | None = None  # kategori özellikleri (Holiday=Christmas…): her listing kendi kategorisine göre doğrulanır
    add_personalization: list[dict] | None = None  # kişiselleştirme (özel seçenek) soruları EKLER, var olanlara dokunmaz
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
    description_template_id: int | None = None  # hazır açıklama metnini uygula (bkz. listings/templates.py)

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


def template_applier(db: Session, shop: Shop, c: BulkChanges):
    """Değişiklikte şablon varsa onu uygulayan fonksiyon (yoksa None). Şablon yoksa TemplateError."""
    if c.description_template_id is None:
        return None
    return templates.applier(db, shop, templates.get(db, shop, c.description_template_id))


def _apply_attributes(work: dict, items: list[AttributeItem], defs_for) -> str | None:
    """Kategori özelliklerini listing'in KENDİ kategorisinin tanımına göre yazar; özellik yoksa / değer izin verilmiyorsa hata (listing atlanır)."""
    tid = work.get("taxonomy_id")
    if not tid:
        return "Listing'in kategorisi yok."
    usable = [{"name": i.name, "values": i.values} for i in items if not inventory_edit.covered_by_variation(work, i.name)]
    if not usable:
        return "Renk/boyut zaten varyasyonda."
    try:
        defs = defs_for(int(tid))
    except Exception:  # noqa: BLE001 - Etsy kategori özelliklerini vermezse listing atlanır
        return "Kategori özellikleri alınamadı."
    before = json.dumps(work.get("properties"), sort_keys=True)
    changed, errors = fields.apply_attributes(work, defs, usable)
    if json.dumps(work.get("properties"), sort_keys=True) == before:
        return "Özellik bu kategoride yok ya da değer izin verilenlerde değil." if errors else "Zaten aynı."
    return None


def apply_changes(work: dict, c: BulkChanges, apply_template=None, defs_for=None) -> str | None:
    """Çalışma kopyasına değişiklikleri uygular; geçersizse hata metni döner (o listing atlanır).
    `apply_template`: bkz. template_applier; şablon, açıklama değişikliğinden sonra uygulanır. `defs_for`: kategori kimliğinden özellik tanımları."""
    if c.title:
        work["title"] = _text(work["title"], c.title)
        if not work["title"].strip():
            return "Başlık boş kalır."
        if len(work["title"]) > TITLE_MAX:
            return f"Başlık {TITLE_MAX} karakteri aşar ({len(work['title'])})."
    if c.description:
        work["description"] = _text(work["description"], c.description)
    if apply_template is not None:
        work["description"] = apply_template(work)
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
    if c.quantity is not None:
        for product in work["inventory"].get("products", []):
            for off in product.get("offerings", []):
                off["quantity"] = c.quantity
        inventory_edit.recompute_dependencies(work)  # stok/SKU "hangi varyasyona göre değişir" işaretleri verilerden yeniden kurulur
    if c.attributes:
        err = _apply_attributes(work, c.attributes, defs_for or taxonomy_service.cached_properties)
        if err:
            return err
    if c.add_personalization:
        if work.get("personalization") is None:
            return "Kişiselleştirme bilgisi henüz senkronize edilmedi (listing'i bir kez aç)."
        before = json.dumps(work["personalization"], sort_keys=True)
        _changed, errors = fields.apply_fields(work, {"add_personalization_questions": c.add_personalization})
        if errors:
            return " ".join(errors)
        if json.dumps(work["personalization"], sort_keys=True) == before:
            return "Bu sorular zaten var."
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

def _brief(work: dict) -> dict:
    """Önce/sonra özeti (sonuç kartı için): başlık, en düşük–en yüksek fiyat ve stok, etiket sayısı."""
    offers = [o for p in (work.get("inventory") or {}).get("products", []) for o in p.get("offerings", [])]
    prices = [o["price"]["amount"] / o["price"]["divisor"] for o in offers if isinstance(o.get("price"), dict) and o["price"].get("divisor")]
    stock = [o.get("quantity") or 0 for o in offers]
    return {
        "title": (work.get("title") or "")[:140], "price": [round(min(prices), 2), round(max(prices), 2)] if prices else None,
        "quantity": [min(stock), max(stock)] if stock else None, "tags": len(work.get("tags") or []),
    }


def _stage_one(db: Session, shop: Shop, lid: int, row: ListingCache | None, changes: BulkChanges, apply_template) -> dict:
    """Tek listing'in yerel sürümüne değişiklikleri işler (tek yer: toplu seçim ve filtreli seçim aynı mantığı kullanır)."""
    return stage_edit(db, shop, lid, row, lambda work: apply_changes(work, changes, apply_template))


def stage_edit(db: Session, shop: Shop, lid: int, row: ListingCache | None, edit) -> dict:
    """`edit(work) -> hata metni | None` çalışma kopyasını değiştirir; sonuç yerel taslak olur (Etsy'ye gitmez). Yapay zekâ yeniden yazımı da bunu kullanır."""
    if lid < 0:
        return {"id": lid, "ok": False, "changed": False, "error": "Yeni (henüz yayınlanmamış) listing toplu işlemlere dahil değil; düzenleme sayfasından yönet."}
    if row is None:
        return {"id": lid, "ok": False, "changed": False, "error": "Listing yerelde yok (senkronize et)."}
    live = snapshot_cached(row)
    local = drafts._local_row(db, shop, lid)
    work = json.loads(local.data_json) if local else copy.deepcopy(live)
    before = _brief(work)
    err = edit(work)
    if err:
        return {"id": lid, "ok": False, "changed": False, "error": err, "title": before["title"]}
    if _sig(work) == _sig(live):
        drafts.discard_local(db, shop, lid)  # Etsy ile aynı: yerel sürüme gerek yok
        return {"id": lid, "ok": True, "changed": False, "error": None, "title": before["title"]}
    drafts.save_local(db, shop, lid, work, live)
    return {"id": lid, "ok": True, "changed": True, "error": None, "title": before["title"], "before": before, "after": _brief(work)}


def bulk_stage(db: Session, shop: Shop, payload: BulkStageIn) -> list[dict]:
    """Seçili listing'lerin yerel sürümlerine değişiklikleri işler. Her listing için {id, ok, changed, error, title, before, after}."""
    rows = {
        r.listing_id: r
        for r in db.scalars(
            select(ListingCache).where(ListingCache.shop_id == shop.id).where(ListingCache.listing_id.in_(payload.listing_ids))
        ).all()
    }
    apply_template = template_applier(db, shop, payload.changes)
    return [_stage_one(db, shop, lid, rows.get(lid), payload.changes, apply_template) for lid in payload.listing_ids]


def stage_filtered(db: Session, shop: Shop, flt: ListingFilter, changes: BulkChanges) -> list[dict]:
    """Filtreye uyan listing'lere (bkz. selection.ListingFilter) değişiklikleri yerel taslak olarak işler."""
    rows = select_rows(db, shop, flt)
    apply_template = template_applier(db, shop, changes)
    return [_stage_one(db, shop, r.listing_id, r, changes, apply_template) for r in rows]


def delete_listing(db: Session, shop: Shop, listing_id: int) -> None:
    """Etsy'den kalıcı siler (geri alınamaz; `listings_d` yetkisi gerekir) ve yerel kayıtları temizler.
    Henüz Etsy'de olmayan yeni (negatif kimlikli) listing için yalnızca yerel kayıt iptal edilir."""
    if listing_id < 0:
        drafts.discard_local(db, shop, listing_id)
        return
    EtsyClient(db, shop).request("DELETE", f"/listings/{listing_id}")
    paths = list(db.scalars(select(DraftFile.path).where(DraftFile.shop_id == shop.id).where(DraftFile.listing_id == listing_id)))
    for model in (ListingLocal, ListingDraft, DraftFile, ListingCache):
        for r in db.scalars(select(model).where(model.shop_id == shop.id).where(model.listing_id == listing_id)).all():
            db.delete(r)
    db.commit()
    blobstore.remove(paths)

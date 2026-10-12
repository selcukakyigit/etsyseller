"""Her modülün miras aldığı ortak uç noktalar. Bir modül yalnızca kendine özgü olanı yazar:

    router = build_entity_router(module="supply", prefix="/api/supply", item_in_use=...)

ile şunlar hazır gelir: kayıt listesi/oluşturma/ayarlar/arşiv/silme, fiyat listesi (sürümlü), belge listesi/indirme/silme,
alan eşlemeleri, paylaşım (davet, erişim), kayıt akışı. Davet bağlantısının kendisi modülden bağımsızdır (`invite_router`).
"""
import datetime as dt
from typing import Callable, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core import blobstore
from app.core.db import get_db
from app.core.deps import get_current_user
from app.modkit import access as acc
from app.drawings import cad
from app.modkit import activity, currencies, documents, entities, parties, pricebook, products, ratelimit, sharing
from app.modkit.models import FieldMapping, PriceItem


class EntityIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    label: str = Field("", max_length=60)
    currency: str = Field("TRY", min_length=3, max_length=3)
    vat_rate: float = Field(0, ge=0, le=100)
    vat_in_cost: bool = False
    contact_email: str = Field("", max_length=255)
    note: str = Field("", max_length=5000)


class EntityPatch(BaseModel):
    name: str | None = Field(None, max_length=120)
    label: str | None = Field(None, max_length=60)
    currency: str | None = Field(None, min_length=3, max_length=3)
    vat_rate: float | None = Field(None, ge=0, le=100)
    vat_in_cost: bool | None = None
    contact_email: str | None = Field(None, max_length=255)
    note: str | None = Field(None, max_length=5000)


class DeleteIn(BaseModel):
    confirm_name: str = Field(max_length=120)


class ArchiveIn(BaseModel):
    archived: bool


class PartyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class PartyPatch(BaseModel):
    name: str | None = Field(None, max_length=80)
    archived: bool | None = None


class PriceItemIn(BaseModel):
    kind: str = Field(max_length=12)
    name: str = Field(min_length=1, max_length=120)
    unit: str = Field("job", max_length=10)
    spec: str = Field("", max_length=200)
    price: float = Field(ge=0)
    auto_qty: float | None = Field(None, gt=0, le=pricebook.MAX_AUTO_QTY)
    material: str | None = Field(None, max_length=20)
    thickness_mm: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    plate_width: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    plate_height: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    plate_kg: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    roll_width: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    film_um: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    roll_length: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)


class PriceItemPatch(BaseModel):
    name: str | None = Field(None, max_length=120)
    spec: str | None = Field(None, max_length=200)
    auto_qty: float | None = Field(None, gt=0, le=pricebook.MAX_AUTO_QTY)  # null gönderilirse kural kaldırılır
    unit: str | None = Field(None, max_length=10)  # yalnızca işlerde kullanılmamış kalemde değişir
    material: str | None = Field(None, max_length=20)
    thickness_mm: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    plate_width: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    plate_height: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    plate_kg: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    roll_width: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    film_um: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    roll_length: float | None = Field(None, gt=0, le=pricebook.MAX_STOCK)
    # (malzeme alanlarında da null gönderilirse alan boşaltılır)


class PriceIn(BaseModel):
    price: float = Field(ge=0)
    valid_from: dt.date | None = None


class MappingIn(BaseModel):
    profile: str = Field(max_length=40)
    field_key: str = Field(min_length=1, max_length=120)
    price_item_id: int | None = None  # None = eşlemeyi kaldır


class MeasuresIn(BaseModel):
    values: dict[str, float | None] = Field(max_length=12)  # değeri null olan ölçü silinir
    material: str | None = Field(None, max_length=20)  # malzeme türü; null = kaldır, gönderilmezse dokunulmaz
    source: Literal["manual", "cad"] = "manual"  # plaka çiziminden atanan gruplar "cad" gönderir


class InviteIn(BaseModel):
    email: str = Field(max_length=255)
    permissions: list[str] = Field(default_factory=lambda: list(acc.GUEST_PERMS), max_length=10)


class GrantPatch(BaseModel):
    permissions: list[str] = Field(max_length=10)


def build_entity_router(module: str, prefix: str, tag: str, item_in_use: Callable[[Session, int], bool],
                        summary: Callable[[Session, acc.EntityAccess], dict] | None = None) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])
    entity_access = acc.entity_access(module)

    # ------------------------------------------------------------ kayıtlar ----

    @router.get("")
    def list_entities(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
        own, shared = acc.accessible(db, user, module)
        return {
            "own": [{**entities.serialize(e), "role": role} for e, role in own],
            "shared": [{"id": e.id, "name": e.name, "label": e.label, "currency": e.currency, "image": entities.image_version(e), "role": "guest"} for e in shared],
        }

    @router.post("")
    def create_entity(payload: EntityIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
        ratelimit.hit(f"{module}.create", f"user:{user.id}", 30, 3600)
        e = entities.create(db, user, module, payload.name, payload.label, payload.currency, payload.vat_rate,
                            payload.vat_in_cost, payload.contact_email, payload.note)
        return entities.serialize(e)

    @router.get("/{entity_id}")
    def get_entity(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        out = entities.serialize(a.entity, a)
        if summary is not None:
            out["summary"] = summary(db, a)
        return out

    @router.patch("/{entity_id}")
    def patch_entity(payload: EntityPatch, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return entities.serialize(entities.update(db, a, payload.model_dump()), a)

    @router.post("/{entity_id}/archive")
    def archive_entity(payload: ArchiveIn, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        entities.set_archived(db, a, payload.archived)
        return {"ok": True}

    @router.post("/{entity_id}/delete")
    def delete_entity(payload: DeleteIn, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        entities.delete(db, a, payload.confirm_name)
        return {"ok": True}

    # ------------------------------------------------------------ logo / profil resmi ----

    @router.get("/{entity_id}/image")
    def get_image(a: acc.EntityAccess = Depends(entity_access)):
        if not a.entity.image_path:
            raise HTTPException(404, "Görsel bulunamadı")
        try:
            data = blobstore.read(a.entity.image_path)
        except FileNotFoundError as exc:
            raise HTTPException(404, "Görsel bulunamadı") from exc
        # Adres sürüm ekiyle değiştiği için önbelleğe alınabilir; yalnızca bu tarayıcıda (private).
        return Response(content=data, media_type="image/webp", headers={"Cache-Control": "private, max-age=604800"})

    @router.post("/{entity_id}/image")
    def upload_image(file: UploadFile = File(...), a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        ratelimit.hit(f"{module}.image", f"user:{a.user.id}", 30, 3600)
        content = file.file.read(entities.IMAGE_MAX_BYTES + 1)
        return entities.serialize(entities.set_image(db, a, content), a)

    @router.delete("/{entity_id}/image")
    def delete_image(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return entities.serialize(entities.remove_image(db, a), a)

    @router.get("/{entity_id}/activity")
    def entity_activity(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return {"items": activity.recent(db, a, 50)}

    # ------------------------------------------------------------ fiyat listesi ----

    @router.get("/{entity_id}/prices")
    def list_prices(archived: bool = False, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return {"items": pricebook.list_items(db, a, include_archived=archived and a.internal)}

    @router.post("/{entity_id}/prices")
    def add_price_item(payload: PriceItemIn, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        ratelimit.hit("prices.write", f"user:{a.user.id}", 300, 3600)
        item = pricebook.create_item(db, a, payload.kind, payload.name, payload.unit, payload.spec, payload.price, payload.auto_qty,
                                    payload.model_dump(include=set(pricebook.STOCK_FIELDS), exclude_unset=True))
        _notify_guest_change(db, a, "price_item_added", item.name)
        return pricebook.serialize(item, pricebook.latest_prices(db, [item.id]).get(item.id), 1)

    @router.patch("/{entity_id}/prices/{item_id}")
    def patch_price_item(item_id: int, payload: PriceItemPatch, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        item = pricebook.get_item(db, a, item_id)
        pricebook.update_item(db, a, item, payload.name, payload.spec, payload.auto_qty if "auto_qty" in payload.model_fields_set else pricebook.UNSET,
                             payload.model_dump(include=set(pricebook.STOCK_FIELDS), exclude_unset=True),
                             payload.unit, bool(payload.unit and payload.unit != item.unit and item_in_use(db, item.id)))
        return {"ok": True}

    @router.post("/{entity_id}/prices/{item_id}/price")
    def change_price(item_id: int, payload: PriceIn, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        ratelimit.hit("prices.write", f"user:{a.user.id}", 300, 3600)
        item = pricebook.get_item(db, a, item_id)
        if pricebook.set_price(db, a, item, payload.price, payload.valid_from) is not None:
            _notify_guest_change(db, a, "price_changed", item.name)
        return {"ok": True}

    @router.get("/{entity_id}/prices/{item_id}/history")
    def price_history(item_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return {"items": pricebook.history(db, a, pricebook.get_item(db, a, item_id))}

    @router.post("/{entity_id}/prices/{item_id}/archive")
    def archive_price_item(item_id: int, payload: ArchiveIn, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        pricebook.set_archived(db, a, pricebook.get_item(db, a, item_id), payload.archived)
        return {"ok": True}

    @router.delete("/{entity_id}/prices/{item_id}")
    def delete_price_item(item_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        item = pricebook.get_item(db, a, item_id)
        pricebook.delete_item(db, a, item, item_in_use(db, item.id))
        return {"ok": True}

    # ------------------------------------------------------------ alan eşlemeleri ----

    @router.get("/{entity_id}/mappings")
    def list_mappings(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        rows = db.scalars(select(FieldMapping).where(FieldMapping.entity_id == a.entity.id)).all()
        return {"items": [{"profile": m.profile, "field_key": m.field_key, "price_item_id": m.price_item_id} for m in rows]}

    @router.put("/{entity_id}/mappings")
    def set_mapping(payload: MappingIn, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        if not (a.is_member or a.can("jobs.create")):
            raise HTTPException(403, "Bu işlem için yetkin yok")
        row = db.scalar(select(FieldMapping).where(
            FieldMapping.entity_id == a.entity.id, FieldMapping.profile == payload.profile, FieldMapping.field_key == payload.field_key
        ))
        if payload.price_item_id is None:
            if row is not None:
                db.delete(row)
                db.commit()
            return {"ok": True}
        item = db.get(PriceItem, payload.price_item_id)
        if item is None or item.entity_id != a.entity.id:
            raise HTTPException(404, "Kalem bulunamadı")
        if row is None:
            db.add(FieldMapping(entity_id=a.entity.id, profile=payload.profile, field_key=payload.field_key, price_item_id=item.id))
        else:
            row.price_item_id = item.id
        db.commit()
        return {"ok": True}

    # ------------------------------------------------------------ belgeler ----

    @router.get("/{entity_id}/documents")
    def list_documents(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        from app.modkit.models import EntityDocument

        rows = db.execute(
            select(EntityDocument, User.name, User.email).outerjoin(User, User.id == EntityDocument.uploaded_by)
            .where(EntityDocument.entity_id == a.entity.id).order_by(EntityDocument.created_at.desc()).limit(500)
        ).all()
        return {"items": [documents.serialize(d, name or email or "") for d, name, email in rows]}

    @router.get("/{entity_id}/documents/{doc_id}/file")
    def download_document(doc_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        doc = documents.get(db, a, doc_id)
        if not doc.path:
            raise HTTPException(404, "Dosya saklanmıyor; yalnızca okunan veriler kayıtlı.")
        try:
            data = blobstore.read(doc.path)
        except FileNotFoundError as exc:
            raise HTTPException(404, "Belge bulunamadı") from exc
        safe = (doc.filename.encode("ascii", "ignore").decode() or "document").replace('"', "")
        # Yalnızca PDF ve resim tarayıcıda açılır; HTML/metin gibi türler API alanında sayfa olarak çalışmasın diye indirilir.
        inline = doc.content_type == "application/pdf" or doc.content_type.startswith("image/")
        return Response(content=data, media_type=doc.content_type or "application/octet-stream", headers={
            "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{safe}"',
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        })

    @router.delete("/{entity_id}/documents/{doc_id}")
    def delete_document(doc_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        documents.remove(db, a, documents.get(db, a, doc_id))
        return {"ok": True}

    # ------------------------------------------------------------ dış paylar ----

    @router.get("/{entity_id}/parties")
    def list_parties(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return {"items": parties.list_parties(db, a)}

    @router.post("/{entity_id}/parties")
    def create_party(payload: PartyIn, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        ratelimit.hit(f"{module}.parties", f"user:{a.user.id}", 60, 3600)
        return parties.create(db, a, payload.name)

    @router.patch("/{entity_id}/parties/{party_id}")
    def update_party(party_id: int, payload: PartyPatch, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return parties.update(db, a, party_id, payload.name, payload.archived)

    # ------------------------------------------------------------ mağaza ürünleri ----

    @router.get("/{entity_id}/shops")
    def list_shops(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return {"items": products.shop_options(db, a)}

    @router.get("/{entity_id}/listing-sections")
    def listing_section_options(shop_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        """Mağaza bölümleri ve ürün sayıları (ürün seçici önce bölümleri gösterir)."""
        return {"items": products.listing_sections(db, a, shop_id)}

    @router.get("/{entity_id}/listings")
    def search_listings(shop_id: int, q: str = Query("", max_length=80), section: int | None = Query(None, ge=0), offset: int = Query(0, ge=0, le=100000),
                        a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        """Mağaza ürünleri, sayfa sayfa; `section` verilirse yalnızca o bölümün ürünleri (0 = bölümsüz)."""
        return products.listing_options(db, a, shop_id, q, section, offset)

    @router.get("/{entity_id}/product-measures")
    def list_product_measures(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return {"items": products.list_measures(db, a)}

    @router.get("/{entity_id}/listings/{shop_id}/{listing_id}/variants")
    def listing_variant_options(shop_id: int, listing_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        """Listing'in seçenekleri (ebat/varyasyon; Etsy envanterinden). Seçenek yoksa boş liste."""
        return {"items": products.variant_options(db, a, shop_id, listing_id)}

    @router.put("/{entity_id}/product-measures/{shop_id}/{listing_id}")
    def put_product_measures(shop_id: int, listing_id: int, payload: MeasuresIn, variant: str = Query("", max_length=300),
                             part: int = Query(0, ge=0, lt=products.MAX_PARTS), a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        ratelimit.hit(f"{module}.measures", f"user:{a.user.id}", 600, 3600)
        material = payload.material if "material" in payload.model_fields_set else pricebook.UNSET
        return products.set_measures(db, a, shop_id, listing_id, payload.values, payload.source, variant, part, material)

    @router.post("/{entity_id}/product-measures/{shop_id}/{listing_id}/drawing")
    def measure_product_drawing(shop_id: int, listing_id: int, file: UploadFile = File(...), variant: str = Query("", max_length=300),
                                part: int = Query(0, ge=0, lt=products.MAX_PARTS), a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        ratelimit.hit(f"{module}.drawing", f"user:{a.user.id}", 60, 3600)
        content = file.file.read(documents.MAX_BYTES + 1)
        if len(content) > documents.MAX_BYTES:
            raise HTTPException(413, f"Dosya çok büyük (en fazla {documents.MAX_BYTES // (1024 * 1024)} MB)")
        return products.measure_drawing(db, a, shop_id, listing_id, content, file.filename or "", variant, part)

    @router.post("/{entity_id}/drawings/sheet")
    def analyze_sheet_drawing(file: UploadFile = File(...), gap: float = Query(cad.DEFAULT_GAP_MM, ge=5, le=500),
                              a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        """Plaka çizimini (birden çok ürün) gruplara ayırır; kaydetmez."""
        ratelimit.hit(f"{module}.drawing", f"user:{a.user.id}", 60, 3600)
        content = file.file.read(documents.MAX_BYTES + 1)
        if len(content) > documents.MAX_BYTES:
            raise HTTPException(413, f"Dosya çok büyük (en fazla {documents.MAX_BYTES // (1024 * 1024)} MB)")
        return products.analyze_sheet(db, a, content, file.filename or "", gap)

    @router.delete("/{entity_id}/product-measures/{shop_id}/{listing_id}")
    def delete_product_measures(shop_id: int, listing_id: int, variant: str = Query("", max_length=300), part: int | None = Query(None, ge=0, lt=products.MAX_PARTS),
                                a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        """Ürünü listeden çıkarır; `part` verilirse yalnızca o parçasını."""
        products.remove_measures(db, a, shop_id, listing_id, variant, part)
        return {"ok": True}

    # ------------------------------------------------------------ paylaşım ----

    @router.get("/{entity_id}/sharing")
    def sharing_overview(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return sharing.overview(db, a)

    @router.post("/{entity_id}/invites")
    def invite(payload: InviteIn, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return sharing.create(db, a, payload.email, payload.permissions)

    @router.post("/{entity_id}/invites/{invite_id}/resend")
    def resend_invite(invite_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        return sharing.resend(db, a, invite_id)

    @router.delete("/{entity_id}/invites/{invite_id}")
    def revoke_invite(invite_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        sharing.revoke(db, a, invite_id)
        return {"ok": True}

    @router.patch("/{entity_id}/grants/{grant_id}")
    def patch_grant(grant_id: int, payload: GrantPatch, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        sharing.update_grant(db, a, grant_id, payload.permissions)
        return {"ok": True}

    @router.delete("/{entity_id}/grants/{grant_id}")
    def remove_grant(grant_id: int, a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        sharing.remove_grant(db, a, grant_id)
        return {"ok": True}

    @router.post("/{entity_id}/leave")
    def leave(a: acc.EntityAccess = Depends(entity_access), db: Session = Depends(get_db)):
        sharing.leave(db, a)
        return {"ok": True}

    def _notify_guest_change(db: Session, a: acc.EntityAccess, kind: str, item_name: str) -> None:
        """Misafir (tedarikçi) fiyat listesini değiştirdiyse çalışma alanına haber ver."""
        if not a.is_guest:
            return
        from app.modkit import mailer

        who = a.user.name or a.user.email
        mailer.notify_members(
            db, a.entity, "price_changed",
            f"{a.entity.name}: fiyat listesi güncellendi", f"{a.entity.name}: price list updated",
            [("Değiştiren", who), ("Kalem", item_name)], [("Changed by", who), ("Item", item_name)],
            f"/{module}/{a.entity.id}?tab=prices",
        )

    return router


invite_router = APIRouter(prefix="/api/invites", tags=["invites"])
core_router = APIRouter(prefix="/api/modkit", tags=["modkit"])


@core_router.get("/currencies")
def list_currencies():
    """Modül kayıtlarında seçilebilecek para birimleri (kuru bulunabilenler). Tek kaynak: modkit/currencies.py."""
    return {"items": list(currencies.CURRENCIES), "default": currencies.DEFAULT}


@invite_router.get("/{token}")
def invite_lookup(token: str, request: Request, db: Session = Depends(get_db)):
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    return sharing.lookup(db, token, ip or "unknown")


@invite_router.post("/{token}/accept")
def invite_accept(token: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return sharing.accept(db, token, user)

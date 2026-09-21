"""Yeni listing ve kopyalama (Etsy Shop Manager'daki "Add a listing" / "Copy").

Yerel-önce: yeni listing önce YALNIZCA yerelde, negatif geçici kimlikli bir yerel sürüm olarak var olur
(ListingLocal.listing_id < 0). "Etsy'de yayınla" deyince Etsy'de bir TASLAK oluşturulur (createDraftListing,
ücretsiz), kayıt gerçek kimliğe taşınır ve geri kalan her şey (fotoğraflar, envanter, özellikler, kişiselleştirme…)
mevcut üç yönlü yayın hattıyla uygulanır. Etsy'de aktif etme (listing ücreti 0,20 $) en sonda ve yalnızca istenirse yapılır.
"""

import copy
import json
import logging
import mimetypes

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.etsy.client import EtsyClient
from app.listings import bulk, drafts, image_cache, service
from app.listings.models import DraftFile, ListingCache, ListingLocal
from app.listings.schemas import ListingUpdateIn
from app.shops.models import Shop

log = logging.getLogger("app.creation")


def _file_url(shop: Shop, listing_id: int, file_id: str) -> str:
    return f"{settings.api_public_url}/api/shops/{shop.id}/listings/{listing_id}/draft/files/{file_id}"


def _next_temp_id(db: Session, shop: Shop) -> int:
    ids = db.scalars(select(ListingLocal.listing_id).where(ListingLocal.shop_id == shop.id).where(ListingLocal.listing_id < 0)).all()
    return min([-1, *[i - 1 for i in ids]])


def _shop_currency(db: Session, shop: Shop) -> str:
    for inv_json in db.scalars(select(ListingCache.inventory_json).where(ListingCache.shop_id == shop.id).limit(20)):
        for p in json.loads(inv_json or "{}").get("products", []):
            for o in p.get("offerings", []):
                if isinstance(o.get("price"), dict) and o["price"].get("currency_code"):
                    return o["price"]["currency_code"]
    return "USD"


def blank_work(db: Session, shop: Shop, temp_id: int) -> dict:
    return {
        "listing_id": temp_id, "title": "", "description": "", "tags": [], "materials": [], "taxonomy_id": None,
        "who_made": "i_did", "when_made": "made_to_order", "is_supply": False,
        "shipping_profile_id": None, "return_policy_id": None, "images": [], "videos": [],
        "inventory": {
            "products": [{
                "sku": "", "property_values": [],
                "offerings": [{"price": {"amount": 2000, "divisor": 100, "currency_code": _shop_currency(db, shop)}, "quantity": 1, "is_enabled": True}],
            }],
            "price_on_property": [], "quantity_on_property": [], "sku_on_property": [], "readiness_state_on_property": [],
        },
        "properties": [], "shop_section_id": None, "featured_rank": None, "should_auto_renew": True, "is_taxable": True,
        "item_weight": None, "item_length": None, "item_width": None, "item_height": None,
        "item_weight_unit": None, "item_dimensions_unit": None, "production_partner_ids": [],
        "ecgt_garan_brand": None, "ecgt_garan_years": None, "ecgt_garan_model": None,
        "ecgt_garan_guarantee_details": None, "ecgt_other_commercial_guarantee_details": None,
        "ecgt_after_sales_service_info": None, "ecgt_software_update_details": None,
        "state": "draft", "listing_type": "physical", "url": None, "original_creation_timestamp": None, "ending_timestamp": None,
        "personalization": {"questions": []}, "managed_property_ids": [],
        "variation_links": {"property_id": None, "images": {}},
    }


def _copy_work(db: Session, shop: Shop, source: ListingCache, temp_id: int) -> tuple[dict, list[str]]:
    """Var olan bir listing'in yerel kopyası: görseller diskteki önbellekten yeni taslak dosyalarına çoğaltılır."""
    warnings: list[str] = []
    work = copy.deepcopy(bulk.snapshot_cached(source))
    work.update({
        "listing_id": temp_id, "title": f"{work['title']} (kopya)"[: bulk.TITLE_MAX], "state": "draft",
        "url": None, "original_creation_timestamp": None, "ending_timestamp": None, "featured_rank": None,
    })
    id_map: dict[int, int] = {}
    images = []
    for n, img in enumerate(sorted(work["images"], key=lambda i: i.get("rank", 0)), start=1):
        old_id = img["listing_image_id"]
        got = image_cache.read(shop.id, source.listing_id, old_id)
        if got is None:
            url = img.get("url_fullxfull") or img.get("url_570xN")
            try:
                got = image_cache.fetch(shop.id, source.listing_id, old_id, url) if url else None
            except Exception:  # noqa: BLE001
                got = None
        if got is None:
            warnings.append(f"Fotoğraf {n} kopyalanamadı.")
            continue
        content, media_type = got
        ext = mimetypes.guess_extension(media_type) or ".jpg"
        saved = drafts.save_file(db, shop, temp_id, "image", f"copy-{old_id}{ext}", media_type, content)
        url = _file_url(shop, temp_id, saved["file_id"])
        new_id = -n
        id_map[old_id] = new_id
        images.append({
            "listing_image_id": new_id, "draft_file_id": saved["file_id"], "rank": len(images) + 1,
            "alt_text": img.get("alt_text"), "url_75x75": url, "url_170x135": url, "url_570xN": url, "url_fullxfull": url,
        })
    work["images"] = images
    if source.raw_json and json.loads(source.raw_json).get("videos"):
        warnings.append("Videolar kopyalanmaz; gerekirse yeni listing'e yeniden ekle.")
    work["videos"] = []
    links = work.get("variation_links")
    if links:
        work["variation_links"] = {"property_id": links.get("property_id"), "images": {k: id_map[v] for k, v in links["images"].items() if v in id_map}}
    else:
        work["variation_links"] = {"property_id": None, "images": {}}
    if work.get("personalization") is None:
        work["personalization"] = {"questions": []}
        warnings.append("Kişiselleştirme (özel seçenekler) kopyalanamadı; listing'i bir kez açıp senkronize et ya da elle ekle.")
    else:
        for q in work["personalization"]["questions"]:
            q["question_id"] = None
            for o in q.get("options", []):
                o["option_id"] = None
    # Yeni listing: mevcut envanter kimlikleri geçersizdir; tüm özellikler yeni listing'e yazılacak.
    for p in work["inventory"].get("products", []):
        p.pop("product_id", None)
        for o in p.get("offerings", []):
            o.pop("offering_id", None)
    work["managed_property_ids"] = [p["property_id"] for p in work["properties"]]
    return work, warnings


def create_local_new(db: Session, shop: Shop, source_id: int | None) -> dict:
    temp_id = _next_temp_id(db, shop)
    warnings: list[str] = []
    if source_id is None:
        work = blank_work(db, shop, temp_id)
    else:
        source = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id).where(ListingCache.listing_id == source_id)).one_or_none()
        if source is None:
            raise ValueError("Kopyalanacak listing yerelde yok; önce senkronize et.")
        work, warnings = _copy_work(db, shop, source, temp_id)
    # Yeni listing için "Etsy hâli" yoktur; taban kopya yerelin kendisidir.
    drafts.save_local(db, shop, temp_id, work, None)
    log.info("Yeni yerel listing %s oluşturuldu (kaynak=%s)", temp_id, source_id)
    return {"listing_id": temp_id, "warnings": warnings}


def edit_from_local(db: Session, shop: Shop, listing_id: int):
    """Yeni (yerel) listing'in düzenleme görünümü."""
    from app.listings.schemas import ListingEditOut

    local = drafts._local_row(db, shop, listing_id)
    if local is None:
        raise ValueError("Yeni listing bulunamadı.")
    work = json.loads(local.data_json)
    return ListingEditOut(**{k: work[k] for k in ListingEditOut.model_fields if k in work})


def local_summaries(db: Session, shop: Shop) -> list[dict]:
    """Liste sayfasında gösterilecek yeni (henüz Etsy'de olmayan) listing'ler."""
    out = []
    for local in db.scalars(select(ListingLocal).where(ListingLocal.shop_id == shop.id).where(ListingLocal.listing_id < 0)).all():
        work = json.loads(local.data_json)
        images = sorted(work.get("images") or [], key=lambda i: i.get("rank", 0))
        out.append({"local": local, "work": work, "image_url": images[0].get("url_170x135") if images else None})
    return out


def validate_new(work: dict, activate: bool) -> list[str]:
    problems = []
    if not (work.get("title") or "").strip():
        problems.append("Başlık gerekli.")
    if not (work.get("description") or "").strip():
        problems.append("Açıklama gerekli.")
    if not work.get("taxonomy_id"):
        problems.append("Kategori seç.")
    if not work.get("who_made") or not work.get("when_made"):
        problems.append("'Kim yaptı' ve 'Ne zaman yapıldı' gerekli.")
    offerings = [o for p in work.get("inventory", {}).get("products", []) for o in p.get("offerings", [])]
    if not offerings:
        problems.append("En az bir fiyat/stok satırı gerekli.")
    if activate:
        if not work.get("shipping_profile_id"):
            problems.append("Aktif etmek için kargo profili gerekli.")
        if not work.get("images"):
            problems.append("Aktif etmek için en az bir fotoğraf gerekli.")
    return problems


def _price(o: dict) -> float:
    p = o.get("price")
    return p["amount"] / p["divisor"] if isinstance(p, dict) else float(p or 0)


def publish_new(db: Session, shop: Shop, user_id: int, temp_id: int, force: bool = False) -> dict:
    local = drafts._local_row(db, shop, temp_id)
    if local is None:
        return {"ok": False, "steps": [], "error": "Yeni listing bulunamadı.", "edit": None, "conflicts": [], "warnings": []}
    work: dict = json.loads(local.data_json)
    activate = work.get("state") == "active"

    problems = validate_new(work, activate)
    if problems:
        return {"ok": False, "steps": [], "error": " ".join(problems), "edit": None, "conflicts": [], "warnings": []}

    offerings = [o for p in work["inventory"]["products"] for o in p["offerings"] if o.get("is_enabled", True)] or [
        o for p in work["inventory"]["products"] for o in p["offerings"]
    ]
    body: dict = {
        "title": work["title"].strip(), "description": work["description"], "who_made": work["who_made"],
        "when_made": work["when_made"], "taxonomy_id": work["taxonomy_id"], "is_supply": bool(work.get("is_supply")),
        "quantity": max(1, min(999, int(offerings[0].get("quantity") or 1))),
        "price": max(bulk.MIN_PRICE, min(_price(o) for o in offerings)),
        "should_auto_renew": bool(work.get("should_auto_renew")), "is_taxable": bool(work.get("is_taxable", True)),
    }
    for key in ("shipping_profile_id", "return_policy_id", "shop_section_id", "item_weight", "item_length", "item_width",
                "item_height", "item_weight_unit", "item_dimensions_unit"):
        if work.get(key) not in (None, ""):
            body[key] = work[key]
    for key in ("tags", "materials", "production_partner_ids"):
        if work.get(key):
            body[key] = work[key]
    readiness = offerings[0].get("readiness_state_id")
    if readiness:
        body["readiness_state_id"] = readiness

    client = EtsyClient(db, shop)
    log.info("Yeni listing %s Etsy'de taslak olarak oluşturuluyor", temp_id)
    created = client.request("POST", f"/shops/{shop.etsy_shop_id}/listings", data=body)
    new_id = created["listing_id"]
    log.info("Etsy'de taslak oluşturuldu: %s (yerel %s)", new_id, temp_id)

    # Yerel kaydı gerçek kimliğe taşı; bundan sonrası sıradan bir düzenleme yayınıdır (base = Etsy'nin şimdiki hâli).
    for f in db.scalars(select(DraftFile).where(DraftFile.shop_id == shop.id).where(DraftFile.listing_id == temp_id)).all():
        f.listing_id = new_id
    local.listing_id = new_id
    db.commit()
    row = service._fetch_and_cache_one(db, shop, client, new_id)
    theirs = drafts._snapshot(db, shop, row)
    work["listing_id"] = new_id
    work["state"] = "draft"  # aktif etme en sonda
    work["managed_property_ids"] = [p["property_id"] for p in work.get("properties", [])]
    local.data_json = json.dumps(work, ensure_ascii=False)
    local.base_json = json.dumps(theirs, ensure_ascii=False)
    db.commit()

    result = drafts.publish_local(db, shop, user_id, new_id, force=True)
    result["listing_id"] = new_id
    if not result["ok"]:
        result["error"] = f"Listing Etsy'de taslak olarak oluşturuldu ({new_id}) ama bir adım başarısız oldu: {result['error']}"
        return result

    if activate:
        try:
            service.update_listing_fields(db, shop, user_id, new_id, ListingUpdateIn(state="active"))
            result["steps"].append({"name": "Etsy'de aktif etme", "ok": True, "changed": True})
            fresh = service._get_cache_row(db, shop, new_id)
            if fresh is not None:
                result["edit"] = service._listing_edit_out(fresh).model_dump()
        except Exception as exc:  # noqa: BLE001
            result["ok"] = False
            result["error"] = f"Listing Etsy'de taslak olarak oluşturuldu ({new_id}) ama aktif edilemedi: {drafts._err(exc)}"
            result["steps"].append({"name": "Etsy'de aktif etme", "ok": False, "error": drafts._err(exc)})
    return result

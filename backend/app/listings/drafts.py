"""Yerel taslak sistemi.

Taslak = bir listing'in düzenlenmiş çalışma kopyasının tamamı (JSON) + henüz Etsy'ye
yüklenmemiş fotoğraf/video dosyaları (diskte). Taslakta yapılan hiçbir şey Etsy'yi
etkilemez; `publish_draft` taslağı canlı Etsy durumuyla karşılaştırıp yalnızca farkı uygular.
Bu yüzden yayın idempotent: yarıda kesilirse tekrar denenince kalan farkı tamamlar.

Çalışma kopyasında henüz yüklenmemiş görsel/videolar negatif id'li girdilerdir
(`listing_image_id < 0` / `video_id < 0`) ve `draft_file_id` taşır."""

import datetime as dt
import logging
import json
import uuid
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.etsy import images as etsy_images
from app.etsy import inventory as etsy_inventory
from app.etsy import variation_images as etsy_variation_images
from app.etsy import videos as etsy_videos
from app.etsy.client import write_count,  EtsyClient
from app.listings import service
from app.listings import image_cache
from app.listings.models import DraftFile, ListingDraft, ListingLocal, ListingVersion
from app.listings.schemas import (
    ImageOrderIn,
    InventoryUpdateIn,
    ListingUpdateIn,
    PersonalizationIn,
    PropertyUpdateIn,
)
from app.shops.models import Shop

_log = logging.getLogger("app.publish")

DRAFT_DIR = Path(__file__).resolve().parents[2] / "uploads" / "drafts"

CORE_FIELDS = [
    "title", "description", "tags", "materials", "taxonomy_id", "who_made", "when_made", "is_supply",
    "shipping_profile_id", "return_policy_id", "shop_section_id", "featured_rank", "should_auto_renew",
    "is_taxable", "item_weight", "item_length", "item_width", "item_height", "item_weight_unit",
    "item_dimensions_unit", "production_partner_ids", "ecgt_garan_brand", "ecgt_garan_years",
    "ecgt_garan_model", "ecgt_garan_guarantee_details", "ecgt_other_commercial_guarantee_details",
    "ecgt_after_sales_service_info", "ecgt_software_update_details", "state",
]


# ---------------------------------------------------------------- CRUD ----

def _row(db: Session, shop: Shop, listing_id: int) -> ListingDraft | None:
    return db.scalars(
        select(ListingDraft).where(ListingDraft.shop_id == shop.id).where(ListingDraft.listing_id == listing_id)
    ).one_or_none()


def get_draft(db: Session, shop: Shop, listing_id: int) -> dict:
    row = _row(db, shop, listing_id)
    if row is None:
        return {"exists": False, "data": None, "updated_at": None}
    return {"exists": True, "data": json.loads(row.data_json), "updated_at": row.updated_at.isoformat()}


def save_draft(db: Session, shop: Shop, listing_id: int, data: dict) -> dict:
    row = _row(db, shop, listing_id)
    if row is None:
        row = ListingDraft(shop_id=shop.id, listing_id=listing_id)
        db.add(row)
    row.data_json = json.dumps(data, ensure_ascii=False)
    row.updated_at = dt.datetime.utcnow()
    db.commit()
    return {"exists": True, "updated_at": row.updated_at.isoformat()}


def _local_row(db: Session, shop: Shop, listing_id: int) -> ListingLocal | None:
    return db.scalars(
        select(ListingLocal).where(ListingLocal.shop_id == shop.id).where(ListingLocal.listing_id == listing_id)
    ).one_or_none()


def get_local(db: Session, shop: Shop, listing_id: int) -> dict:
    row = _local_row(db, shop, listing_id)
    if row is None:
        return {"exists": False, "data": None, "updated_at": None}
    return {"exists": True, "data": json.loads(row.data_json), "updated_at": row.updated_at.isoformat()}


def save_local(db: Session, shop: Shop, listing_id: int, data: dict, base: dict | None = None) -> dict:
    """"Kaydet": düzenlenmiş hâli yerel sürüm olarak saklar. Ara kayıt (taslak) artık gereksizdir."""
    row = _local_row(db, shop, listing_id)
    if row is None:
        row = ListingLocal(shop_id=shop.id, listing_id=listing_id)
        db.add(row)
    row.data_json = json.dumps(data, ensure_ascii=False)
    row.updated_at = dt.datetime.utcnow()
    if row.base_json is None and base is not None:
        row.base_json = json.dumps(base, ensure_ascii=False)  # ilk Kaydet'teki Etsy hâli; sonraki kayıtlarda değişmez
    draft = _row(db, shop, listing_id)
    if draft is not None:
        db.delete(draft)
    db.commit()
    _prune_files(db, shop, listing_id)
    return {"exists": True, "updated_at": row.updated_at.isoformat()}


def _referenced_file_ids(db: Session, shop: Shop, listing_id: int) -> set[str]:
    ids: set[str] = set()
    for row in (_row(db, shop, listing_id), _local_row(db, shop, listing_id)):
        if row is None:
            continue
        data = json.loads(row.data_json)
        for key in ("images", "videos"):
            for entry in data.get(key) or []:
                if entry.get("draft_file_id"):
                    ids.add(entry["draft_file_id"])
    return ids


def _prune_files(db: Session, shop: Shop, listing_id: int) -> None:
    """Ne taslak ne de yerel sürüm tarafından kullanılan dosyaları diskten siler."""
    keep = _referenced_file_ids(db, shop, listing_id)
    files = db.scalars(
        select(DraftFile).where(DraftFile.shop_id == shop.id).where(DraftFile.listing_id == listing_id)
    ).all()
    for f in files:
        if f.id not in keep:
            Path(f.path).unlink(missing_ok=True)
            db.delete(f)
    db.commit()


def discard_draft(db: Session, shop: Shop, listing_id: int) -> None:
    row = _row(db, shop, listing_id)
    if row is not None:
        db.delete(row)
        db.commit()
    _prune_files(db, shop, listing_id)


def discard_local(db: Session, shop: Shop, listing_id: int) -> None:
    """Yerel değişiklikleri (ve taslağı) atar; listing Etsy'deki hâline döner."""
    for row in (_local_row(db, shop, listing_id), _row(db, shop, listing_id)):
        if row is not None:
            db.delete(row)
    db.commit()
    _prune_files(db, shop, listing_id)


def save_file(
    db: Session, shop: Shop, listing_id: int, kind: str, filename: str, content_type: str, content: bytes
) -> dict:
    file_id = str(uuid.uuid4())
    folder = DRAFT_DIR / str(shop.id) / str(listing_id)
    folder.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix[:10]
    path = folder / f"{file_id}{suffix}"
    path.write_bytes(content)
    db.add(
        DraftFile(
            id=file_id, shop_id=shop.id, listing_id=listing_id, kind=kind,
            filename=filename[:255], content_type=content_type or "application/octet-stream", path=str(path),
        )
    )
    db.commit()
    return {"file_id": file_id, "kind": kind, "filename": filename}


def get_file(db: Session, shop: Shop, listing_id: int, file_id: str) -> DraftFile | None:
    f = db.get(DraftFile, file_id)
    if f is None or f.shop_id != shop.id or f.listing_id != listing_id:
        return None
    return f


# ------------------------------------------------------------- publish ----

def _price(offering: dict) -> float:
    price = offering.get("price")
    if isinstance(price, dict):
        return round(price["amount"] / price.get("divisor", 100), 2)
    return round(float(price or 0), 2)


def _inventory_signature(inv: dict) -> str:
    products = []
    for p in inv.get("products", []):
        values = sorted((v["property_id"], list(v.get("values", []))) for v in p.get("property_values", []))
        offers = [
            [_price(o), o.get("quantity"), bool(o.get("is_enabled", True)), o.get("readiness_state_id") or None]
            for o in p.get("offerings", [])
        ]
        products.append(json.dumps([values, p.get("sku") or "", offers], sort_keys=True))
    return json.dumps(
        [
            sorted(products),
            sorted(inv.get("price_on_property") or []),
            sorted(inv.get("quantity_on_property") or []),
            sorted(inv.get("sku_on_property") or []),
            sorted(inv.get("readiness_state_on_property") or []),
        ]
    )


def _err(exc: Exception) -> str:
    return getattr(exc, "message", None) or str(exc) or exc.__class__.__name__


CORE_LABELS = {
    "title": "Başlık", "description": "Açıklama", "tags": "Etiketler", "materials": "Materyaller",
    "taxonomy_id": "Kategori", "who_made": "Kim yaptı", "when_made": "Ne zaman yapıldı", "is_supply": "Tedarik ürünü",
    "shipping_profile_id": "Kargo profili", "return_policy_id": "İade politikası", "shop_section_id": "Mağaza bölümü",
    "featured_rank": "Öne çıkarma", "should_auto_renew": "Otomatik yenileme", "is_taxable": "Vergi",
    "item_weight": "Ağırlık", "item_length": "Uzunluk", "item_width": "Genişlik", "item_height": "Yükseklik",
    "item_weight_unit": "Ağırlık birimi", "item_dimensions_unit": "Boyut birimi",
    "production_partner_ids": "Üretim ortakları", "state": "Durum",
}
EXTRA_LABELS = {
    "inventory": "Fiyat, stok ve varyasyonlar", "links": "Varyasyon fotoğrafları",
    "personalization": "Kişiselleştirme", "properties": "Özellikler",
}


def _label(key: str) -> str:
    return CORE_LABELS.get(key) or EXTRA_LABELS.get(key) or key.replace("ecgt_", "Garanti: ").replace("_", " ")


def _decide(mine, base, theirs) -> str:
    """Üç yönlü karşılaştırma. skip: benim değişikliğim yok ya da zaten aynı; send: yalnızca ben değiştirdim;
    conflict: hem ben hem Etsy (farklı şekilde) değiştirdik."""
    if mine == base or mine == theirs:
        return "skip"
    if theirs == base:
        return "send"
    return "conflict"


def _pers_norm(p) -> list:
    out = []
    for q in (p or {}).get("questions") or []:
        text = (q.get("question_text") or "").strip()
        if text:
            out.append((
                text, q.get("instructions") or "", q.get("question_type"), bool(q.get("required")),
                q.get("max_allowed_characters"), q.get("max_allowed_files"),
                tuple(o.get("label", "") for o in q.get("options") or []),
            ))
    return out


def _prop_key(p: dict | None):
    if not p or not (p.get("values") or p.get("value_ids")):
        return None
    return (tuple(sorted(p.get("value_ids", []))), tuple(p.get("values", [])), p.get("scale_id"))


def _snapshot(db: Session, shop: Shop, row) -> dict:
    """Etsy'deki güncel durumun, çalışma kopyasıyla aynı biçimdeki özeti (önyüzdeki build() ile aynı)."""
    edit = service._listing_edit_out(row).model_dump()
    pers = service.get_listing_personalization(db, shop, row.listing_id)
    vimg = service._unescape(json.loads(row.variation_images_json or "[]"))
    return {
        **edit,
        "personalization": {"questions": [q.model_dump() for q in pers.questions]},
        "managed_property_ids": [],
        "variation_links": {
            "property_id": vimg[0]["property_id"] if vimg else None,
            "images": {v["value"]: v["image_id"] for v in vimg if v.get("value")},
        },
    }


def _ids(items: list, key: str) -> list[int]:
    return [i[key] for i in items or []]


def _verdicts(base: dict, work: dict, theirs: dict) -> dict:
    v: dict = {"core": {}, "props": {}}
    for k in CORE_FIELDS:
        if k in work:
            v["core"][k] = _decide(work[k], base.get(k), theirs.get(k))
    b_props = {p["property_id"]: p for p in base.get("properties", [])}
    w_props = {p["property_id"]: p for p in work.get("properties", [])}
    t_props = {p["property_id"]: p for p in theirs.get("properties", [])}
    for pid in work.get("managed_property_ids", []):
        v["props"][pid] = _decide(_prop_key(w_props.get(pid)), _prop_key(b_props.get(pid)), _prop_key(t_props.get(pid)))
    if work.get("inventory"):
        sw = _inventory_signature(work["inventory"])
        v["inventory"] = _decide(sw, _inventory_signature(base.get("inventory") or {}), _inventory_signature(theirs.get("inventory") or {}))
    else:
        v["inventory"] = "skip"
    v["links"] = _decide(work.get("variation_links"), base.get("variation_links"), theirs.get("variation_links"))
    if work.get("personalization") and "questions" in work["personalization"]:
        v["personalization"] = _decide(
            _pers_norm(work["personalization"]), _pers_norm(base.get("personalization")), _pers_norm(theirs.get("personalization"))
        )
    else:
        v["personalization"] = "skip"  # eski biçimli kayıtlar: sorular silinmesin
    # Görseller/videolar birleştirilir (Etsy'de sonradan eklenenler korunur): yalnızca benim değişikliğim var mı.
    v["images"] = "skip" if _ids(work.get("images"), "listing_image_id") == _ids(base.get("images"), "listing_image_id") else "send"
    v["videos"] = "skip" if _ids(work.get("videos"), "video_id") == _ids(base.get("videos"), "video_id") else "send"
    return v


def _conflicts(v: dict) -> list[dict]:
    out = [{"key": k, "label": _label(k)} for k, x in v["core"].items() if x == "conflict"]
    out += [{"key": f"property:{pid}", "label": _label("properties")} for pid, x in v["props"].items() if x == "conflict"]
    for k in ("inventory", "links", "personalization"):
        if v[k] == "conflict":
            out.append({"key": k, "label": _label(k)})
    return out


def publish_local(db: Session, shop: Shop, user_id: int, listing_id: int, force: bool = False) -> dict:
    """Kaydedilmiş yerel sürümü Etsy'ye uygular.

    Üç yönlü karşılaştırma: base (yerel kopyanın alındığı Etsy hâli), mine (yerel kopya), theirs (Etsy'nin şimdiki hâli).
    Yalnızca BENİM değiştirdiğim alanlar gönderilir; Etsy'de sonradan değişen dokunulmamış alanlar ve eklenen
    fotoğraflar korunur. Aynı alanı ikimiz de farklı değiştirdiysek yayın hiçbir şey yazmadan durur (force ile ezilir)."""
    if listing_id < 0:  # henüz Etsy'de olmayan yeni listing: önce taslak olarak oluşturulur
        from app.listings import creation

        return creation.publish_new(db, shop, user_id, listing_id, force)
    local = _local_row(db, shop, listing_id)
    if local is None:
        return {"ok": False, "steps": [], "error": "Yayınlanacak yerel değişiklik yok.", "edit": None}
    work: dict = json.loads(local.data_json)
    _log.info("Yayın %s başladı%s", listing_id, " (zorla)" if force else "")

    client = EtsyClient(db, shop)
    steps: list[dict] = []
    warnings: list[str] = []
    state: dict = {}

    row = service._fetch_and_cache_one(db, shop, client, listing_id)  # Etsy'nin şimdiki hâli
    theirs = _snapshot(db, shop, row)
    # Başlangıç kopyası olmayan eski kayıtlarda fark = yerel kopya ile Etsy arasındaki her şey (eski davranış).
    base: dict = json.loads(local.base_json) if getattr(local, "base_json", None) else theirs
    verdict = _verdicts(base, work, theirs)

    conflicts = _conflicts(verdict)
    if conflicts and not force:
        names = ", ".join(c["label"] for c in conflicts)
        _log.warning("Yayın %s durduruldu, çakışma: %s", listing_id, names)
        return {
            "ok": False, "steps": [], "edit": None, "warnings": [], "conflicts": conflicts,
            "error": f"Bu listing Etsy'de sen kaydettikten sonra değişmiş ({names}). Hiçbir şey yazılmadı.",
        }

    def step(name: str, fn) -> bool:
        before = write_count()
        try:
            fn()
            steps.append({"name": name, "ok": True, "changed": write_count() > before})
            _log.info("Yayın %s: %s tamam (değişti=%s)", listing_id, name, write_count() > before)
            return True
        except Exception as exc:  # noqa: BLE001 - adımın hatasını kullanıcıya göster, kalanı durdur
            steps.append({"name": name, "ok": False, "error": _err(exc)})
            _log.warning("Yayın %s: %s BAŞARISIZ: %s", listing_id, name, _err(exc))
            return False

    def core():
        changed = {}
        for k, x in verdict["core"].items():
            if x == "skip":
                continue
            if work[k] is None and theirs.get(k) is not None:
                # Boş değer Etsy'ye gönderilemiyor (belgesiz); sessizce yutmak yerine kullanıcıya bildir.
                warnings.append(f"{_label(k)} Etsy'den boşaltılamıyor; Etsy'de elle değiştir.")
                continue
            changed[k] = work[k]
        # Etsy yalnızca active/inactive yazmaya izin verir (draft, sold_out, expired… salt okunur).
        if changed.get("state") not in (None, "active", "inactive"):
            changed.pop("state")
        if changed:
            service.update_listing_fields(db, shop, user_id, listing_id, ListingUpdateIn(**changed))

    def properties():
        live = {p["property_id"]: p for p in theirs["properties"]}
        mine = {p["property_id"]: p for p in work.get("properties", [])}
        for pid, x in verdict["props"].items():
            if x == "skip":
                continue
            w, cur = mine.get(pid), live.get(pid)
            if w and (w.get("values") or w.get("value_ids")):
                service.update_listing_property(
                    db, shop, listing_id, pid,
                    PropertyUpdateIn(value_ids=w.get("value_ids", []), values=w.get("values", []), scale_id=w.get("scale_id")),
                )
            elif cur is not None:
                service.delete_listing_property(db, shop, listing_id, pid)

    def images():
        if verdict["images"] == "skip":
            return
        desired = work.get("images", [])
        real_ids = {i["listing_image_id"] for i in desired if i["listing_image_id"] > 0}
        base_ids = set(_ids(base.get("images"), "listing_image_id"))
        removed = base_ids - real_ids  # yalnızca BENİM kaldırdıklarım silinir
        for img in etsy_images.list_images(client, listing_id):
            if img["listing_image_id"] in removed:
                service.delete_listing_image(db, shop, listing_id, img["listing_image_id"])
        id_map: dict[int, int] = {}
        for entry in desired:
            if entry["listing_image_id"] < 0:
                f = get_file(db, shop, listing_id, entry.get("draft_file_id", ""))
                if f is None:
                    raise ValueError("Taslak görsel dosyası bulunamadı; görseli yeniden ekle.")
                up = etsy_images.upload_image(
                    client, listing_id, Path(f.path).read_bytes(), f.filename, None, entry.get("alt_text")
                )
                id_map[entry["listing_image_id"]] = up["listing_image_id"]
        state["id_map"] = id_map
        current = [i["listing_image_id"] for i in etsy_images.list_images(client, listing_id)]
        mapped = [id_map.get(i["listing_image_id"], i["listing_image_id"]) for i in desired]
        # Benim sıram; Etsy'de sonradan eklenen fotoğraflar sona eklenerek korunur.
        final = [i for i in mapped if i in set(current)] + [i for i in current if i not in set(mapped)]
        if current != final:
            service.reorder_listing_images(db, shop, listing_id, ImageOrderIn(image_ids=final))

    def inventory():
        state["inventory"] = theirs["inventory"]
        if verdict["inventory"] != "skip":
            state["inventory"] = service._unescape(
                service.update_listing_inventory(db, shop, listing_id, InventoryUpdateIn(**work["inventory"]))
            )

    def variation_images():
        if work.get("variation_links") is None:
            return  # toplu işlemle hazırlanmış kopya: fotoğraf bağları bilinmiyor, Etsy'dekine dokunma
        if verdict["inventory"] == "skip" and verdict["links"] == "skip":
            return
        links = work.get("variation_links") or {}
        pid = links.get("property_id")
        id_map = state.get("id_map", {})
        wanted: set[tuple[int, int, int]] = set()
        if pid:
            for p in state.get("inventory", {}).get("products", []):
                pv = next((v for v in p.get("property_values", []) if v["property_id"] == pid), None)
                if pv is None:
                    continue
                for i, name in enumerate(pv.get("values", [])):
                    ref = (links.get("images") or {}).get(name)
                    real = id_map.get(ref, ref) if ref else None
                    value_id = pv["value_ids"][i] if i < len(pv.get("value_ids", [])) else None
                    if value_id and real and real > 0:
                        wanted.add((pid, value_id, real))
        live = {
            (v["property_id"], v["value_id"], v["image_id"])
            for v in etsy_variation_images.get_variation_images(client, listing_id)
        }
        if wanted != live:
            etsy_variation_images.update_variation_images(
                client, listing_id,
                [{"property_id": a, "value_id": b, "image_id": c} for a, b, c in sorted(wanted)],
            )

    def videos():
        if verdict["videos"] == "skip":
            return
        base_ids = set(_ids(base.get("videos"), "video_id"))
        desired = work.get("videos", [])
        keep = {v["video_id"] for v in desired if v["video_id"] > 0}
        for v in theirs.get("videos", []):
            if v["video_id"] in base_ids and v["video_id"] not in keep:  # yalnızca BENİM kaldırdıklarım
                service.delete_listing_video(db, shop, listing_id, v["video_id"])
        for v in desired:
            if v["video_id"] < 0:
                f = get_file(db, shop, listing_id, v.get("draft_file_id", ""))
                if f is None:
                    raise ValueError("Taslak video dosyası bulunamadı; videoyu yeniden ekle.")
                etsy_videos.upload_video(client, listing_id, Path(f.path).read_bytes(), f.filename)

    def personalization():
        if verdict["personalization"] == "skip":
            return
        service.update_listing_personalization(
            db, shop, listing_id, PersonalizationIn(**{"questions": work["personalization"]["questions"]})
        )

    pipeline = [
        ("Temel bilgiler", core),
        ("Özellikler", properties),
        ("Fotoğraflar", images),
        ("Fiyat & stok / varyasyonlar", inventory),
        ("Varyasyon fotoğrafları", variation_images),
        ("Videolar", videos),
        ("Kişiselleştirme", personalization),
    ]
    for name, fn in pipeline:
        if not step(name, fn):
            return {"ok": False, "steps": steps, "error": steps[-1]["error"], "edit": None, "warnings": warnings, "conflicts": []}

    # Yayınlanan başlıkla eşleşen bekleyen AI önerisi artık uygulanmış sayılır.
    for version in db.scalars(
        select(ListingVersion)
        .where(ListingVersion.shop_id == shop.id)
        .where(ListingVersion.listing_id == listing_id)
        .where(ListingVersion.status == "pending")
    ).all():
        if version.suggested_title == work.get("title"):
            version.status = "applied"
            version.applied_at = dt.datetime.utcnow()

    # Etsy artık güncel: yerel sürüm ve taslak gereksiz, dosyalar Etsy'ye yüklendi.
    for r in (_local_row(db, shop, listing_id), _row(db, shop, listing_id)):
        if r is not None:
            db.delete(r)
    db.commit()
    _prune_files(db, shop, listing_id)
    fresh = service._fetch_and_cache_one(db, shop, client, listing_id)
    _log.info("Yayın %s tamamlandı", listing_id)
    return {
        "ok": True, "steps": steps, "error": None, "warnings": warnings, "conflicts": [],
        "edit": service._listing_edit_out(fresh).model_dump(),
    }


def download_image(db: Session, shop: Shop, listing_id: int, image_id: int) -> tuple[bytes, str]:
    """Etsy CDN'i CORS başlığı vermediği için tarayıcı canvas'ı görseli doğrudan okuyamaz;
    kırpma aracı görseli bu uç noktadan (aynı API'den) alır."""
    cached = image_cache.read(shop.id, listing_id, image_id)
    if cached is not None:
        return cached

    # Önbellekte yoksa: önce yerel listing kaydındaki URL'den indir (Etsy API'sine gitmeden).
    row = service._get_cache_row(db, shop, listing_id)
    if row is not None:
        for img in json.loads(row.raw_json).get("images") or []:
            if img.get("listing_image_id") == image_id and (img.get("url_fullxfull") or img.get("url_570xN")):
                return image_cache.fetch(shop.id, listing_id, image_id, img.get("url_fullxfull") or img.get("url_570xN"))
    # Önbellekte yoksa (eski kayıt) tek seferlik indirilir.
    for img in etsy_images.list_images(EtsyClient(db, shop), listing_id):
        if img["listing_image_id"] == image_id:
            return image_cache.fetch(shop.id, listing_id, image_id, img.get("url_fullxfull") or img.get("url_570xN"))
    raise ValueError("Görsel bulunamadı")

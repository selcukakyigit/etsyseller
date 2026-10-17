"""Dijital (indirilebilir) listing araçları: dosya ekleme/kaldırma ve yeni taslağın türünü değiştirme.
Yalnızca yerel taslağa yazar (Etsy'ye gitmez). Listing'in oluşturulması create_listing_draft'ın listing_type="download" alanıyla yapılır."""
from app.listings import digital


def _fetch(ctx, lid: int):
    from app.assistant.tools import _work_or_error

    return _work_or_error(ctx, lid)


def add_digital_file(ctx, a: dict) -> dict:
    """Sohbete yüklenen dosyayı (ya da dosyaları) dijital listing'in indirilebilir dosyası olarak ekler."""
    from app.assistant.tools import _attach_digital_files, _save_draft_work, _show_listing

    lid = int(a["listing_id"])
    work, err = _fetch(ctx, lid)
    if err:
        return err
    if not digital.is_digital(work):
        return {"error": "Bu listing dijital değil; önce set_listing_type ile dijital yap (yalnızca yeni taslaklarda)."}
    ids = [str(i) for i in (a.get("chat_file_ids") or ([a["chat_file_id"]] if a.get("chat_file_id") else []))]
    if not ids:
        return {"error": "Eklenecek dosyanın kimliği (chat_file_ids) gerekli: sistem mesajındaki dosya listesinden."}
    notes = _attach_digital_files(ctx, lid, work, ids)
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["digital_files"])
    return {"ok": not notes or len(work.get("digital_files") or []) > 0, "dijital_dosya_sayisi": len(work.get("digital_files") or []), "uyarilar": notes,
            "not": "Yerel taslağa eklendi; Etsy'ye yayınlayınca yüklenir."}


def remove_digital_file(ctx, a: dict) -> dict:
    from app.assistant.tools import _save_draft_work, _show_listing

    lid = int(a["listing_id"])
    work, err = _fetch(ctx, lid)
    if err:
        return err
    files = work.get("digital_files") or []
    n = int(a.get("file_number") or 0)
    if not 1 <= n <= len(files):
        return {"error": f"Dosya bulunamadı; listing'de {len(files)} dijital dosya var (get_listing.dijital_dosyalar)."}
    removed = files.pop(n - 1)
    if removed.get("file_id"):
        return {"error": "Bu dosya zaten Etsy'ye yüklenmiş; Etsy'deki dosyayı buradan silemiyorum, Etsy'den sil."}
    work["digital_files"] = files
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["digital_files"])
    return {"ok": True, "kalan_dosya": len(files)}


def set_listing_type(ctx, a: dict) -> dict:
    """YENİ (henüz Etsy'ye gitmemiş) taslağı fiziksel ya da dijital yapar. Dijitale geçince varyasyon, kargo ve iade temizlenir."""
    from app.assistant.tools import _save_draft_work, _show_listing

    lid = int(a["listing_id"])
    if lid > 0:
        return {"error": "Etsy'deki bir listing'in türü değiştirilemez; yeni bir taslak oluştur."}
    work, err = _fetch(ctx, lid)
    if err:
        return err
    want = "download" if a.get("type") == "download" else "physical"
    if work.get("listing_type") == want:
        return {"ok": True, "not": "Tür zaten böyle."}
    work["listing_type"] = want
    if want == "download":
        for product in (work.get("inventory") or {}).get("products", []):
            product["property_values"] = []
        inv = work.get("inventory") or {}
        inv["products"] = (inv.get("products") or [])[:1]
        inv["price_on_property"] = inv["quantity_on_property"] = inv["sku_on_property"] = inv["readiness_state_on_property"] = []
        work["shipping_profile_id"] = work["return_policy_id"] = None
    _save_draft_work(ctx, lid, work)
    _show_listing(ctx, lid, work, ["listing_type"])
    return {"ok": True, "tur": want, "not": "Dijitale geçince varyasyonlar, kargo ve iade temizlendi; dosyaları add_digital_file ile ekle." if want == "download" else "Fiziksele döndü; kargo profilini ve iade politikasını seçmek gerekir."}


TOOLS: list[dict] = [
    {
        "name": "add_digital_file",
        "description": "Dijital listing taslağına indirilebilir dosya ekler: kullanıcının sohbete yüklediği dosya(lar) (chat_file_ids; PDF, ZIP, PNG, SVG, DOCX… en fazla 5 dosya, her biri 20 MB). Yalnızca yerel taslağa yazar; Etsy'ye yayınlayınca yüklenir.",
        "input_schema": {"type": "object", "properties": {"listing_id": {"type": "integer"}, "chat_file_ids": {"type": "array", "items": {"type": "string"}}, "chat_file_id": {"type": "string"}}, "required": []},
    },
    {
        "name": "remove_digital_file",
        "description": "Dijital listing taslağından henüz Etsy'ye yüklenmemiş bir dosyayı kaldırır (file_number: get_listing.dijital_dosyalar sırası, 1'den başlar).",
        "input_schema": {"type": "object", "properties": {"listing_id": {"type": "integer"}, "file_number": {"type": "integer"}}, "required": ["file_number"]},
    },
    {
        "name": "set_listing_type",
        "description": "YENİ taslağı dijital (type=download) ya da fiziksel (physical) yapar. Dijitalde varyasyon, kargo ve iade yoktur. Etsy'deki var olan listing'in türü değişmez.",
        "input_schema": {"type": "object", "properties": {"listing_id": {"type": "integer"}, "type": {"type": "string", "enum": ["physical", "download"]}}, "required": ["type"]},
    },
]
EXECUTORS = {"add_digital_file": add_digital_file, "remove_digital_file": remove_digital_file, "set_listing_type": set_listing_type}
LABELS = {"add_digital_file": "Dijital dosya ekliyor", "remove_digital_file": "Dijital dosyayı kaldırıyor", "set_listing_type": "Listing türünü değiştiriyor"}
LABELS_EN = {"add_digital_file": "Adding a digital file", "remove_digital_file": "Removing a digital file", "set_listing_type": "Changing the listing type"}

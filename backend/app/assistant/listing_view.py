"""Listing'in güncel hâlini (düzenleyicinin çalışma kopyası) asistanın okuyacağı özet sözlüğe çevirir. Saf mantık, yan etkisi yok.

Asistan bir listing'i değiştirmeden önce bunu okur: varyasyonlar, kombinasyonlar, özellikler, kategori… Böylece kendi hafızasından
değil gerçek veriden yazar (ör. varyasyonları baştan kurarken mevcut seçenekleri ve fiyatları bilir)."""
import html

from app.assistant import inventory_edit as inv

MAX_COMBO_ROWS = 60
DESCRIPTION_CHARS = 1500


def _money(offering: dict) -> float | None:
    price = offering.get("price")
    return round(price["amount"] / price["divisor"], 2) if isinstance(price, dict) and price.get("divisor") else None


def question_view(q: dict) -> dict:
    """Kişiselleştirme sorusu: set_listing_fields'a aynen geri verilebilecek tam tanım (seçenekler etiket olarak)."""
    return {
        "question_text": q.get("question_text"), "instructions": q.get("instructions") or "", "question_type": q.get("question_type"),
        "required": bool(q.get("required")), "max_allowed_characters": q.get("max_allowed_characters"),
        "options": [o.get("label") if isinstance(o, dict) else o for o in q.get("options") or []],
    }


def inventory_summary(work: dict) -> dict:
    products = inv._products(work)
    if not products:
        return {"envanter": "yok"}
    names = inv.variation_names(work)
    offering = (products[0].get("offerings") or [{}])[0]
    if not names:
        return {"varyasyon_yok": True, "fiyat": _money(offering), "stok": offering.get("quantity"), "sku": products[0].get("sku") or "", "hazirlik_suresi_id": offering.get("readiness_state_id")}
    rows = []
    for p in products[:MAX_COMBO_ROWS]:
        o = (p.get("offerings") or [{}])[0]
        rows.append({
            "secenekler": {pv["property_name"]: (pv.get("values") or [""])[0] for pv in p.get("property_values", [])},
            "fiyat": _money(o), "stok": o.get("quantity"), "sku": p.get("sku") or "", "acik": o.get("is_enabled", True),
        })
    links = work.get("variation_links") or {}
    return {
        "varyasyonlar": [{"ad": n, "secenekler": inv.options(work, n)} for n in names],
        "kombinasyon_sayisi": len(products), "kombinasyonlar": rows,
        **({"kombinasyonlar_kisaltildi": f"ilk {MAX_COMBO_ROWS} gösterildi"} if len(products) > MAX_COMBO_ROWS else {}),
        "fiyat_degisen_varyasyon": [pv["property_name"] for pv in products[0]["property_values"] if pv["property_id"] in (work["inventory"].get("price_on_property") or [])],
        "fotograf_bagli_varyasyon": {"ad": next((pv["property_name"] for pv in products[0]["property_values"] if pv["property_id"] == links.get("property_id")), None), "secenek_fotograf": links.get("images") or {}} if links.get("property_id") else None,
        "hazirlik_suresi_id": offering.get("readiness_state_id"),
    }


def describe_listing(work: dict, category_path: str | None = None) -> dict:
    images = sorted(work.get("images") or [], key=lambda i: i.get("rank") or 0)
    description = html.unescape(work.get("description") or "")
    questions = (work.get("personalization") or {}).get("questions", [])
    return {
        "listing_id": work.get("listing_id"), "durum": work.get("state"), "baslik": html.unescape(work.get("title") or ""),
        "aciklama": description[:DESCRIPTION_CHARS], "aciklama_uzunluk": len(description),
        "etiketler": work.get("tags") or [], "malzemeler": work.get("materials") or [], "stil": work.get("style") or [],
        "kategori": {"taxonomy_id": work.get("taxonomy_id"), "yol": category_path},
        "ozellikler": [{"ad": p.get("property_name"), "degerler": p.get("values") or []} for p in work.get("properties", [])],
        "kim_yapti": work.get("who_made"), "ne_zaman_yapildi": work.get("when_made"), "tedarik_urunu": work.get("is_supply"), "vergilendirilir": work.get("is_taxable"),
        "agirlik": {"deger": work.get("item_weight"), "birim": work.get("item_weight_unit")},
        "boyut": {"uzunluk": work.get("item_length"), "genislik": work.get("item_width"), "yukseklik": work.get("item_height"), "birim": work.get("item_dimensions_unit")},
        "kargo_profili_id": work.get("shipping_profile_id"), "iade_politikasi_id": work.get("return_policy_id"), "bolum_id": work.get("shop_section_id"),
        "otomatik_yenileme": work.get("should_auto_renew"), "one_cikan_sira": work.get("featured_rank"),
        "fotograflar": [{"sira": n, "image_id": i.get("listing_image_id"), "alt_text": i.get("alt_text")} for n, i in enumerate(images, start=1)],
        "videolar": [{"sira": n, "video_id": v.get("video_id"), "taslak": (v.get("video_id") or 0) < 0} for n, v in enumerate(work.get("videos") or [], start=1)],
        "kisisellestirme": [question_view(q) for q in questions],
        "ab_garanti": {k: work.get(k) for k in ("ecgt_garan_brand", "ecgt_garan_model", "ecgt_garan_years", "ecgt_garan_guarantee_details") if work.get(k)} or None,
        **inventory_summary(work),
    }

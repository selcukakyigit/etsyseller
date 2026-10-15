"""Listing envanterini (varyasyon kombinasyonları: fiyat, stok, SKU, açık/kapalı) ve varyasyon fotoğraf bağlarını doğrulayarak değiştiren
saf mantık (düzenleyicinin `work["inventory"]` yapısı). Veritabanına ya da Etsy'ye dokunmaz; asistan araçları kullanır.

Etsy kuralları burada korunur: fiyat aynı anda yalnızca TEK bir varyasyona göre değişebilir; stok ve SKU değişiyorsa hangi varyasyon(lar)a
göre değiştiği `*_on_property` listelerinde belirtilmelidir. Her değişiklikten sonra bu listeler verilerden yeniden hesaplanır."""
from app.listings.bulk import MIN_PRICE

MAX_QUANTITY = 999


def _norm(text) -> str:
    return " ".join(str(text).lower().split())


def _products(work: dict) -> list[dict]:
    return (work.get("inventory") or {}).get("products", [])


def _offerings(product: dict) -> list[dict]:
    return product.get("offerings", [])


def _value_of(product: dict, name: str) -> str | None:
    """Kombinasyonun bir varyasyondaki seçeneği (varyasyon adı büyük/küçük harf ve boşluktan bağımsız eşlenir)."""
    for pv in product.get("property_values", []):
        if _norm(pv["property_name"]) == _norm(name) and pv.get("values"):
            return pv["values"][0]
    return None


def variation_names(work: dict) -> list[str]:
    products = _products(work)
    return [pv["property_name"] for pv in products[0].get("property_values", [])] if products else []


def options(work: dict, name: str) -> list[str]:
    seen: list[str] = []
    for p in _products(work):
        value = _value_of(p, name)
        if value is not None and value not in seen:
            seen.append(value)
    return seen


def _match(product: dict, where: dict[str, str]) -> bool:
    return all((v := _value_of(product, name)) is not None and _norm(v) == _norm(option) for name, option in where.items())


def _where_error(work: dict, where: dict[str, str]) -> str | None:
    names = {_norm(n): n for n in variation_names(work)}
    for name in where:
        if _norm(name) not in names:
            return f'"{name}" bu listing\'de bir varyasyon değil. Varyasyonlar: ' + (", ".join(names.values()) or "yok (varyasyonsuz listing)")
    for name, option in where.items():
        if _norm(option) not in {_norm(o) for o in options(work, name)}:
            return f'"{option}" {name} varyasyonunda yok. Seçenekler: ' + ", ".join(options(work, name))
    return None


def _group_key(product: dict, pid: int):
    for pv in product.get("property_values", []):
        if pv["property_id"] == pid:
            return tuple(pv.get("value_ids") or []) or tuple(pv.get("values") or [])
    return None


def _determined_by(products: list[dict], pids: tuple[int, ...], getter) -> bool:
    """Değer yalnızca `pids` varyasyonlarının seçeneklerine bağlı mı (aynı seçenekleri paylaşan kombinasyonlar aynı değeri taşıyor mu)?"""
    seen: dict = {}
    for p in products:
        key = tuple(_group_key(p, pid) for pid in pids)
        value = getter(p)
        if seen.setdefault(key, value) != value:
            return False
    return True


def _price_of(product: dict):
    return tuple(o["price"]["amount"] for o in _offerings(product)) if _offerings(product) else ()


def _quantity_of(product: dict):
    return tuple(o.get("quantity") for o in _offerings(product))


def _depends_on(products: list[dict], pids: list[int], getter) -> list[int] | None:
    """Değerin bağlı olduğu en küçük varyasyon kümesi: hiç değişmiyorsa [], tek varyasyonla belirleniyorsa [id], aksi halde hepsi. Hiçbiri tutmazsa None."""
    if len({getter(p) for p in products}) <= 1:
        return []
    for pid in pids:
        if _determined_by(products, (pid,), getter):
            return [pid]
    return list(pids) if _determined_by(products, tuple(pids), getter) else None


def recompute_dependencies(work: dict) -> str | None:
    """`price_on_property`, `quantity_on_property`, `sku_on_property` listelerini ürünlerin gerçek değerlerinden yeniden kurar.
    Etsy kuralı bozulursa (fiyat birden fazla varyasyona göre değişiyorsa) hata metni döner."""
    inv = work.setdefault("inventory", {})
    products = inv.get("products", [])
    pids = [pv["property_id"] for pv in products[0].get("property_values", [])] if products else []
    if len(products) <= 1 or not pids:
        inv["price_on_property"], inv["quantity_on_property"], inv["sku_on_property"] = [], [], []
        return None
    price = _depends_on(products, pids, _price_of)
    if price is None or len(price) > 1:
        return "Fiyat aynı anda yalnızca tek bir varyasyona göre değişebilir (Etsy kuralı); kombinasyon fiyatlarını buna göre ver."
    inv["price_on_property"] = price
    inv["quantity_on_property"] = _depends_on(products, pids, _quantity_of) or pids
    skus = {p.get("sku") or "" for p in products}
    inv["sku_on_property"] = pids if len(skus) > 1 else []
    return None


def apply_inventory(
    work: dict, *, where: dict[str, str] | None = None, quantity=None, price=None, sku=None, enabled=None,
) -> tuple[list[str], list[str], int]:
    """Seçilen kombinasyonlara (where boşsa hepsine; varyasyonsuz listing'de tek ürüne) stok, fiyat, SKU ve açık/kapalı yazar.
    Döner: (değişen alanlar, hatalar, etkilenen kombinasyon sayısı)."""
    products = _products(work)
    if not products or not _offerings(products[0]):
        return [], ["Listing'de envanter satırı yok."], 0
    where = where or {}
    bad = _where_error(work, where)
    if bad:
        return [], [bad], 0
    chosen = [p for p in products if _match(p, where)]
    if not chosen:
        return [], ["Bu seçeneklerle eşleşen kombinasyon yok."], 0
    changed: list[str] = []
    errors: list[str] = []
    if quantity is not None:
        try:
            q = int(quantity)
        except (TypeError, ValueError):
            q = 0
        if not 1 <= q <= MAX_QUANTITY:
            errors.append(f"Stok 1 ile {MAX_QUANTITY} arasında bir sayı olmalı (satışı kapatmak için kombinasyonu kapat: enabled=false).")
        else:
            for p in chosen:
                for o in _offerings(p):
                    o["quantity"] = q
            changed.append("quantity")
    if price is not None:
        try:
            amount = float(price)
        except (TypeError, ValueError):
            amount = 0.0
        if amount < MIN_PRICE:
            errors.append(f"Fiyat en az {MIN_PRICE} olmalı.")
        else:
            for p in chosen:
                for o in _offerings(p):
                    o["price"] = {**(o.get("price") or {}), "amount": round(amount * 100), "divisor": 100}
            changed.append("price")
    if sku is not None:
        if len(chosen) > 1 and str(sku):
            errors.append("SKU her kombinasyonda farklı olmalı; tek bir kombinasyon seç (where) ya da SKU'yu boş ver (hepsini temizler).")
        else:
            for p in chosen:
                p["sku"] = str(sku)[:32]
            changed.append("sku")
    if enabled is not None:
        flag = bool(enabled)
        remaining = sum(1 for p in products if p not in chosen for o in _offerings(p) if o.get("is_enabled", True))
        if not flag and remaining == 0:
            errors.append("En az bir kombinasyon açık kalmalı.")
        else:
            for p in chosen:
                for o in _offerings(p):
                    o["is_enabled"] = flag
            changed.append("enabled")
    if changed:
        rule = recompute_dependencies(work)
        if rule:
            errors.append(rule)
    return changed, errors, len(chosen)


def remove_option(work: dict, name: str, option: str) -> tuple[int, str | None]:
    """Bir varyasyon seçeneğini (ve onu içeren tüm kombinasyonları) kaldırır. Döner: (kaldırılan kombinasyon, hata)."""
    bad = _where_error(work, {name: option})
    if bad:
        return 0, bad
    products = _products(work)
    keep = [p for p in products if not _match(p, {name: option})]
    if not keep:
        return 0, "Bu seçenek kaldırılırsa hiç kombinasyon kalmaz; varyasyonu kaldırmak için set_variations kullan."
    work["inventory"]["products"] = keep
    links = work.get("variation_links")
    if links and links.get("images"):
        links["images"] = {k: v for k, v in links["images"].items() if _norm(k) != _norm(option)}
    rule = recompute_dependencies(work)
    return len(products) - len(keep), rule


def link_photo(work: dict, name: str, option: str, image_id: int | None) -> str | None:
    """Varyasyon seçeneğine fotoğraf bağlar (image_id None ise bağı kaldırır). Etsy yalnızca TEK bir varyasyona fotoğraf bağlamaya izin verir."""
    bad = _where_error(work, {name: option})
    if bad:
        return bad
    products = _products(work)
    pv = next(v for v in products[0]["property_values"] if _norm(v["property_name"]) == _norm(name))
    shown = next(o for o in options(work, name) if _norm(o) == _norm(option))
    links = work.get("variation_links") or {"property_id": None, "images": {}}
    links.setdefault("images", {})
    current = links.get("property_id")
    if image_id is None:
        links["images"].pop(shown, None)
        work["variation_links"] = links
        return None
    if current not in (None, pv["property_id"]) and links["images"]:
        other = next((v["property_name"] for v in products[0]["property_values"] if v["property_id"] == current), "başka bir varyasyon")
        return f'Etsy yalnızca tek bir varyasyona fotoğraf bağlamaya izin verir; şu an "{other}" varyasyonuna bağlı. Önce onların bağlarını kaldır.'
    links["property_id"] = pv["property_id"]
    links["images"][shown] = image_id
    work["variation_links"] = links
    return None

"""Alış paketleri: malzemeyi hangi ambalajla satın aldığın (paket, rulo, koli…). Kalemde paket türü + "pakette ne kadar var" (kalemin biriminde:
strafor paketi 20 tabaka, koli bandı rulosu 100 m) tutulur; fiyat paket başına girilebilir, birim fiyatı sistem bölerek hesaplar, stok girişinde
"30 paket" yazılabilir. Liste tek yerdedir; ön yüz katalogdan okur (bkz. `material_types.catalog`)."""
from fastapi import HTTPException

from app.core.i18n import tr

# anahtar → (Türkçe, İngilizce)
PACKS: dict[str, tuple[str, str]] = {
    "pack": ("Paket", "Pack"),
    "roll": ("Rulo", "Roll"),
    "box": ("Koli", "Box"),
    "bag": ("Çuval / torba", "Bag / sack"),
    "bundle": ("Deste / bağ", "Bundle"),
    "pallet": ("Palet", "Pallet"),
    "set": ("Set", "Set"),
    "drum": ("Bidon / varil", "Drum / can"),
}


def catalog() -> list[dict]:
    return [{"key": k, "tr": tr_, "en": en} for k, (tr_, en) in PACKS.items()]


def check(key: str | None) -> str | None:
    """Paket türü anahtarı (boşsa None = kaldır); bilinmiyorsa 422."""
    if not key:
        return None
    if key not in PACKS:
        raise HTTPException(422, tr("Geçersiz paket türü", "Invalid pack type"))
    return key

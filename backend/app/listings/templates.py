"""Hazır açıklama metinleri (şablonlar).

Şablon tek bir metindir. İçindeki `{product}` satırı ürüne özel yazının (satış paragrafı, özellik maddeleri) yeridir;
yoksa ürün yazısı başa, şablon sona gelir. Yer tutucular listing'in kendi bilgisiyle dolar: {title}, {shop_name},
{materials}, {sizes}, {colors}, {variations}. Değeri boş kalan yer tutucunun bulunduğu satır atlanır (ör. bedeni
olmayan üründe "Sizes: {sizes}" satırı hiç görünmez).

Şablon uygulanırken açıklamadaki ESKİ sabit kısım ayıklanır: kayıtlı şablonların bugünkü ve önceki metinlerinin
paragraflarıyla (yer tutucular joker sayılır) ya da mağazanın listing'lerinin en az %30'unda birebir geçen paragraflarla
eşleşen paragraflar çıkarılır, geriye kalan ürün yazısı yeni şablonun içine yerleştirilir. Böylece aynı şablon iki kez
uygulanınca metin çoğalmaz ve şablon düzenlenip toplu uygulanınca eski kargo/garanti metni yenisiyle değişir.
Daha az tekrar eden paragraflar tahminle silinmez: bir mağazada kart ölçüleri, sipariş adımları gibi ÜRÜN bilgisi de
onlarca listing'de tekrar edebiliyor."""
import json
import re

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.listings.models import DescriptionTemplate
from app.shops.models import Shop

PRODUCT = "{product}"
PLACEHOLDERS = ("product", "title", "shop_name", "materials", "sizes", "colors", "variations")
NAME_MAX = 120
BODY_MAX = 20000
MAX_TEMPLATES = 50
HISTORY_MAX = 20
_PH = re.compile(r"\{(" + "|".join(PLACEHOLDERS) + r")\}")


class TemplateError(ValueError):
    pass


def out(t: DescriptionTemplate) -> dict:
    return {"id": t.id, "name": t.name, "body": t.body, "is_default": t.is_default, "updated_at": t.updated_at.isoformat() if t.updated_at else None}


def list_templates(db: Session, shop: Shop) -> list[DescriptionTemplate]:
    return list(db.scalars(select(DescriptionTemplate).where(DescriptionTemplate.shop_id == shop.id).order_by(DescriptionTemplate.is_default.desc(), DescriptionTemplate.name)))


def get(db: Session, shop: Shop, template_id: int) -> DescriptionTemplate:
    t = db.get(DescriptionTemplate, template_id)
    if t is None or t.shop_id != shop.id:
        raise TemplateError("Şablon bulunamadı")
    return t


def default(db: Session, shop: Shop) -> DescriptionTemplate | None:
    return db.scalars(select(DescriptionTemplate).where(DescriptionTemplate.shop_id == shop.id, DescriptionTemplate.is_default.is_(True))).first()


def _clean(name: str | None, body: str | None) -> tuple[str | None, str | None]:
    if name is not None:
        name = name.strip()[:NAME_MAX]
        if not name:
            raise TemplateError("Şablon adı boş olamaz")
    if body is not None:
        body = body.replace("\r\n", "\n").strip()
        if not body:
            raise TemplateError("Şablon metni boş olamaz")
        if len(body) > BODY_MAX:
            raise TemplateError("Şablon metni çok uzun")
    return name, body


def _set_default(db: Session, shop: Shop, t: DescriptionTemplate, value: bool) -> None:
    if value:
        db.execute(update(DescriptionTemplate).where(DescriptionTemplate.shop_id == shop.id, DescriptionTemplate.id != t.id).values(is_default=False))
    t.is_default = value


def create(db: Session, shop: Shop, name: str, body: str, is_default: bool = False) -> DescriptionTemplate:
    name, body = _clean(name, body)
    if len(list_templates(db, shop)) >= MAX_TEMPLATES:
        raise TemplateError("En fazla 50 şablon kaydedilebilir")
    t = DescriptionTemplate(shop_id=shop.id, name=name, body=body, is_default=False)
    db.add(t)
    db.flush()
    _set_default(db, shop, t, is_default)
    db.commit()
    return t


def edit(db: Session, shop: Shop, template_id: int, name: str | None = None, body: str | None = None, is_default: bool | None = None) -> DescriptionTemplate:
    t = get(db, shop, template_id)
    name, body = _clean(name, body)
    if name is not None:
        t.name = name
    if body is not None and body != t.body:
        history = [h for h in json.loads(t.history_json or "[]") if h != t.body] + [t.body]
        t.history_json = json.dumps(history[-HISTORY_MAX:], ensure_ascii=False)
        t.body = body
    if is_default is not None:
        _set_default(db, shop, t, is_default)
    db.commit()
    return t


def delete_many(db: Session, shop: Shop, ids: list[int]) -> int:
    rows = db.scalars(select(DescriptionTemplate).where(DescriptionTemplate.shop_id == shop.id, DescriptionTemplate.id.in_(ids))).all()
    for t in rows:
        db.delete(t)
    db.commit()
    return len(rows)


# ------------------------------------------------------------------ doldurma ve uygulama

def _values(work: dict, shop: Shop) -> dict[str, str]:
    """Yer tutucuların değerleri; varyasyonlar envanterdeki seçeneklerden okunur."""
    props: dict[str, list[str]] = {}
    for p in (work.get("inventory") or {}).get("products") or []:
        for pv in p.get("property_values") or []:
            name = str(pv.get("property_name") or "").strip()
            if not name:
                continue
            bucket = props.setdefault(name, [])
            for v in pv.get("values") or []:
                v = str(v).strip()
                if v and v not in bucket:
                    bucket.append(v)

    def pick(*keys: str) -> str:
        return ", ".join(v for name, vals in props.items() if any(k in name.lower() for k in keys) for v in vals)

    return {
        "title": str(work.get("title") or "").strip(),
        "shop_name": shop.shop_name or "",
        "materials": ", ".join(str(m) for m in work.get("materials") or [] if str(m).strip()),
        "sizes": pick("size", "boyut", "dimension", "ölçü", "olcu"),
        "colors": pick("color", "colour", "renk"),
        "variations": "\n".join(f"{name}: {', '.join(vals)}" for name, vals in props.items() if vals),
    }


def render(body: str, product: str, work: dict, shop: Shop) -> str:
    """Şablonu doldurur. `{product}` yoksa ürün yazısı başa gelir."""
    vals = _values(work, shop)
    if PRODUCT not in body:
        body = PRODUCT + "\n\n" + body
    lines = []
    for line in body.split("\n"):
        if line.strip() == PRODUCT:
            lines.append(product.strip())
            continue
        names = [m.group(1) for m in _PH.finditer(line) if m.group(1) != "product"]
        if names and not any(vals.get(n) for n in names):
            continue  # değeri olmayan yer tutucunun satırı görünmesin
        lines.append(_PH.sub(lambda m: product.strip() if m.group(1) == "product" else vals.get(m.group(1), ""), line))
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _norm(x: str) -> str:
    return re.sub(r"\s+", " ", x).strip().lower()


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()]


def _patterns(db: Session, shop: Shop, extra: tuple[str, ...] = ()) -> list[re.Pattern]:
    """Açıklamadaki sabit paragrafları tanımak için desenler: kayıtlı şablonların bugünkü ve önceki metinlerinin
    paragrafları (yer tutucu = joker), uygulanan şablonun kendisi ve mağazanın listing'lerinde çok tekrar eden paragraflar."""
    from app.assistant.tools import standard_sections  # döngüsel içe aktarmayı önlemek için burada

    bodies: list[str] = list(extra)
    for t in list_templates(db, shop):
        bodies += [t.body, *json.loads(t.history_json or "[]")]
    pats: list[re.Pattern] = []
    for body in bodies:
        for para in _paragraphs(body):
            key = _norm(para)
            if len(re.sub(r"\W", "", _PH.sub("", key))) < 3:
                continue  # yalnızca yer tutucudan oluşan paragraf her şeyle eşleşir; ürün yazısını silmesin
            parts = re.split(r"\\\{(?:" + "|".join(PLACEHOLDERS) + r")\\\}", re.escape(key))
            pats.append(re.compile(".*?".join(parts), re.S))
    for b in standard_sections(db, shop.id)["blocks"]:
        pats.append(re.compile(re.escape(_norm(b["text"]))))
    return pats


def applier(db: Session, shop: Shop, t: DescriptionTemplate):
    """Listing çalışma kopyasını alıp yeni açıklamayı dönen fonksiyon: eski sabit kısım çıkar, şablon ürün yazısının
    etrafına gelir. Desenler bir kez hazırlanır (toplu düzenlemede yüzlerce listing'e aynı şablon uygulanır)."""
    pats = _patterns(db, shop, (t.body,))

    def run(work: dict) -> str:
        kept = [p for p in _paragraphs(str(work.get("description") or "")) if not any(pat.fullmatch(_norm(p)) for pat in pats)]
        return render(t.body, "\n\n".join(kept), work, shop)

    return run

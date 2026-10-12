"""Herkese açık fiyat listesi (tanıtım sitesi): satılan kredi paketleri ve her işlemin yaklaşık kredi karşılığı. İşlem fiyatları katalogdaki model
fiyatlarından ve kredi ayarlarından canlı hesaplanır; yönetici bir fiyatı değiştirince site kendiliğinden günceller.

Metin işlemlerinin fiyatı çağrının token sayısına bağlıdır; burada her işlem için tipik bir büyüklük varsayılır (`TYPICAL_TOKENS`, gerçek kullanım
ortalamalarından), bu yüzden "yaklaşık" gösterilir. Görsel ve video fiyatı sabittir, üretimden önce kullanıcıya aynen gösterilir."""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import catalog
from app.billing import pricing
from app.billing import settings as credit_settings
from app.billing.models import BillingProduct

VIDEO_EXAMPLE_SECONDS = 5

# Görev -> (girdi token, çıktı token): gerçek kullanımdaki ortalama çağrı büyüklüğü.
TYPICAL_TOKENS = {
    "assistant": (27_000, 300),
    "seo": (4_700, 560),
    "document": (1_600, 460),
    "vision": (4_900, 90),
}
TEXT_ACTIONS = (
    ("assistant", "Asistan mesajı", "Assistant message"),
    ("seo", "SEO önerisi", "SEO suggestion"),
    ("vision", "Alt metin", "Alt text"),
    ("document", "Fatura / tablo okuma (yapay zekâlı)", "Invoice / table reading (AI)"),
)


@dataclass(frozen=True)
class Action:
    key: str
    kind: str  # text | image | video
    label_tr: str
    label_en: str
    credits: int


def _text_actions() -> list[Action]:
    out = []
    for task, tr, en in TEXT_ACTIONS:
        try:
            model = catalog.resolve(task)
        except catalog.NotConfigured:
            continue
        out.append(Action(task, "text", tr, en, pricing.for_tokens(model, *TYPICAL_TOKENS[task]).credits))
    return out


def _variant_actions() -> list[Action]:
    out = []
    try:
        image = catalog.resolve("image")
    except catalog.NotConfigured:
        image = None
    for v in image.variants if image else ():
        out.append(Action(f"image:{v.key}", "image", f"Görsel üretimi · {v.label_tr}", f"Image generation · {v.label_en}", pricing.for_units(v, 1).credits))
    try:
        video = catalog.resolve("video")
    except catalog.NotConfigured:
        video = None
    for v in video.variants if video else ():
        out.append(Action(
            f"video:{v.key}", "video", f"Video · {v.label_tr} · {VIDEO_EXAMPLE_SECONDS} sn", f"Video · {v.label_en} · {VIDEO_EXAMPLE_SECONDS} sec",
            pricing.for_units(v, VIDEO_EXAMPLE_SECONDS).credits,
        ))
    return out


def _packs(db: Session) -> list[dict]:
    """Satıştaki kredi paketleri; `bonus_pct` en küçük paketin kredi başına fiyatına göre sağlanan fazladan kredi."""
    rows = db.scalars(select(BillingProduct).where(BillingProduct.active.is_(True)).order_by(BillingProduct.price_cents, BillingProduct.id)).all()
    base = next((p.credits / p.price_cents for p in rows if p.price_cents > 0), None)
    return [
        {
            "id": p.id, "name_tr": p.name_tr, "name_en": p.name_en, "credits": p.credits, "price_cents": p.price_cents, "currency": p.currency,
            "bonus_pct": round((p.credits / p.price_cents / base - 1) * 100) if base and p.price_cents > 0 and p.credits / p.price_cents > base * 1.005 else 0,
        }
        for p in rows
    ]


def build(db: Session) -> dict:
    return {
        "enabled": credit_settings.enabled(),
        "welcome_credits": int(credit_settings.setting("signup_credits")),
        "packs": _packs(db),
        "actions": [
            {"key": a.key, "kind": a.kind, "label_tr": a.label_tr, "label_en": a.label_en, "credits": a.credits}
            for a in (*_text_actions(), *_variant_actions())
        ],
    }

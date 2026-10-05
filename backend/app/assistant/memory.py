"""Mağaza notları: asistanın sohbetler arasında hatırladığı kalıcı tercihler ve mağaza bilgileri.

Notlar mağazaya bağlıdır (mağazanın tüm kullanıcıları için geçerli), sayıca ve uzunlukça sınırlıdır ve her istekte
istemin sonunda modele verilir (bkz. prompt.shop_context). Model `remember_note` / `forget_note` araçlarıyla, kullanıcı
Ayarlar > Yapay Zekâ'dan yönetir. Vektör araması yoktur: not sayısı az olduğu için hepsi doğrudan verilir."""
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.assistant.models import AssistantMemory
from app.core.i18n import tr

MAX_NOTES = 30
MAX_CHARS = 300


@dataclass(frozen=True)
class Note:
    id: int
    text: str


class NoteError(ValueError):
    """Kullanıcıya/modele gösterilecek anlaşılır hata (boş not, sınır doldu)."""


def _clean(text: str) -> str:
    return " ".join(str(text or "").split())[:MAX_CHARS]


def list_notes(db: Session, shop_id: int) -> list[AssistantMemory]:
    return list(db.scalars(select(AssistantMemory).where(AssistantMemory.shop_id == shop_id).order_by(AssistantMemory.id)))


def notes_for_prompt(db: Session, shop_id: int) -> list[Note]:
    return [Note(m.id, m.text) for m in list_notes(db, shop_id)]


def add_note(db: Session, shop_id: int, user_id: int | None, text: str, source: str) -> AssistantMemory:
    text = _clean(text)
    if not text:
        raise NoteError(tr("Not boş olamaz.", "The note cannot be empty."))
    existing = db.scalar(select(AssistantMemory).where(AssistantMemory.shop_id == shop_id, func.lower(AssistantMemory.text) == text.lower()))
    if existing is not None:
        return existing
    count = db.scalar(select(func.count()).select_from(AssistantMemory).where(AssistantMemory.shop_id == shop_id)) or 0
    if count >= MAX_NOTES:
        raise NoteError(
            tr(
                f"En fazla {MAX_NOTES} not tutulabiliyor; önce eskilerden birini sil.",
                f"Up to {MAX_NOTES} notes can be kept; delete an old one first.",
            )
        )
    note = AssistantMemory(shop_id=shop_id, user_id=user_id, text=text, source=source)
    db.add(note)
    db.commit()
    return note


def delete_note(db: Session, shop_id: int, note_id: int) -> bool:
    n = db.execute(delete(AssistantMemory).where(AssistantMemory.shop_id == shop_id, AssistantMemory.id == note_id)).rowcount
    db.commit()
    return bool(n)


def clear_notes(db: Session, shop_id: int) -> int:
    n = db.execute(delete(AssistantMemory).where(AssistantMemory.shop_id == shop_id)).rowcount
    db.commit()
    return n or 0


def prompt_section(notes: list[Note]) -> str:
    if not notes:
        return "MAĞAZA NOTLARI: (henüz not yok)"
    lines = "\n".join(f"  - [#{n.id}] {n.text}" for n in notes)
    return f"MAĞAZA NOTLARI (kullanıcının kalıcı tercihleri; forget_note için #kimliği kullan):\n{lines}"


# ------------------------------------------------------------------ araçlar (tools.py kaydeder)

TOOLS: list[dict] = [
    {
        "name": "remember_note",
        "description": "Kullanıcının söylediği KALICI bir tercihi ya da mağaza bilgisini sonraki sohbetler için not eder (tek cümle, en fazla 300 karakter). Tek seferlik istekleri, sayıları, gizli bilgileri ve alıcıların kişisel bilgilerini not etme.",
        "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
    },
    {
        "name": "forget_note",
        "description": "Bir mağaza notunu siler (MAĞAZA NOTLARI'ndaki #kimlik). Kullanıcı unutmanı isterse ya da not artık doğru değilse kullan.",
        "input_schema": {"type": "object", "properties": {"note_id": {"type": "integer"}}, "required": ["note_id"]},
    },
]


def _remember(ctx, a: dict) -> dict:
    try:
        note = add_note(ctx.db, ctx.shop.id, ctx.user_id, a.get("text", ""), "assistant")
    except NoteError as exc:
        return {"error": str(exc)}
    return {"kaydedildi": True, "note_id": note.id, "not": note.text}


def _forget(ctx, a: dict) -> dict:
    ok = delete_note(ctx.db, ctx.shop.id, int(a.get("note_id") or 0))
    return {"silindi": ok} if ok else {"error": "Not bulunamadı."}


EXECUTORS = {"remember_note": _remember, "forget_note": _forget}
LABELS = {"remember_note": "Not alıyor", "forget_note": "Notu siliyor"}
LABELS_EN = {"remember_note": "Saving a note", "forget_note": "Deleting a note"}

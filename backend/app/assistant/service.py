"""Asistan sohbeti: oturum/mesaj kaydı ve bir sohbet isteğinin akışı (geçmiş → istem → araç döngüsü → kayıt), dashboard kartları.

Parçalar ayrı modüllerde: istem metni prompt.py, geçmiş bütçesi ve araç özetleri context.py, mağaza notları memory.py,
silme ve saklama süreleri cleanup.py, sağlayıcı döngüsü ve token sayımı llm.py."""
import datetime as dt
import html
import json
import re
import threading
import time
import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import blobstore
from app.core.i18n import tr
from app.listings import templates
from app.ai import catalog
from app.assistant import cleanup, context, llm, memory, prompt, tools
from app.assistant.models import AssistantUsage, ChatImage, ChatMessage, ChatSession
from app.billing import metering
from app.finance import service as fin
from app.listings.models import ListingCache
from app.orders.models import OrderCache
from app.shops.models import Shop

IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
# Resim dışı ekler (kargo/gümrük faturası): yapay zekâya resim olarak gitmez, read_shipping_invoice aracıyla okunur.
DOC_TYPES = {
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".html": "text/html",
    ".htm": "text/html",
}
# Dosyanın kendisi bu boyuta kadar saklanır; yapay zekâya giden resim kopyası 5 MB sınırına göre küçültülür (ai/images.py).
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_IMAGES_PER_MESSAGE = 6


# ------------------------------------------------------------------ ilerleme (asistan şu an ne yapıyor)

_progress: dict[tuple[int, str], tuple[str, float]] = {}
_progress_lock = threading.Lock()


def set_progress(shop_id: int, request_id: str | None, text: str) -> None:
    if not request_id:
        return
    with _progress_lock:
        now = time.time()
        for k in [k for k, (_, ts) in _progress.items() if now - ts > 600]:  # 10 dakikadan eski kayıtları temizle
            del _progress[k]
        _progress[(shop_id, request_id)] = (text, now)


def get_progress(shop_id: int, request_id: str) -> str:
    with _progress_lock:
        return _progress.get((shop_id, request_id), ("", 0.0))[0]


def clear_progress(shop_id: int, request_id: str | None) -> None:
    if request_id:
        with _progress_lock:
            _progress.pop((shop_id, request_id), None)


# ------------------------------------------------------------------ resimler

def save_image(db: Session, shop: Shop, session_id: int | None, filename: str, content_type: str, content: bytes) -> dict:
    """Sohbete eklenen resim ya da belge (fatura PDF'i, Excel/CSV, HTML). Tablo adı tarihsel olarak "chat_images"."""
    suffix = Path(filename or "").suffix.lower()
    if content_type in IMAGE_TYPES:
        ext = IMAGE_TYPES[content_type]
    elif suffix in DOC_TYPES:  # tarayıcılar CSV/Excel için farklı türler gönderebiliyor; uzantı esas alınır
        ext, content_type = suffix, DOC_TYPES[suffix]
    else:
        raise ValueError(tr("Yalnızca resim (JPEG, PNG, WEBP, GIF), PDF, Excel/CSV ya da HTML dosyası eklenebilir.", "Only images (JPEG, PNG, WEBP, GIF), PDF, Excel/CSV or HTML files can be attached."))
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError(tr("Dosya 15 MB'dan büyük olamaz.", "The file cannot be larger than 15 MB."))
    image_id = str(uuid.uuid4())
    path = blobstore.put(f"chat/{shop.id}/{image_id}{ext}", content, content_type)
    db.add(ChatImage(id=image_id, shop_id=shop.id, session_id=session_id, filename=(filename or "dosya")[:255], content_type=content_type, path=path))
    db.commit()
    return {"id": image_id, "filename": filename, "content_type": content_type, "url": f"/api/shops/{shop.id}/assistant/images/{image_id}"}


def get_image(db: Session, shop: Shop, image_id: str) -> ChatImage | None:
    img = db.get(ChatImage, image_id)
    return img if img is not None and img.shop_id == shop.id else None


# ------------------------------------------------------------------ oturumlar

def list_sessions(db: Session, shop: Shop, user_id: int) -> list[dict]:
    rows = db.scalars(
        select(ChatSession).where(ChatSession.shop_id == shop.id, ChatSession.user_id == user_id).order_by(ChatSession.updated_at.desc()).limit(30)
    ).all()
    return [{"id": s.id, "title": s.title, "updated_at": s.updated_at.isoformat()} for s in rows]


def _own_session(db: Session, shop: Shop, user_id: int, session_id: int) -> ChatSession | None:
    s = db.get(ChatSession, session_id)
    return s if s is not None and s.shop_id == shop.id and s.user_id == user_id else None


def _msg_out(m: ChatMessage, shop_id: int, files: dict[str, ChatImage] | None = None) -> dict:
    ids = json.loads(m.image_ids_json or "[]")

    def att(i: str) -> dict:
        f = (files or {}).get(i)
        return {
            "id": i, "url": f"/api/shops/{shop_id}/assistant/images/{i}", "filename": f.filename if f else None, "content_type": f.content_type if f else None,
            "expired": f is None or not f.path,  # saklama süresi doldu (cleanup.py) ya da dosya silindi
        }

    return {
        "id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat(),
        "images": [att(i) for i in ids],
        "cards": json.loads(m.cards_json or "[]"),
    }


def get_session(db: Session, shop: Shop, user_id: int, session_id: int) -> dict | None:
    s = _own_session(db, shop, user_id, session_id)
    if s is None:
        return None
    msgs = db.scalars(select(ChatMessage).where(ChatMessage.session_id == s.id).order_by(ChatMessage.id)).all()
    files = {f.id: f for f in db.scalars(select(ChatImage).where(ChatImage.session_id == s.id))}
    return {"id": s.id, "title": s.title, "messages": [_msg_out(m, shop.id, files) for m in msgs]}


def delete_session(db: Session, shop: Shop, user_id: int, session_id: int) -> bool:
    if _own_session(db, shop, user_id, session_id) is None:
        return False
    cleanup.delete_sessions(db, [session_id])
    return True


def delete_sessions(db: Session, shop: Shop, user_id: int, ids: list[int] | None) -> int:
    """Toplu silme: `ids` verilirse yalnızca onlar, None ise kullanıcının bu mağazadaki tüm sohbetleri. Dosyalar da silinir."""
    q = select(ChatSession.id).where(ChatSession.shop_id == shop.id, ChatSession.user_id == user_id)
    if ids is not None:
        q = q.where(ChatSession.id.in_(ids))
    owned = list(db.scalars(q))
    cleanup.delete_sessions(db, owned)
    return len(owned)


# ------------------------------------------------------------------ sohbet

def _images_prompt(imgs: list[ChatImage]) -> str:
    imgs = [i for i in imgs if i.path]  # süresi dolmuş ekler araçlara verilemez
    pics = [i for i in imgs if i.content_type in IMAGE_TYPES]
    docs = [i for i in imgs if i.content_type not in IMAGE_TYPES]
    out = ""
    if pics:
        lines = "\n".join(f'  - id="{i.id}" dosya="{i.filename}"' for i in pics)
        out += f"\nBu sohbette yüklenmiş resimler (yeni listing taslağına eklemek için create_listing_draft'ta image_ids olarak bu kimlikleri kullan; resim bir fatura ise read_shipping_invoice'a file_id olarak ver):\n{lines}"
    if docs:
        lines = "\n".join(f'  - id="{i.id}" dosya="{i.filename}"' for i in docs)
        out += f"\nBu sohbette yüklenmiş belgeler (içeriklerini göremezsin; kargo/gümrük faturasıysa read_shipping_invoice'a file_id olarak ver):\n{lines}"
    return out


# Model bazen talimata rağmen "[düzenleyici](https://www.etsy.com/listings/-1/edit)" gibi uydurma bağlantılar yazıyor; kartın
# düğmesi zaten doğru sayfaya götürüyor. Listing düzenleme bağlantıları metinden çıkarılır, bağlantı metni kalır.
_EDIT_LINK = re.compile(r"\[([^\]]+)\]\((?:https?://[^)\s]*)?/listings/-?\d+/edit\)")
_BARE_EDIT_URL = re.compile(r"https?://\S*/listings/-?\d+/edit\S*")


def _strip_app_links(text: str) -> str:
    return _BARE_EDIT_URL.sub("", _EDIT_LINK.sub(r"\1", text)).strip()


def chat(db: Session, shop: Shop, user_id: int, session_id: int | None, message: str, image_ids: list[str], today: dt.date, request_id: str | None = None, lang: str = "tr") -> dict:
    message = (message or "").strip()
    if not message and not image_ids:
        raise ValueError(tr("Mesaj boş olamaz.", "The message cannot be empty."))
    model = llm.assistant_model()
    if not catalog.ready(model):
        raise llm.AssistantError(llm.missing_key_message())

    session = _own_session(db, shop, user_id, session_id) if session_id else None
    if session is None:
        session = ChatSession(shop_id=shop.id, user_id=user_id, title=(message or tr("Resimli sohbet", "Chat with images"))[:60])
        db.add(session)
        db.commit()

    current: list[ChatImage] = []
    for iid in image_ids[:MAX_IMAGES_PER_MESSAGE]:
        img = get_image(db, shop, iid)
        if img is not None and img.path:
            img.session_id = session.id
            current.append(img)
    db.commit()

    # Geçmiş, bu mesaj kaydedilmeden ÖNCE okunur (bu mesaj ayrıca, resimleriyle birlikte gönderilir).
    recent = db.scalars(select(ChatMessage).where(ChatMessage.session_id == session.id).order_by(ChatMessage.id.desc()).limit(context.MAX_HISTORY_ROWS)).all()
    history = context.build_history(list(reversed(recent)))

    user_msg = ChatMessage(session_id=session.id, role="user", content=message, image_ids_json=json.dumps([i.id for i in current]))
    db.add(user_msg)
    db.commit()

    session_images = db.scalars(select(ChatImage).where(ChatImage.session_id == session.id).order_by(ChatImage.created_at)).all()
    ctx = tools.Ctx(db=db, shop=shop, user_id=user_id, today=today, message=message)
    dynamic = prompt.shop_context(
        shop_name=shop.shop_name, today=today.isoformat(), currency=_currency(db, shop), sections=_sections_summary(db, shop),
        examples=_title_examples(db, shop), files=_images_prompt(session_images), notes=memory.notes_for_prompt(db, shop.id), lang=lang,
    )
    en = lang == "en"
    set_progress(shop.id, request_id, "Thinking" if en else "Düşünüyor")
    tool_lines: list[str] = []

    def run_tool(name: str, args: dict) -> dict:
        set_progress(shop.id, request_id, (tools.TOOL_LABELS_EN.get(name, "Working") if en else tools.TOOL_LABELS.get(name, "Çalışıyor")))
        try:
            result = tools.execute(ctx, name, args)
            tool_lines.append(context.summarize_tool_call(name, args, result))
            return result
        finally:
            set_progress(shop.id, request_id, "Reviewing the result" if en else "Sonucu değerlendiriyor")

    try:
        result = llm.run_agent(
            model, prompt.STATIC_RULES, dynamic, history, _with_attachments(message, current),
            [{"path": i.path, "content_type": i.content_type} for i in current if i.content_type in IMAGE_TYPES],
            tools.TOOLS, run_tool,
        )
    except llm.AssistantError:
        db.delete(user_msg)  # başarısız istek geçmişe yazılmasın
        db.commit()
        clear_progress(shop.id, request_id)
        raise
    reply = _strip_app_links(result.text or "")
    assistant = ChatMessage(
        session_id=session.id, role="assistant", content=reply or tr("Bir cevap üretemedim, tekrar dener misin?", "I couldn't produce an answer, could you try again?"),
        cards_json=json.dumps(ctx.cards, ensure_ascii=False, default=str), tool_notes=context.tool_notes(tool_lines),
    )
    db.add(assistant)
    _record_usage(db, shop.id, user_id, session.id, result.usage)
    metering.record("assistant", model, result.usage.input_tokens, result.usage.output_tokens)
    clear_progress(shop.id, request_id)
    session.updated_at = dt.datetime.utcnow()
    if len(session.title) < 14 and len(message) >= 14:  # ilk mesaj "selam" gibi kısaysa başlığı anlamlı mesajdan al
        session.title = message[:60]
    db.commit()
    files = {i.id: i for i in current}
    return {"session_id": session.id, "title": session.title, "user": _msg_out(user_msg, shop.id, files), "assistant": _msg_out(assistant, shop.id)}


def _record_usage(db: Session, shop_id: int, user_id: int, session_id: int, u: llm.Usage) -> None:
    """İsteğin token kullanımı (commit, sohbet kaydıyla birlikte yapılır)."""
    db.add(AssistantUsage(
        shop_id=shop_id, user_id=user_id, session_id=session_id, provider=u.provider, model=u.model[:80], rounds=u.rounds,
        input_tokens=u.input_tokens, cached_tokens=u.cached_tokens, cache_write_tokens=u.cache_write_tokens, output_tokens=u.output_tokens,
        tools=",".join(u.tools)[:500],
    ))


def _with_attachments(message: str, current: list[ChatImage]) -> str:
    """Bu mesajın belgeleri (resim dışı) modele görünmez; adlarını ve kimliklerini mesaja not olarak ekler."""
    docs = [i for i in current if i.content_type not in IMAGE_TYPES]
    text = message or ("(dosya gönderildi)" if docs else "(resim gönderildi)")
    if docs:
        text += "\n\n[Eklenen belgeler: " + ", ".join(f'id="{d.id}" dosya="{d.filename}"' for d in docs) + "]"
    return text


def _title_examples(db: Session, shop: Shop) -> str:
    rows = db.scalars(select(ListingCache.title).where(ListingCache.shop_id == shop.id).order_by(ListingCache.views.desc()).limit(3)).all()
    return "\n".join(f"  - {html.unescape(t)}" for t in rows) or "  (örnek yok)"


def _sections_summary(db: Session, shop: Shop) -> str:
    saved = templates.list_templates(db, shop)
    if saved:
        lines = [
            f"  - #{t.id} \"{t.name}\"{' (VARSAYILAN)' if t.is_default else ''}: \"{' '.join(t.body.split())[:60]}…\""
            for t in saved
        ]
        return (
            "  Kullanıcının kaydettiği HAZIR AÇIKLAMA METİNLERİ (şablonlar). create_listing_draft varsayılanı otomatik ekler; "
            "kullanıcı başka birini isterse description_template_id ver, hiç istemezse 0. Var olan listing'e şablon uygulamak/değiştirmek "
            "için update_listing ya da bulk_update_listings'e description_template_id ver. Şablonun sabit kısmını description'a SEN YAZMA.\n"
            + "\n".join(lines)
        )
    blocks = tools.standard_sections(db, shop.id)["blocks"]
    if not blocks:
        return "  (mağazada tekrar eden sabit bölüm bulunamadı)"
    return "\n".join(f"  - ({b['count']} listing'de) \"{' '.join(b['text'].split())[:45]}\" ile başlayan sabit bölüm: SEN YAZMA" for b in blocks)


def _currency(db: Session, shop: Shop) -> str:
    row = db.execute(select(OrderCache.currency_code, func.count()).where(OrderCache.shop_id == shop.id).group_by(OrderCache.currency_code).order_by(func.count().desc())).first()
    return row[0] if row else "USD"


# ------------------------------------------------------------------ dashboard kartları

def dashboard(db: Session, shop: Shop, today: dt.date) -> dict:
    day_start = dt.datetime.combine(today, dt.time.min)
    to_ship = db.scalar(
        select(func.count()).select_from(OrderCache).where(OrderCache.shop_id == shop.id, OrderCache.is_paid.is_(True), OrderCache.is_shipped.is_(False), OrderCache.is_canceled.is_(False))
    ) or 0
    overdue = db.scalar(
        select(func.count()).select_from(OrderCache).where(
            OrderCache.shop_id == shop.id, OrderCache.is_paid.is_(True), OrderCache.is_shipped.is_(False), OrderCache.is_canceled.is_(False), OrderCache.expected_ship_date < day_start
        )
    ) or 0
    todays = db.execute(
        select(func.count(), func.coalesce(func.sum(OrderCache.grandtotal_amount / OrderCache.grandtotal_divisor), 0.0)).where(
            OrderCache.shop_id == shop.id, OrderCache.created_at >= day_start, OrderCache.is_canceled.is_(False)
        )
    ).one()
    month_start = today.replace(day=1)
    r = fin.report(db, shop, month_start, today, compare=[1])
    k, p = r["kpi"], r["prev_kpi"]
    return {
        "currency": r["currency"],
        "today": {"orders": todays[0], "sales": round(float(todays[1]), 2)},
        "to_ship": to_ship,
        "overdue": overdue,
        "month": {
            "label": month_start.strftime("%Y-%m"), "sales": round(k["sales"], 2), "orders": k["orders"], "profit": round(k["profit"], 2),
            "fees": round(k["fees"], 2), "cogs": round(k["cogs"], 2), "prev_sales": round(p["sales"], 2), "prev_orders": p["orders"], "prev_profit": round(p["profit"], 2),
            "costs_entered": k["cogs"] > 0,
        },
    }

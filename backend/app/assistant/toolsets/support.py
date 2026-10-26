"""Destek talebi: Yardım & Destek ekranıyla aynı servis (support/service.py), aynı hız sınırları ve aynı numaralı talep.
Asistan talebi kullanıcı adına açar: önce ne gönderileceğini gösterir, kullanıcı onaylayınca açar (confirm=true).
Sohbetin son mesajları talebin bağlamına, seçilen sohbet resimleri ek olarak eklenir; yönetici ikisini de talepte görür."""
import logging

from fastapi import HTTPException
from sqlalchemy import select

from app.assistant.models import ChatImage, ChatMessage
from app.auth.models import User
from app.core import blobstore
from app.core.attachments import validate_file
from app.core.i18n import tr
from app.support import service, taxonomy
from app.support.models import Ticket

log = logging.getLogger("app.assistant.support")

CHAT_LINE_CHARS = 600
IMAGE_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
STATUS_TEXT = {"open": ("İnceleniyor", "Under review"), "waiting_user": ("Kullanıcının yanıtı bekleniyor", "Waiting for the user"), "resolved": ("Tamamlandı", "Done")}


def _chat_lines(ctx) -> list[str]:
    """Bu sohbetin son mesajları, eskiden yeniye ("Kullanıcı: …" / "Asistan: …")."""
    if ctx.session_id is None:
        return []
    rows = ctx.db.scalars(select(ChatMessage).where(ChatMessage.session_id == ctx.session_id).order_by(ChatMessage.id.desc()).limit(service.MAX_CHAT_LINES)).all()
    return [f"{'Kullanıcı' if m.role == 'user' else 'Asistan'}: {' '.join((m.content or '').split())[:CHAT_LINE_CHARS]}" for m in reversed(rows) if m.content]


def _chat_images(ctx, ids: list[str]) -> list[tuple[str, str, bytes]]:
    """Seçilen sohbet resimleri (yalnızca bu sohbetin ve bu mağazanın; saklama süresi dolmuşlar atlanır)."""
    out: list[tuple[str, str, bytes]] = []
    for image_id in dict.fromkeys(ids):
        img = ctx.db.get(ChatImage, str(image_id))
        ext = IMAGE_EXT.get(img.content_type) if img else None
        if img is None or img.shop_id != ctx.shop.id or img.session_id != ctx.session_id or not img.path or not ext:
            continue
        try:
            out.append(validate_file(f"sohbet-resmi-{len(out) + 1}.{ext}", blobstore.read(img.path)))
        except (FileNotFoundError, HTTPException):
            log.warning("Sohbet resmi talebe eklenemedi: %s", image_id)
    return out[: service.MAX_FILES]


def open_support_ticket(ctx, a: dict) -> dict:
    subject, body = " ".join(str(a.get("subject") or "").split()), str(a.get("body") or "").strip()
    category = a.get("category") if a.get("category") in taxonomy.CATEGORIES else "question"
    if len(subject) < 3 or len(body) < 5:
        return {"error": tr("Konu (en az 3 karakter) ve açıklama (en az 5 karakter) gerekli.", "A subject (3+ characters) and a description (5+ characters) are required.")}
    chat = _chat_lines(ctx) if a.get("include_chat", True) else []
    images = _chat_images(ctx, list(a.get("image_ids") or []))
    if not a.get("confirm"):
        return {
            "pending_confirmation": True, "konu": subject[:160], "tur": category, "aciklama": body[:1000], "eklenecek_sohbet_mesaji": len(chat), "eklenecek_resim": len(images),
            "not": tr(
                "Henüz talep AÇILMADI. Konuyu, açıklamayı ve neyin ekleneceğini (sohbetin son mesajları, resimler) kullanıcıya göster; AÇIKÇA onaylarsa (evet/aç/gönder) aynı bilgilerle confirm=true vererek TEKRAR çağır. Onaylamadıysa çağırma.",
                "The request is NOT opened yet. Show the user the subject, the description and what will be attached (recent chat messages, images); if they explicitly confirm (yes/open/send) call again with the same data and confirm=true. Never call it otherwise.",
            ),
        }
    user = ctx.db.get(User, ctx.user_id)
    context = {"shop": ctx.shop.shop_name, "lang": getattr(user, "email_lang", ""), "chat": chat}
    try:
        ticket = service.create_ticket(ctx.db, user, subject, category, body, service.clean_context(context), images, source="assistant")
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    try:
        service.notify_team(ticket.id, ticket.subject, user.email, body, "new")
    except Exception:  # noqa: BLE001 — bildirim e-postası talebin açılmasını bozmamalı
        log.exception("Ekip bildirimi gönderilemedi (talep #%s)", ticket.id)
    return {
        "talep_no": ticket.id, "eklenen_resim": len(images), "eklenen_sohbet_mesaji": len(chat),
        "not": tr(
            f"Talep #{ticket.id} açıldı; ekip bilgilendirildi. Kullanıcıya numarayı söyle ve yanıtı Yardım & Destek sayfasından (ve e-postayla) göreceğini belirt.",
            f"Request #{ticket.id} was opened and the team was notified. Tell the user the number and that they will see the reply on the Help & Support page (and by email).",
        ),
    }


def my_support_tickets(ctx, a: dict) -> dict:
    """Kullanıcının kendi talepleri; `ticket_id` verilirse o talebin yazışması (iç notlar dahil değil)."""
    user = ctx.db.get(User, ctx.user_id)
    if a.get("ticket_id"):
        t: Ticket | None = ctx.db.scalar(select(Ticket).where(Ticket.id == int(a["ticket_id"]), Ticket.user_id == user.id))
        if t is None:
            return {"error": tr("Bu numarada senin bir talebin yok.", "You have no request with that number.")}
        detail = service.user_detail(service.user_ticket(ctx.db, user, t.id))
        return {
            "talep_no": t.id, "konu": t.subject, "durum": tr(*STATUS_TEXT[t.status]),
            "mesajlar": [{"yazan": "kullanıcı" if m["author"] == "user" else "destek ekibi", "tarih": m["created_at"][:16], "metin": m["body"][:800]} for m in detail["messages"][-6:]],
        }
    return {"talepler": [{"talep_no": r["id"], "konu": r["subject"], "durum": tr(*STATUS_TEXT[r["status"]]), "guncelleme": r["updated_at"][:16]} for r in service.list_for_user(ctx.db, user)[:10]]}


TOOLS: list[dict] = [
    {
        "name": "open_support_ticket",
        "description": "ONAY GEREKİR. Kullanıcı adına destek talebi açar (Yardım & Destek ekranıyla aynı; numara alır, ekibe bildirilir, yanıt orada görünür). Kullanıcı bir hata/sorun bildirmek, ekibe yazmak ya da 'bunu destek ekibine ilet' dediğinde kullan; yapabildiğin bir şeyi önce kendin çöz. confirm=true verilmeden talep AÇILMAZ, yalnızca ne gönderileceğini özetler. Sohbetin son mesajları ve seçilen sohbet resimleri otomatik eklenir. Kredi harcamaz.",
        "input_schema": {"type": "object", "properties": {
            "subject": {"type": "string", "description": "Kısa konu (en çok 160 karakter), kullanıcının dilinde"},
            "category": {"type": "string", "enum": list(taxonomy.CATEGORIES), "description": "bug = hata/sorun, question = soru, feature = özellik isteği, billing = fatura/ödeme/kredi, other = diğer"},
            "body": {"type": "string", "description": "Sorunun açık anlatımı: ne oldu, ne yapmaya çalışıyordu, hangi ekran/listing/sipariş (kimlik numaralarıyla). Kullanıcının söylemediğini uydurma."},
            "image_ids": {"type": "array", "items": {"type": "string"}, "description": "Talebe eklenecek bu sohbetteki resim kimlikleri (en çok 5; ekran görüntüsü gibi)"},
            "include_chat": {"type": "boolean", "description": "Sohbetin son mesajlarını bağlama ekle (varsayılan true)"},
            "confirm": {"type": "boolean"},
        }, "required": ["subject", "body"]},
    },
    {
        "name": "my_support_tickets",
        "description": "Kullanıcının kendi destek taleplerinin durumu: son talepler ve numaraları; ticket_id verilirse o talebin son yazışması ('talebim ne oldu', '#12 yanıtlandı mı').",
        "input_schema": {"type": "object", "properties": {"ticket_id": {"type": "integer"}}, "required": []},
    },
]
EXECUTORS = {"open_support_ticket": open_support_ticket, "my_support_tickets": my_support_tickets}
LABELS = {"open_support_ticket": "Destek talebini hazırlıyor", "my_support_tickets": "Destek taleplerine bakıyor"}
LABELS_EN = {"open_support_ticket": "Preparing the support request", "my_support_tickets": "Checking your support requests"}

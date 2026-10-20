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
from app.core.uploads import MAX_VIDEO_BYTES
from app.listings import creation, templates
from app.ai import catalog
from app.assistant import cleanup, context, llm, memory, progress, prompt, tools
from app.assistant.models import AssistantUsage, ChatImage, ChatMessage, ChatSession
from app.billing import metering
from app.finance import service as fin
from app.listings.models import ListingCache
from app.notifications.summary import order_snapshot
from app.orders.models import OrderCache
from app.shops.models import Shop

IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
# Kullanıcının kendi videosu: yapay zekâya gitmez, yalnızca listing taslağına eklenir (Etsy: en fazla 100 MB).
VIDEO_TYPES = {"video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-m4v": ".m4v"}
VIDEO_EXT = {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/x-m4v"}
# Resim dışı ekler (kargo/gümrük faturası): yapay zekâya resim olarak gitmez, read_shipping_invoice aracıyla okunur.
DOC_TYPES = {
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".html": "text/html",
    ".htm": "text/html",
    # Dijital ürün dosyaları (Etsy dijital listing'e eklenir; içeriklerini asistan görmez):
    ".zip": "application/zip", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".svg": "image/svg+xml", ".eps": "application/postscript",
    ".psd": "image/vnd.adobe.photoshop", ".ai": "application/illustrator", ".epub": "application/epub+zip", ".txt": "text/plain",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ttf": "font/ttf", ".otf": "font/otf", ".dxf": "application/dxf", ".stl": "model/stl", ".json": "application/json",
}
# Dosyanın kendisi bu boyuta kadar saklanır; yapay zekâya giden resim kopyası 5 MB sınırına göre küçültülür (ai/images.py).
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # Etsy dijital dosya sınırı (listing/video dosyaları ayrı sınırlıdır)
MAX_IMAGES_PER_MESSAGE = creation.MAX_LISTING_IMAGES
# Modele en fazla bu kadar resim gösterilir (maliyet ve bellek); geri kalanı yalnızca listing'e eklenir.
MODEL_IMAGES_PER_MESSAGE = 4
MAX_STALL_RETRIES = 2  # model onay isteyip işi yapmazsa en fazla bu kadar kez "şimdi yap" diye yeniden çalıştırılır


# ------------------------------------------------------------------ ilerleme (asistan şu an ne yapıyor)

# (adım metni, zaman, iş türü: "image" | "video" | None, şimdiye kadar üretilen kartlar). Kartlar yanıt bitmeden gösterilir:
# üretilen resim, asistanın son cümlesini yazmasını beklemez.
_progress: dict[tuple[int, str], tuple[str, float, str | None, list[dict], list[str]]] = {}
_progress_lock = threading.Lock()
MAX_TRAIL = 60  # bir istekte tutulan adım yazısı sayısı


def set_progress(shop_id: int, request_id: str | None, text: str, kind: str | None = None, cards: list[dict] | None = None) -> None:
    """`text` adım geçmişine (trail) eklenir: istemci hızlı geçen adımları da sırayla, okunacak hızda gösterir."""
    if not request_id:
        return
    with _progress_lock:
        now = time.time()
        for k in [k for k, v in _progress.items() if now - v[1] > 600]:  # 10 dakikadan eski kayıtları temizle
            del _progress[k]
        _, _, _, old_cards, trail = _progress.get((shop_id, request_id), ("", 0.0, None, [], []))
        if not trail or trail[-1] != text:
            trail = [*trail, text][-MAX_TRAIL:]
        _progress[(shop_id, request_id)] = (text, now, kind, list(cards) if cards is not None else old_cards, trail)


def get_progress(shop_id: int, request_id: str) -> dict:
    with _progress_lock:
        text, _, kind, cards, trail = _progress.get((shop_id, request_id), ("", 0.0, None, [], []))
    return {"step": text, "kind": kind, "cards": cards, "trail": trail}


def clear_progress(shop_id: int, request_id: str | None) -> None:
    if request_id:
        with _progress_lock:
            _progress.pop((shop_id, request_id), None)


# ------------------------------------------------------------------ resimler

def save_image(db: Session, shop: Shop, session_id: int | None, filename: str, content_type: str, content: bytes) -> dict:
    """Sohbete eklenen resim ya da belge (fatura PDF'i, Excel/CSV, HTML). Tablo adı tarihsel olarak "chat_images"."""
    suffix = Path(filename or "").suffix.lower()
    limit = MAX_UPLOAD_BYTES
    if content_type in IMAGE_TYPES:
        ext = IMAGE_TYPES[content_type]
    elif content_type in VIDEO_TYPES or suffix in VIDEO_EXT:
        ext = VIDEO_TYPES.get(content_type) or suffix
        content_type, limit = content_type if content_type in VIDEO_TYPES else VIDEO_EXT[suffix], MAX_VIDEO_BYTES
    elif suffix in DOC_TYPES:  # tarayıcılar CSV/Excel için farklı türler gönderebiliyor; uzantı esas alınır
        ext, content_type = suffix, DOC_TYPES[suffix]
    else:
        raise ValueError(tr("Yalnızca resim, video (MP4, MOV, WEBM), PDF, Excel/CSV, HTML ya da dijital ürün dosyası (ZIP, DOCX, SVG…) eklenebilir.", "Only images, videos (MP4, MOV, WEBM), PDF, Excel/CSV, HTML or digital product files (ZIP, DOCX, SVG…) can be attached."))
    if len(content) > limit:
        raise ValueError(tr(f"Dosya {limit // (1024 * 1024)} MB'dan büyük olamaz.", f"The file cannot be larger than {limit // (1024 * 1024)} MB."))
    image_id = str(uuid.uuid4())
    path = blobstore.put(f"chat/{shop.id}/{image_id}{ext}", content, content_type)
    db.add(ChatImage(id=image_id, shop_id=shop.id, session_id=session_id, filename=(filename or "dosya")[:255], content_type=content_type, path=path))
    db.commit()
    return {"id": image_id, "filename": filename, "content_type": content_type, "url": f"/api/shops/{shop.id}/assistant/images/{image_id}"}


def get_image(db: Session, shop: Shop, image_id: str) -> ChatImage | None:
    img = db.get(ChatImage, image_id)
    return img if img is not None and img.shop_id == shop.id else None


def delete_image(db: Session, shop: Shop, image_id: str) -> bool:
    """Sohbetteki bir resmi (ör. üretilen) siler. Bir listing taslağına eklenmişse oradaki kopya ayrıdır, etkilenmez."""
    img = get_image(db, shop, image_id)
    if img is None:
        return False
    if img.path:
        blobstore.remove([img.path])
    db.delete(img)
    db.commit()
    return True


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
    vids = [i for i in imgs if i.content_type in VIDEO_TYPES]
    docs = [i for i in imgs if i.content_type not in IMAGE_TYPES and i.content_type not in VIDEO_TYPES]
    out = ""
    if vids:
        lines = "\n".join(f'  - id="{i.id}" dosya="{i.filename}"' for i in vids)
        out += f"\nBu sohbette yüklenmiş KULLANICI VİDEOLARI (içeriğini göremezsin; yeni taslakta create_listing_draft'ın video_ids alanına, var olan listing'e add_video_to_listing'in chat_video_id alanına ver; en fazla 2 video):\n{lines}"
    if pics:
        lines = "\n".join(f'  - id="{i.id}" dosya="{i.filename}"' for i in pics)
        out += f"\nBu sohbette yüklenmiş resimler (yeni listing taslağına eklemek için create_listing_draft'ta image_ids olarak bu kimlikleri kullan; resim bir fatura ise read_shipping_invoice'a file_id olarak ver):\n{lines}"
    if docs:
        lines = "\n".join(f'  - id="{i.id}" dosya="{i.filename}"' for i in docs)
        out += f"\nBu sohbette yüklenmiş belgeler (içeriklerini göremezsin; kargo/gümrük faturasıysa read_shipping_invoice'a file_id olarak ver; dijital ürünün indirilebilir dosyasıysa create_listing_draft.digital_file_ids ya da add_digital_file'a ver):\n{lines}"
    return out


_LISTING_WORDS = re.compile(
    r"liste\w*|listing|taslak|başlı[kğ]|etiket|varyasyon|stok|fiyat|kırp|resim|resm|fotoğraf|görsel|video|kişiselleştir|açıklama|kategori|özellik|alt metin|yayın[l]?a|yayımla|sku|boyut|renk|"
    r"title|tags?\b|photo|variation|draft|crop|image|personaliz|description|pinterest|\bpin\b|sosyal|hashtag|rakip|piyasa|trend|toplu|holiday|occasion", re.IGNORECASE)
_OTHER_WORDS = re.compile(
    r"sipariş|kargo|fatura|kâr\b|zarar|satış|gelir|ciro|reklam|finans|müşteri|yorum|sıralama|rakip|ülke|rapor|maliyet|performans|"
    r"order|profit|revenue|shipping|invoice|sales|review|\bads?\b", re.IGNORECASE)


_DIGITAL_WORDS = re.compile(r"dijital|digital|printable|indirilebilir|download|şablon|template", re.IGNORECASE)


def _pick_mode(message: str, current: list[ChatImage], last_tool_notes: str | None) -> str:
    """"listing": listing oluştur/düzenle konuşuluyor (resim/video yüklendi ya da listing sözcükleri, sipariş/finans sözcüğü yok) ya da kısa bir devam
    mesajı ve önceki tur listing araçları kullanmış. Emin değilse "all" (hiçbir araç/kural eksilmez). Model çağırmaz."""
    if any(i.content_type not in IMAGE_TYPES and i.content_type not in VIDEO_TYPES for i in current) and not _DIGITAL_WORDS.search(message):
        return "all"  # fatura/belge: analiz araçları gerekir (dijital ürün dosyası olduğu söylenmişse listing modu)
    other = bool(_OTHER_WORDS.search(message))
    if other:
        return "all"
    if current or _LISTING_WORDS.search(message):
        return "listing"
    if last_tool_notes and any(name in last_tool_notes for name in tools.LISTING_TOOL_NAMES):
        return "listing"  # "evet", "c ve a yap" gibi devam mesajı
    return "all"


_TOOL_NAME = re.compile(r"(?<![A-Za-z_])(?:" + "|".join(re.escape(n) for n in sorted(tools.EXECUTORS, key=len, reverse=True)) + r")(?![A-Za-z_])")


# "Hemen başlıyorum / üreteceğim" deyip hiçbir araç çağırmamak (boş söz): bir kez gerçekten yapması istenir.
_EMPTY_PROMISE = re.compile(r"\b(?:hemen )?(?:başlıyorum|başlayayım|başlıyoruz|üreteceğim|oluşturacağım|hazırlayacağım|yapacağım|ekleyeceğim|uygulayacağım)\b")


def _claims_tool_use(text: str) -> bool:
    """Cevap araç adı ya da "araç özeti" taklidi içeriyor mu (araç çağrılmadan "yaptım" demenin işareti)?"""
    low = text.lower()
    return bool(_TOOL_NAME.search(text)) or "araç çıktısına göre" in low or "araç özeti" in low or bool(_EMPTY_PROMISE.search(low))


# Açık bir istek varken kullanıcıdan onay/seçim istemek ("onaylıyor musun", "tek kelimeyle onay yaz", "hangi yolu uygulayayım"): kullanıcı bunlardan bıkıyor.
_ASKS_CONFIRMATION = re.compile(
    r"onayl[ıi]yor musun|onay(?:la|lar[ıi]n[ıi]z|lars[ıa]n|\s+ver|\s+yaz)|kabul ediyor musun|kabul ediyorsan|tek kelimeyle|hangi(?:sini| yolu| adımı)|"
    r"yap[ae]yım m[ıi]|oluşturay[ıi]m m[ıi]|deneyeyim m[ıi]|\bse[çc]\b|are you sure|do you confirm|shall i|which (?:one|option)", re.IGNORECASE)

# Etsy'ye gerçekten giden / geri dönüşü zor işler: bunlarda onay istemek doğrudur, ısrar edilmez.
_CONFIRM_TOOLS = frozenset({"publish_listing_draft", "deactivate_listing", "mark_order_shipped", "delete_listing", "discard_listing_changes", "generate_listing_video", "rewrite_listings", "bulk_update_listings"})

_STALL_NOTE = (
    "\n\n[SİSTEM NOTU: Önceki denemende kullanıcıdan onay/seçim istedin işi yapmadan 'başlıyorum' dedin ya da yazma aracı çağırmadan 'güncelledim/ekledim' dedin (araç sonucunu görmeden yapıldı denmez). Kullanıcının isteği zaten açık ve onaylı; "
    "tekrar sorma. Eksik ayrıntıları (renk yazımı, malzeme, başlık, etiket, açıklama, kategori, ölçü formatı) kendin makul biçimde tamamla, araç hatalarını "
    "kendin düzelt ve ilgili araçları ŞİMDİ çağır. Yalnızca gerçekten bilinemeyen şey (ör. fiyat) boş kalabilir. Resim isteniyse generate_chat_image / "
    "edit_chat_image'ı çağır, taslak isteniyse create_listing_draft'ı çağır. Cevapta araç adı geçirme, soru sorma; yaptığını kısaca söyle.]"
)


# Yazma aracı çağırmadan "güncelledim / ekledim" demek (sahte tamamlama): test turlarında model 13 düzenlemenin yarısını yapmadan yaptım dedi.
_DONE_CLAIM = re.compile(
    r"\b(?:güncelledim|ekledim|değiştirdim|yaptım|ayarladım|çıkardım|kaldırdım|artırdım|arttırdım|azalttım|düzelttim|oluşturdum|kısalttım|taşıdım|sildim|uyguladım|yazdım|kaydettim|"
    r"güncellendi|ayarlandı|eklendi|kaydedildi|değiştirildi|yapıldı|kaldırıldı|oluşturuldu|artırıldı|kısaltıldı|uygulandı|düzeltildi|silindi|başarıyla eklendi|"
    r"i(?:'ve)? (?:updated|added|changed|removed|set|created|fixed))\b", re.IGNORECASE)
_READ_ONLY_TOOLS = frozenset({
    "find_category", "shop_defaults", "similar_listings", "keyword_pool", "shop_options", "search_listings", "get_listing", "get_category_attributes", "workspace_status",
    "market_research", "suggest_price", "listing_health_status", "generation_options", "list_description_templates", "personalization_library", "ask_user",
})


def _stalled(text: str, called: set[str], failed: bool, effective: int) -> bool:
    """Model işi bitirmek yerine kullanıcıdan onay mı bekliyor? (Onay gerektiren araç çağrıldıysa bu meşrudur.)"""
    if called & _CONFIRM_TOOLS or "ask_user" in called:
        return False  # onay gerektiren iş ya da seçenek kartı: kullanıcının cevabı beklenir
    if not called:
        return bool(_ASKS_CONFIRMATION.search(text) or _claims_tool_use(text) or _DONE_CLAIM.search(text))
    if effective == 0 and _DONE_CLAIM.search(text):
        return True  # "yaptım" dendi ama hiçbir araç gerçekten bir şey değiştirmedi
    return failed  # son araç hata verdiyse iş bitmemiştir (cevap "tekrar deneyeceğim" ya da soru da olsa)


# Model bazen talimata rağmen "[düzenleyici](https://www.etsy.com/listings/-1/edit)" gibi uydurma bağlantılar yazıyor; kartın
# düğmesi zaten doğru sayfaya götürüyor. Listing düzenleme bağlantıları metinden çıkarılır, bağlantı metni kalır.
_EDIT_LINK = re.compile(r"\[([^\]]+)\]\((?:https?://[^)\s]*)?/listings/-?\d+/edit\)")
_BARE_EDIT_URL = re.compile(r"https?://\S*/listings/-?\d+/edit\S*")


# Bazı modeller istemin "MAĞAZA BİLGİLERİ" bölümünü cevabın sonuna kopyalıyor; kullanıcıya gösterilmez.
_LEAKED_CONTEXT = re.compile(r"\n[ \t]*(?:MAĞAZA BİLGİLERİ|SİSTEM BAĞLAMI|STORE INFORMATION|SHOP INFORMATION)\b.*\Z", re.DOTALL | re.IGNORECASE)


# Model kendini tanıtıyor ("Ben Ulagg. İstediğini yaptım — kısa özet:" / sonda "Ben Ulagg — onayınızı bekliyorum"): cevaptan atılır.
_PERSONA_LEAD = re.compile(r"^\s*(?:Ben\s+)?Ulagg\s*[.,!:—–-]+\s*", re.IGNORECASE)
_PERSONA_TAIL = re.compile(r"\n+[ \t]*(?:Ben\s+)?Ulagg\s*[—–-].*\Z", re.IGNORECASE | re.DOTALL)
_SUMMARY_LEAD = re.compile(r"^[^\n]{0,60}?(?:—|-)\s*kısa özet\s*(?:\([^)]*\))?\s*:\s*", re.IGNORECASE)


def _strip_app_links(text: str) -> str:
    text = _LEAKED_CONTEXT.sub("", _BARE_EDIT_URL.sub("", _EDIT_LINK.sub(r"\1", text))).strip()
    text = _PERSONA_TAIL.sub("", _PERSONA_LEAD.sub("", text)).strip()
    return _SUMMARY_LEAD.sub("", text).strip()


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
    ctx = tools.Ctx(db=db, shop=shop, user_id=user_id, today=today, message=message, session_id=session.id)
    dynamic = prompt.shop_context(
        shop_name=shop.shop_name, today=today.isoformat(), currency=_currency(db, shop), sections=_sections_summary(db, shop),
        examples=_title_examples(db, shop), files=_images_prompt(session_images), notes=memory.notes_for_prompt(db, shop.id), lang=lang,
    )
    en = lang == "en"
    set_progress(shop.id, request_id, "Thinking" if en else "Düşünüyor")
    tool_lines: list[str] = []
    called: set[str] = set()  # bu istekte çağrılan araçlar
    failed = False  # son araç çağrısı hata döndürdü mü ya da hiçbir şeyi değiştirmedi mi
    effective = 0  # gerçekten bir şey değiştiren (doğrulanmış) araç çağrısı sayısı
    last_error: list[str] = []  # o hatanın metni (yeniden denemede modele söylenir)

    def run_tool(name: str, args: dict) -> dict:
        nonlocal failed, effective
        lines = progress.steps_for(db, shop.id, name, args, en) or [tools.TOOL_LABELS_EN.get(name, "Working") if en else tools.TOOL_LABELS.get(name, "Çalışıyor")]
        for line in lines:
            set_progress(shop.id, request_id, line, tools.TOOL_KIND.get(name))
        called.add(name)
        try:
            before = tools.listing_fingerprint(ctx, args) if name in tools.WRITE_TOOLS else None
            result = tools.execute(ctx, name, args)
            failed = bool(result.get("error")) if isinstance(result, dict) else False
            if name in tools.WRITE_TOOLS:
                if not failed and before is not None and tools.listing_fingerprint(ctx, args) == before and effective > 0:
                    result = {**result, "degisiklik_yok": True, "not": "Taslak bu turda zaten değişti (istenen büyük olasılıkla uygulanmış); yeniden yazma, gerekirse get_listing ile doğrula."}
                elif not failed and before is not None and tools.listing_fingerprint(ctx, args) == before:
                    # Araç "tamam" dese de taslak hiç değişmedi: model bunu yapıldı diye sunamasın.
                    result = {**result, "degisiklik_yok": True, "UYARI": "Bu çağrı taslakta HİÇBİR şeyi değiştirmedi (değer zaten böyleydi ya da araç/alan yanlış). get_listing ile gerçek durumu oku: istenen zaten uygulanmışsa bunu söyle; değilse doğru aracı/alanı bulup yeniden dene; olmuyorsa yapamadığını söyle. Değişiklik görmeden yapıldı DEME."}
                    failed = True
                    last_error[:] = [result["UYARI"]]
                elif not failed:
                    effective += 1
            elif name not in _READ_ONLY_TOOLS and not failed:
                effective += 1  # diğer yazma/üretim araçları (taslak oluşturma, resim, toplu işlem…)
            if failed:
                last_error[:] = [str(result["error"])[:700]]
            tool_lines.append(context.summarize_tool_call(name, args, result))
            return result
        finally:
            set_progress(shop.id, request_id, "Reviewing the result" if en else "Sonucu değerlendiriyor", None, ctx.cards)

    run_tool.prepare = lambda calls: tools.prefetch_images(ctx, calls)  # aynı turdaki birden çok görsel üretimi paralel başlar

    last_notes = next((m.tool_notes for m in recent if m.role == "assistant"), None)
    mode = _pick_mode(message, current, last_notes)
    groups = tools.listing_groups(message, last_notes) if mode == "listing" else frozenset()
    try:
        result = llm.run_agent(
            model, prompt.static_rules(mode, groups), dynamic, history, _with_attachments(message, current),
            [{"path": i.path, "content_type": i.content_type} for i in current if i.content_type in IMAGE_TYPES][:MODEL_IMAGES_PER_MESSAGE],
            tools.tools_for(mode, groups), run_tool,
        )
    except llm.AssistantError:
        db.delete(user_msg)  # başarısız istek geçmişe yazılmasın
        db.commit()
        clear_progress(shop.id, request_id)
        raise
    for _ in range(MAX_STALL_RETRIES):
        # Model işi yapmadan "başlıyorum" dedi, araç çağırmadan "yaptım" diye anlattı ya da hata sonrası kullanıcıdan onay istedi: gerçekten yapması istenir.
        if not _stalled(result.text or "", called, failed, effective):
            break
        _record_usage(db, shop.id, user_id, session.id, result.usage)
        metering.record("assistant", model, result.usage.input_tokens, result.usage.output_tokens)
        try:
            result = llm.run_agent(
                model, prompt.static_rules(mode, groups), dynamic, history, _with_attachments(message, current) + _STALL_NOTE + (f"\n[Son araç hatası, bunu düzelt: {last_error[0]}]" if failed and last_error else ""),
                [{"path": i.path, "content_type": i.content_type} for i in current if i.content_type in IMAGE_TYPES][:MODEL_IMAGES_PER_MESSAGE],
                tools.tools_for(mode, groups), run_tool,
            )
        except llm.AssistantError:
            db.delete(user_msg)
            db.commit()
            clear_progress(shop.id, request_id)
            raise
    tools.auto_choices(ctx)
    reply = _strip_app_links(result.text or "")
    if effective == 0 and _DONE_CLAIM.search(reply) and not (called & _CONFIRM_TOOLS):
        # Denemelere rağmen hiçbir şey değişmedi ama model "yaptım" diyor: yalan kullanıcıya gösterilmez.
        reply = tr(
            "Bu değişikliği taslağa uygulayamadım; ilgili araç bir şeyi değiştirmedi. İstersen farklı bir yolla yeniden deneyeyim ya da editörden yapabilirsin.",
            "I could not apply that change to the draft; the tool did not change anything. I can try another way, or you can do it in the editor.",
        )
    ctx.cards.sort(key=lambda c: {"listing_draft": 1, "choices": 2}.get(c.get("type"), 0))  # güncel listing kartı(ları) cevabın en altında (sıra korunur)
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


def autofill_attributes(db: Session, shop: Shop, user_id: int, today: dt.date, listing_id: int, form: dict) -> dict:
    """Düzenleyicideki AI önerisinin devamı: forma yazılmış (henüz kaydedilmemiş) metinle kategorinin boş özelliklerini asistanın kullandığı
    aynı hat doldurur (tools._autofill_in_work). Hiçbir şey kaydetmez; yeni özellik listesini döner, düzenleyici forma yazar."""
    import copy

    ctx = tools.Ctx(db=db, shop=shop, user_id=user_id, today=today)
    work = copy.deepcopy(tools._draft_work(ctx, listing_id))
    work.update({k: form[k] for k in ("title", "description", "tags", "materials", "properties") if form.get(k) is not None})
    changed, errors = tools._autofill_in_work(ctx, listing_id, work)
    return {"properties": work.get("properties", []), "managed_property_ids": work.get("managed_property_ids", []), "filled": changed, "errors": errors}


def _record_usage(db: Session, shop_id: int, user_id: int, session_id: int, u: llm.Usage) -> None:
    """İsteğin token kullanımı (commit, sohbet kaydıyla birlikte yapılır)."""
    db.add(AssistantUsage(
        shop_id=shop_id, user_id=user_id, session_id=session_id, provider=u.provider, model=u.model[:80], rounds=u.rounds,
        input_tokens=u.input_tokens, cached_tokens=u.cached_tokens, cache_write_tokens=u.cache_write_tokens, output_tokens=u.output_tokens,
        tools=",".join(u.tools)[:500],
    ))


def _with_attachments(message: str, current: list[ChatImage]) -> str:
    """Bu mesajın belgeleri (resim dışı) modele görünmez; adlarını ve kimliklerini mesaja not olarak ekler."""
    vids = [i for i in current if i.content_type in VIDEO_TYPES]
    docs = [i for i in current if i.content_type not in IMAGE_TYPES and i.content_type not in VIDEO_TYPES]
    text = message or ("(dosya gönderildi)" if docs else "(video gönderildi)" if vids and len(vids) == len(current) else "(resim gönderildi)")
    if vids:
        text += "\n\n[Eklenen videolar: " + ", ".join(f'id="{v.id}" dosya="{v.filename}"' for v in vids) + "]"
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
    snapshot = order_snapshot(db, shop, today)
    month_start = today.replace(day=1)
    r = fin.report(db, shop, month_start, today, compare=[1])
    k, p = r["kpi"], r["prev_kpi"]
    return {
        "currency": r["currency"],
        **snapshot,
        "month": {
            "label": month_start.strftime("%Y-%m"), "sales": round(k["sales"], 2), "orders": k["orders"], "profit": round(k["profit"], 2),
            "fees": round(k["fees"], 2), "cogs": round(k["cogs"], 2), "prev_sales": round(p["sales"], 2), "prev_orders": p["orders"], "prev_profit": round(p["profit"], 2),
            "costs_entered": k["cogs"] > 0,
        },
    }

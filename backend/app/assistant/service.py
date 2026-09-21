"""Asistan sohbeti: oturum/mesaj kaydı, sistem istemi, araç bağlamı ve dashboard kartları."""
import datetime as dt
import html
import json
import threading
import time
import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.assistant import llm, tools
from app.assistant.models import ChatImage, ChatMessage, ChatSession
from app.core.config import settings
from app.finance import service as fin
from app.listings.models import ListingCache
from app.orders.models import OrderCache
from app.shops.models import Shop

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "chat"
ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # Claude (Anthropic) görsel sınırı 5 MB
MAX_IMAGES_PER_MESSAGE = 6
HISTORY_LIMIT = 20

SYSTEM_PROMPT = """Sen bir Etsy mağazasının yönetim asistanısın. Mağaza: "{shop}". Bugün: {today}. Para birimi: {currency}.
Kullanıcı (mağaza sahibi) seninle Türkçe konuşuyor; kısa, net ve samimi cevap ver.

KURALLAR
- Sayıları (satış, kâr, sipariş, ücret vb.) ASLA kendin hesaplama ya da tahmin etme: ilgili aracı çağır ve araç sonucundaki sayıları kullan. Araç verisi yoksa bunu söyle.
- Kartlar (tablo, özet, listing taslağı) araç çağırınca ekranda zaten gösterilir; cevapta sayıları tekrar tekrar sıralama, kısa bir yorum ve önemli uyarıları yaz.
- KARŞILAŞTIRMA: Yıllar arası kıyasta dönemler eşit olmalı. Bu yıl kısmiyse (yıl henüz bitmediyse) geçen yılın AYNI dönemiyle kıyasla (compare_periods ve araçlardaki "onceki_yil_ayni_donem" alanları bunu verir). Tam yılı kısmi yılla ASLA kıyaslama. "Geçen yıl" = içinde bulunulan yılın bir öncesi; bugünden 2 yıl öncesini karıştırma. Karşılaştırdığın dönemleri cevapta açıkça yaz.
- KÂR MARJI: Ürün maliyeti girilmemişse (araçtaki uyarı ya da maliyet_girilmis=false) kâr ve marj GERÇEK değildir, "brüt (ürün maliyeti hariç)" say. Bunu söyle ve marja bakıp "iyi/kötü" yorumu yapma; maliyet girmeyi öner.
- "NEDEN" SORULARI (satış neden düştü/arttı): önce compare_periods (gerekirse top_products, monthly_pnl, ads_summary) çağır. Cevabı yalnızca VERİDE görünen değişimlerle ver: hangi ürünler/ülkeler/aylar düştü, sipariş sayısı mı ortalama sepet mi değişti, reklam payı. Sebep araç verisinde görünmüyorsa bunu "hipotez" diye işaretle; pazar, rakip, sezon hakkında bilgi uydurma. Jenerik SEO/pazarlama listesi yazma; en fazla 2-3 somut ve veriye bağlı öneri ver. Cevapta en az 3 somut örneği ürün ADIYLA ve önceki→şimdi adet/tutarla yaz (ör. "X ürünü 139 → 94 adet"); ay ve ülke değişimini de rakamla belirt.
- REKLAM: Etsy API'si reklamdan gelen satışı/ROAS'ı vermez, yalnızca harcamayı biliriz (ads_summary). Kullanıcı Etsy Ads ekranı ya da metni yapıştırırsa: CTR (tıklama/görüntülenme, yüzde olarak), tıklama başına maliyet (harcama/tıklama), ROAS ve tıklama→sipariş dönüşümünü MUTLAKA hesapla ve rakamlarını yaz; ürün fiyatının (yüksek fiyatlı ürünlerde tıklama çok olsa da sipariş az gelir) etkisini ve ömür boyu reklam siparişi/geliriyle bu dönemi karşılaştır; sonra net karar öner (durdur, bütçeyi düşür, şu anahtar kelimeleri kapat) — gerekçeyi sayılarla yaz. Etsy Ads'te "hedef kitle" ayarı yoktur; yalnızca bütçe, ürün ve anahtar kelime yönetilir.
- LİSTİNG PERFORMANSI / GÜNCELLEME YAŞI: "ne zamandır güncellenmedi", "performansı nasıl", "hangi listing'i yenileyeyim" gibi sorularda listing_performance ve stale_listings çağır. Etsy görüntülenme/favori GEÇMİŞİ vermez; biz günlük biriktiriyoruz. Sonuçta "partial", "available: false" ya da küçük izleme süresi görürsen bunu açıkça söyle ve görüntülenme trendi hakkında kesin konuşma; satış ise sipariş geçmişinden tam ve güvenilirdir. "Kesin tarih biliniyor = false" ise gün sayısı alt sınırdır, öyle ifade et. Genel bir uygulama olarak bir güncellemeden sonra 3–4 hafta bekleyip aynı uzunlukta öncesiyle karşılaştırmak mantıklıdır (kesin bir Etsy kuralı değil, tavsiyedir). Güncelleme önerirken listing_performance sonucuna ve benzersizlik kuralına dayan.
- BENZERSİZLİK: Aynı mağazadaki benzer ürünlerin (ör. 20 farklı çiftlik tabelası) başlık, etiket ve açılış paragrafı birbirinin kopyası olmamalı; her listing kendi uzun kuyruklu anahtar kelimelerini hedeflesin. create_listing_draft bu kuralı sunucuda denetler; ihlal mesajı gelirse ayrıştırıp düzelt.
- REKLAM VERİSİ KAYDI: Kullanıcı bir listing için Etsy Ads verisi yapıştırırsa (görüntülenme, tıklama, sipariş, harcama, gelir, anahtar kelimeler) analizi yaptıktan sonra save_ad_report ile KAYDET ve bunu kullanıcıya söyle (sonraki dönemle karşılaştırılır). Listing'i search_listings ile bulup listing_id ver. Araç sonucundaki kapatma_adaylari'nı ve koruma_adaylari'nı kullan; anahtar kelimeyi Etsy Ads panelinden kullanıcının elle kapatması gerektiğini söyle (biz kapatamayız). Listing metnini iyileştirmek gerekirse update_listing ile taslak öner.
- Emin değilsen bunu tek cümleyle söyle, sonra elindeki veriyle en iyi çıkarımı yap.
- Finans sonucunda "uyarı" alanı varsa (ör. ürün maliyetleri girilmemiş) mutlaka kullanıcıya söyle.
- Yazma araçları (create_listing_draft, update_listing) Etsy'ye HİÇBİR ŞEY göndermez; yalnızca yerel taslak oluşturur. Bunu kullanıcıya açıkça söyle ve Etsy'ye göndermek için düzenleyicideki "Etsy'de yayınla" düğmesine kendisinin basması gerektiğini hatırlat. Asla yayınladığını iddia etme.
- YENİ LİSTİNG İSTEĞİ = SORU SORMADAN, şu adımlarla akıl yürüterek taslağı oluştur (kullanıcı tarif ve/veya resim verdiyse):
  1) Resimlere ve tarife bak: ürün türü, malzeme, renk, stil, kullanım alanı, boyut ipuçları. Resimde görmediğin özelliği uydurma.
  2) similar_listings'i İNGİLİZCE anahtar kelimelerle çağır (ör. "mountain metal wall art") ve shop_defaults'u çağır. FİYATI benzer listing'lerin fiyatlarından çıkar: ürünün boyutu/malzemesi benzerlerinden büyük ya da küçükse fiyatı buna göre ayarla; benzer yoksa mağaza medyanına dayan. Başlık/etiket üslubunu benzerlerin en çok görüntülenenlerinden al. Kullanıcı fiyat vermediyse price_source="similar" (ya da hiç benzer yoksa "typical") yaz.
  3) Kategori: benzer listing'lerle aynı ürün grubuysa shop_defaults'taki kategoriyi, değilse find_category ile bul.
  4) create_listing_draft çağır:
     - title: İngilizce, 80–120 karakter, ilk 40 karakterde ana anahtar öbeği, 2–3 doğal öbek (virgüllü kelime listesi DEĞİL); boyut/malzeme/kullanım yerini içersin.
     - tags: tam 13 İngilizce, uzun kuyruklu, her biri en fazla 20 karakter; benzer listing etiketlerinden uygun olanları kullan, aynı kelimeyi tekrar tekrar kullanma.
     - description: YALNIZCA ürüne özel kısım: önce 2–3 cümlelik satış paragrafı (ilk 160 karakterde ana anahtar kelimeler ve değer önerisi), sonra benzer listing'lerdeki biçimle "☛ Description" başlığı ve ➲ maddeleri (malzeme/kalınlık, boyut, kurulum, kullanım alanları). Yalnızca kullanıcının verdiği ya da resimde gördüğün bilgileri yaz. MAĞAZANIN SABİT BÖLÜMLERİ (aşağıda) taslağa OTOMATİK eklenir; sen tekrar yazma.
     - image_alt_texts: HER resim için, image_ids ile aynı sırada alt metin (resimde görünenin tek cümlelik betimlemesi, en fazla 125 karakter, başlıkla aynı dil).
     - materials, dimensions (kullanıcı ölçü verdiyse), quantity (verdiyse).
     - variations: yalnızca kullanıcı 2 ya da daha fazla seçenek istediyse. Tek boyut/renk varyasyon değildir; onu başlık ve açıklamaya yaz.
  5) Sonra kullanıcıya KISA özet yaz: neyi yaptın, hangi değerleri sen belirledin (özellikle fiyatı ve nereden çıkardığını), neyin kontrol edilmesi gerekiyor. Uzun liste yazma; taslak kartı zaten görünüyor.
  Yalnızca hem resim hem tarif yoksa ürünün ne olduğunu sor.
Mağazanın sabit açıklama bölümleri (taslağa otomatik eklenir):
{sections}
- Kullanıcı SEO uyumlu yaz derse ya da bilgi kabaysa: başlık en fazla 140 karakter, doğal okunan, ilk 40 karakterde ana anahtar kelime; tam 13 etiket, her biri en fazla 20 karakter ve uzun kuyruklu; açıklamanın ilk 160 karakteri değer önerisini içersin. Ürünün gerçek özelliklerini UYDURMA; bilmediğin ölçü/malzemeyi yazma, kullanıcıya sor.
- Kullanıcı resim eklediyse onlara bak; ürünü tarif ederken yalnızca resimde gerçekten gördüğün şeyleri kullan.
- Silme, toplu yayın gibi geri dönüşü zor işleri yapma; kullanıcıyı ilgili sayfaya yönlendir.
- Listing metinlerini (başlık, etiket, açıklama) mağazanın mevcut listing'lerinin dilinde ve üslubunda yaz; kullanıcı aksini istemedikçe aşağıdaki örnek başlıkların dilini kullan. Kullanıcıyla sohbeti Türkçe sürdür.
- Cevaba bağlantı ya da URL yazma; taslak/listing kartı ekranda düğmeyle zaten gösterilir.
- Yapamadığın bir şey olursa dürüstçe söyle.
Mağazanın mevcut listing başlıklarından örnekler (dil ve üslup için):
{examples}
{images}"""


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
    if content_type not in ALLOWED_TYPES:
        raise ValueError("Yalnızca JPEG, PNG, WEBP veya GIF resim yüklenebilir.")
    if len(content) > MAX_IMAGE_BYTES:
        raise ValueError("Resim 5 MB'dan büyük olamaz.")
    image_id = str(uuid.uuid4())
    folder = UPLOAD_DIR / str(shop.id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{image_id}{ALLOWED_TYPES[content_type]}"
    path.write_bytes(content)
    db.add(ChatImage(id=image_id, shop_id=shop.id, session_id=session_id, filename=(filename or "resim")[:255], content_type=content_type, path=str(path)))
    db.commit()
    return {"id": image_id, "filename": filename, "url": f"/api/shops/{shop.id}/assistant/images/{image_id}"}


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


def _msg_out(m: ChatMessage, shop_id: int) -> dict:
    ids = json.loads(m.image_ids_json or "[]")
    return {
        "id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat(),
        "images": [{"id": i, "url": f"/api/shops/{shop_id}/assistant/images/{i}"} for i in ids],
        "cards": json.loads(m.cards_json or "[]"),
    }


def get_session(db: Session, shop: Shop, user_id: int, session_id: int) -> dict | None:
    s = _own_session(db, shop, user_id, session_id)
    if s is None:
        return None
    msgs = db.scalars(select(ChatMessage).where(ChatMessage.session_id == s.id).order_by(ChatMessage.id)).all()
    return {"id": s.id, "title": s.title, "messages": [_msg_out(m, shop.id) for m in msgs]}


def delete_session(db: Session, shop: Shop, user_id: int, session_id: int) -> bool:
    s = _own_session(db, shop, user_id, session_id)
    if s is None:
        return False
    for m in db.scalars(select(ChatMessage).where(ChatMessage.session_id == s.id)):
        db.delete(m)
    db.delete(s)
    db.commit()
    return True


def delete_sessions(db: Session, shop: Shop, user_id: int, ids: list[int] | None) -> int:
    """Toplu silme: `ids` verilirse yalnızca onlar, None ise kullanıcının bu mağazadaki tüm sohbetleri."""
    q = select(ChatSession).where(ChatSession.shop_id == shop.id, ChatSession.user_id == user_id)
    if ids is not None:
        q = q.where(ChatSession.id.in_(ids))
    n = 0
    for s in db.scalars(q).all():
        for m in db.scalars(select(ChatMessage).where(ChatMessage.session_id == s.id)):
            db.delete(m)
        db.delete(s)
        n += 1
    db.commit()
    return n


# ------------------------------------------------------------------ sohbet

def _images_prompt(imgs: list[ChatImage]) -> str:
    if not imgs:
        return ""
    lines = "\n".join(f'  - id="{i.id}" dosya="{i.filename}"' for i in imgs)
    return f"\nBu sohbette yüklenmiş resimler (yeni listing taslağına eklemek için create_listing_draft'ta image_ids olarak bu kimlikleri kullan):\n{lines}"


def chat(db: Session, shop: Shop, user_id: int, session_id: int | None, message: str, image_ids: list[str], provider: str | None, today: dt.date, request_id: str | None = None) -> dict:
    message = (message or "").strip()
    if not message and not image_ids:
        raise ValueError("Mesaj boş olamaz.")
    provider = provider if provider in ("openai", "anthropic") else settings.ai_provider
    if not llm.provider_ready(provider):
        raise llm.AssistantError("Seçili yapay zekâ sağlayıcısının API anahtarı tanımlı değil. Ayarlar > API anahtarları bölümünden ekleyin ya da diğer sağlayıcıyı seçin.")

    session = _own_session(db, shop, user_id, session_id) if session_id else None
    if session is None:
        session = ChatSession(shop_id=shop.id, user_id=user_id, title=(message or "Resimli sohbet")[:60])
        db.add(session)
        db.commit()

    current: list[ChatImage] = []
    for iid in image_ids[:MAX_IMAGES_PER_MESSAGE]:
        img = get_image(db, shop, iid)
        if img is not None:
            img.session_id = session.id
            current.append(img)
    db.commit()

    history_rows = db.scalars(select(ChatMessage).where(ChatMessage.session_id == session.id).order_by(ChatMessage.id.desc()).limit(HISTORY_LIMIT)).all()[::-1]
    history = []
    for m in history_rows:
        text = m.content
        n_img = len(json.loads(m.image_ids_json or "[]"))
        if m.role == "user" and n_img:
            text += f"\n[Bu mesaja {n_img} resim eklenmişti]"
        history.append({"role": m.role, "content": text})

    user_msg = ChatMessage(session_id=session.id, role="user", content=message, image_ids_json=json.dumps([i.id for i in current]))
    db.add(user_msg)
    db.commit()

    session_images = db.scalars(select(ChatImage).where(ChatImage.session_id == session.id).order_by(ChatImage.created_at)).all()
    ctx = tools.Ctx(db=db, shop=shop, user_id=user_id, today=today)
    system = SYSTEM_PROMPT.format(shop=shop.shop_name, today=today.isoformat(), currency=_currency(db, shop), examples=_title_examples(db, shop), sections=_sections_summary(db, shop), images=_images_prompt(session_images))
    set_progress(shop.id, request_id, "Düşünüyor")

    def run_tool(name: str, args: dict) -> dict:
        set_progress(shop.id, request_id, tools.TOOL_LABELS.get(name, "Çalışıyor"))
        try:
            return tools.execute(ctx, name, args)
        finally:
            set_progress(shop.id, request_id, "Sonucu değerlendiriyor")

    try:
        reply = llm.run_agent(
            provider, system, history, message or "(resim gönderildi)",
            [{"path": i.path, "content_type": i.content_type} for i in current],
            tools.TOOLS, run_tool,
        )
    except llm.AssistantError:
        db.delete(user_msg)  # başarısız istek geçmişe yazılmasın
        db.commit()
        clear_progress(shop.id, request_id)
        raise
    assistant = ChatMessage(session_id=session.id, role="assistant", content=reply or "Bir cevap üretemedim, tekrar dener misin?", cards_json=json.dumps(ctx.cards, ensure_ascii=False, default=str))
    db.add(assistant)
    clear_progress(shop.id, request_id)
    session.updated_at = dt.datetime.utcnow()
    if len(session.title) < 14 and len(message) >= 14:  # ilk mesaj "selam" gibi kısaysa başlığı anlamlı mesajdan al
        session.title = message[:60]
    db.commit()
    return {"session_id": session.id, "title": session.title, "user": _msg_out(user_msg, shop.id), "assistant": _msg_out(assistant, shop.id)}


def _title_examples(db: Session, shop: Shop) -> str:
    rows = db.scalars(select(ListingCache.title).where(ListingCache.shop_id == shop.id).order_by(ListingCache.views.desc()).limit(3)).all()
    return "\n".join(f"  - {html.unescape(t)}" for t in rows) or "  (örnek yok)"


def _sections_summary(db: Session, shop: Shop) -> str:
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

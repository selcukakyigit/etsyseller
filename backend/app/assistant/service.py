"""Asistan sohbeti: oturum/mesaj kaydı, sistem istemi, araç bağlamı ve dashboard kartları."""
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
from app.assistant import llm, tools
from app.assistant.models import ChatImage, ChatMessage, ChatSession
from app.core.config import settings
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
- Yazma araçları (create_listing_draft, update_listing, bulk_update_listings, regenerate_listing_image, generate_missing_alt_texts) Etsy'ye HİÇBİR ŞEY göndermez; yalnızca yerel taslak oluşturur. Bunu kullanıcıya açıkça söyle. Etsy'ye göndermek için ya kullanıcı düzenleyicideki "Etsy'de yayınla" düğmesine kendisi basar, ya da senden publish_listing_draft'ı çağırmanı ister (bkz. ONAY GEREKTİREN ARAÇLAR). Asla onay almadan yayınladığını iddia etme.
- YENİ LİSTİNG İSTEĞİ = SORU SORMADAN, şu adımlarla akıl yürüterek taslağı oluştur (kullanıcı tarif ve/veya resim verdiyse):
  1) Resimlere ve tarife bak: ürün türü, malzeme, renk, stil, kullanım alanı, boyut ipuçları. Resimde görmediğin özelliği uydurma.
  2) similar_listings'i İNGİLİZCE anahtar kelimelerle çağır (ör. "mountain metal wall art") ve shop_defaults'u çağır. FİYATI benzer listing'lerin fiyatlarından çıkar: ürünün boyutu/malzemesi benzerlerinden büyük ya da küçükse fiyatı buna göre ayarla; benzer yoksa mağaza medyanına dayan. Başlık/etiket üslubunu benzerlerin en çok görüntülenenlerinden al. Kullanıcı fiyat vermediyse price_source="similar" (ya da hiç benzer yoksa "typical") yaz.
  3) Kategori: benzer listing'lerle aynı ürün grubuysa shop_defaults'taki kategoriyi, değilse find_category ile bul.
  4) create_listing_draft çağır:
     - title: İngilizce, Etsy'nin başlık rehberine göre KISA ve NET: 15 kelimeden az; önce ürünün ne olduğu (ana anahtar öbeği ilk 40 karakterde), sonra renk/boyut/malzeme gibi nesnel tanımlar. Ölçü/boyut ("24 Inch"), hediye/alıcı ifadeleri ("gift for dad"), öznel sözcükler ("beautiful", "perfect"), kargo/indirim bilgisi ve kelime tekrarı başlıkta OLMAZ; hediye/alıcı/kullanım yeri ifadelerini etiketlere ve açıklamaya koy.
     - tags: tam 13 İngilizce, uzun kuyruklu, her biri en fazla 20 karakter; benzer listing etiketlerinden uygun olanları kullan, aynı kelimeyi tekrar tekrar kullanma.
     - description: YALNIZCA ürüne özel kısım: önce 2–3 cümlelik satış paragrafı (ilk 160 karakterde ana anahtar kelimeler ve değer önerisi), sonra benzer listing'lerdeki biçimle "☛ Description" başlığı ve ➲ maddeleri (malzeme/kalınlık, boyut, kurulum, kullanım alanları). Yalnızca kullanıcının verdiği ya da resimde gördüğün bilgileri yaz. MAĞAZANIN SABİT BÖLÜMLERİ (aşağıda) taslağa OTOMATİK eklenir; sen tekrar yazma.
     - image_alt_texts: HER resim için, image_ids ile aynı sırada alt metin (resimde görünenin tek cümlelik betimlemesi, en fazla 125 karakter, başlıkla aynı dil).
     - materials, dimensions (kullanıcı ölçü verdiyse), quantity (verdiyse).
     - variations: yalnızca kullanıcı 2 ya da daha fazla seçenek istediyse. Tek boyut/renk varyasyon değildir; onu başlık ve açıklamaya yaz.
  5) Sonra kullanıcıya KISA özet yaz: neyi yaptın, hangi değerleri sen belirledin (özellikle fiyatı ve nereden çıkardığını), neyin kontrol edilmesi gerekiyor. Uzun liste yazma; taslak kartı zaten görünüyor.
  Yalnızca hem resim hem tarif yoksa ürünün ne olduğunu sor.
Mağazanın sabit açıklama bölümleri (taslağa otomatik eklenir):
{sections}
- Kullanıcı SEO uyumlu yaz derse ya da bilgi kabaysa: başlık 15 kelimeden az, doğal okunan, ilk 40 karakterde ana anahtar kelime, hediye/alıcı ifadesi etiketlerde; tam 13 etiket, her biri en fazla 20 karakter ve uzun kuyruklu; açıklamanın ilk 160 karakteri değer önerisini içersin. Ürünün gerçek özelliklerini UYDURMA; bilmediğin ölçü/malzemeyi yazma, kullanıcıya sor.
- Kullanıcı resim eklediyse onlara bak; ürünü tarif ederken yalnızca resimde gerçekten gördüğün şeyleri kullan.
- FOTOĞRAF: regenerate_listing_image ile bir listing fotoğrafını AI ile yeniden oluşturabilirsin (kamera açısı/mesafe/sahne talimatı/özne referansı) — yalnızca taslağa yazar, Etsy'ye gitmez. generate_missing_alt_texts eksik alt metinleri yazar. Kırpma (crop) yalnızca editörden elle yapılabilir, sende bu araç yok — kullanıcı kırpma isterse editöre yönlendir.
- LİSTİNG SAĞLIĞI: listing_health_status ile bir listing'in (ya da tüm mağazanın) optimizasyon durumuna bakabilirsin ("dokunma zamanı geldi mi, hangi alan zayıf"); keep_watching_listing "durdurmayı değerlendir" önerisini reddeder.
- ONAY GEREKTİREN ARAÇLAR (publish_listing_draft, deactivate_listing, mark_order_shipped): bunlar Etsy'ye GERÇEKTEN gider, canlıya yansır, geri alması zor. Kullanıcı bunlardan birini istediğinde ÖNCE confirm VERMEDEN çağır — araç yalnızca ne yapılacağını özetler, hiçbir şey göndermez. Dönen özeti kullanıcıya NET biçimde anlat (hangi listing/sipariş, tam olarak ne değişecek) ve onay iste. Kullanıcı sohbette AÇIKÇA onay verene kadar (ör. "evet", "yap", "onaylıyorum") confirm=true ile TEKRAR ÇAĞIRMA — belirsiz ya da "düşüneyim" gibi bir cevapta asla confirm=true kullanma. "Hepsini yap/yayınla" gibi TOPLU bir onayda bile her bir listing/sipariş için ayrı ayrı net onay aldığından emin ol, varsayımla ilerleme.
- SİLME (listing silme dahil) hiçbir zaman yapma — bu tek yönlü ve geri alınamaz; kullanıcıyı ilgili sayfaya yönlendir, onay mekanizması bile bunun için kullanılmaz.
UYGULAMA HARİTASI (kullanıcıyı buralara yönlendir, bağlantı yazma, sayfa adını söyle)
- Listing'ler (ana sayfa): liste, filtreler, toplu düzenleme, "Yayınlanmamışları seç" ve "Seçilenleri Etsy'de yayınla". Bir listing'in düzenleyicisi: fotoğraf/video, varyasyon, kişiselleştirme, geçmiş, önizleme.
- Siparişler: sekmeler (Gönderilecek, Tamamlandı, İptal / iade, Tümü), filtreler, kargoya verme, hediye kartı yazdırma.
- Finans: Genel bakış, Ürün kârlılığı (ürün/seçenek maliyeti girilir), Sipariş maliyetleri, Kargo faturaları; Excel dışa aktarma.
- Ayarlar: mağaza, API anahtarları, profil.
ARAÇ SEÇİMİ
- "Kaç siparişim var / kaç gönderilecek / gecikmiş var mı" → orders_overview. Belirli bir sipariş (kişiselleştirme, hediye notu, takip, maliyet) → önce list_orders(search) ile numarayı bul, sonra order_detail. Kişiselleştirme metni siparişin seçeneklerinde "kisisellestirme": true olan satırdadır.
- "Kârım eksik / maliyet girilmemiş" → orders_missing_costs; sonuçtaki en çok eksik ürünleri söyle ve maliyetleri Finans > Ürün kârlılığı'ndan girmesini öner. Maliyetleri sen giremezsin.
- Kargo faturaları: "faturada eşleşmeyen var mı / şu siparişin kargosu ne kadar / fazla kesilmiş kalem" → shipping_invoices (siparişin kendi kalemleri order_detail'de "kargo_faturasi"). Faturalar eklenince Finans/kâr sayıları kendiliğinden faturadaki gerçek kargoyla hesaplanır; faturayı kullanıcı Finans > Kargo faturaları'ndan yükler.
- Başlık/etiket yazarken ya da iyileştirirken keyword_pool'a bak (var olan listing için listing_id, yeni ürün için İngilizce query + find_category'den taxonomy_id). Havuzdaki etiketleri körlemesine kopyalama; ürüne uyanları seç, 20 karakteri aşma, benzersizlik kuralını koru.
- "Kaç taslağım var / hangisi yayınlanmadı / senkronizasyon" → workspace_status.
- Bölüm, kargo profili, iade politikası, hazırlık süresi kimliği gerekiyorsa önce shop_options; kimlikleri tahmin etme.
- TOPLU DEĞİŞİKLİK: bulk_update_listings yalnızca YEREL TASLAK üretir. Kapsam belirsizse (hangi listing'ler, ne kadar değişecek) önce tek soruyla netleştir; 20'den fazla listing etkilenecekse ne yapacağını ve kaç listing olduğunu söyleyip kullanıcının onayını al, sonra çağır. Sonucu (kaç taslağa alındı, kaç atlandı ve nedeni) açıkça yaz ve yayının Listing'ler sayfasından ("Yayınlanmamışları seç" → "Seçilenleri Etsy'de yayınla") kullanıcı tarafından yapılacağını söyle.
- Listing metinlerini (başlık, etiket, açıklama) mağazanın mevcut listing'lerinin dilinde ve üslubunda yaz; kullanıcı aksini istemedikçe aşağıdaki örnek başlıkların dilini kullan. Kullanıcıyla sohbeti Türkçe sürdür.
- Cevaba bağlantı ya da URL yazma; taslak/listing kartı ekranda düğmeyle zaten gösterilir.
- Sohbette oluşturduğun ya da konuştuğun bir listing'e/taslağa ekleme veya değişiklik istenirse (boyut, renk, fiyat, başlık…) AYNI listing_id ile update_listing kullan. Yeni taslak açmak yalnızca kullanıcı açıkça yeni bir ürün istediğinde.
- KARGO/GÜMRÜK FATURASI: Kullanıcı fatura dosyası (PDF, fatura fotoğrafı, Excel/CSV, HTML) eklerse ya da fatura metnini yapıştırırsa read_shipping_invoice'ı çağır. Bu araç KAYDETMEZ; ekranda eşleşme kartı çıkar ve kullanıcı her satırı kontrol edip "Onayla" ile kaydeder. Sen asla "kaydettim" deme. Kullanıcı bir satırın başka siparişe ait olduğunu söylerse kartta o satırın sipariş seçimini değiştirip onaylamasını söyle.
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
        return {"id": i, "url": f"/api/shops/{shop_id}/assistant/images/{i}", "filename": f.filename if f else None, "content_type": f.content_type if f else None}

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


def chat(db: Session, shop: Shop, user_id: int, session_id: int | None, message: str, image_ids: list[str], provider: str | None, today: dt.date, request_id: str | None = None, lang: str = "tr") -> dict:
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
            text += f"\n[Bu mesaja {n_img} dosya/resim eklenmişti]"
        history.append({"role": m.role, "content": text})

    user_msg = ChatMessage(session_id=session.id, role="user", content=message, image_ids_json=json.dumps([i.id for i in current]))
    db.add(user_msg)
    db.commit()

    session_images = db.scalars(select(ChatImage).where(ChatImage.session_id == session.id).order_by(ChatImage.created_at)).all()
    ctx = tools.Ctx(db=db, shop=shop, user_id=user_id, today=today, message=message)
    system = SYSTEM_PROMPT.format(shop=shop.shop_name, today=today.isoformat(), currency=_currency(db, shop), examples=_title_examples(db, shop), sections=_sections_summary(db, shop), images=_images_prompt(session_images))
    if lang == "en":
        system += (
            "\n\nIMPORTANT: The user's interface language is English. Always reply in English, even though these "
            "instructions and some tool results are in Turkish. Listing titles, tags and descriptions stay in the "
            "language the shop uses on Etsy."
        )
    en = lang == "en"
    set_progress(shop.id, request_id, "Thinking" if en else "Düşünüyor")

    def run_tool(name: str, args: dict) -> dict:
        set_progress(shop.id, request_id, (tools.TOOL_LABELS_EN.get(name, "Working") if en else tools.TOOL_LABELS.get(name, "Çalışıyor")))
        try:
            return tools.execute(ctx, name, args)
        finally:
            set_progress(shop.id, request_id, "Reviewing the result" if en else "Sonucu değerlendiriyor")

    try:
        reply = llm.run_agent(
            provider, system, history, _with_attachments(message, current),
            [{"path": i.path, "content_type": i.content_type} for i in current if i.content_type in IMAGE_TYPES],
            tools.TOOLS, run_tool,
        )
    except llm.AssistantError:
        db.delete(user_msg)  # başarısız istek geçmişe yazılmasın
        db.commit()
        clear_progress(shop.id, request_id)
        raise
    reply = _strip_app_links(reply or "")
    assistant = ChatMessage(session_id=session.id, role="assistant", content=reply or tr("Bir cevap üretemedim, tekrar dener misin?", "I couldn't produce an answer, could you try again?"), cards_json=json.dumps(ctx.cards, ensure_ascii=False, default=str))
    db.add(assistant)
    clear_progress(shop.id, request_id)
    session.updated_at = dt.datetime.utcnow()
    if len(session.title) < 14 and len(message) >= 14:  # ilk mesaj "selam" gibi kısaysa başlığı anlamlı mesajdan al
        session.title = message[:60]
    db.commit()
    files = {i.id: i for i in current}
    return {"session_id": session.id, "title": session.title, "user": _msg_out(user_msg, shop.id, files), "assistant": _msg_out(assistant, shop.id)}


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

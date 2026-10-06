"""İstek başına arayüz dili. Frontend her isteğe `X-Lang: tr|en` ekler (bkz. frontend/src/lib/api.ts); ara katman
bunu bağlam değişkenine yazar. Kullanıcıya giden metinler `tr("Türkçe", "English")` ile o dile göre seçilir.

Hata mesajlarının çoğu kodda Türkçe yazılıdır ve `HTTPException(…, str(exc))` ile geçer; bunlar tek tek
değiştirilmek yerine yanıt aşamasında `translate_detail` ile aşağıdaki sözlükten İngilizceye çevrilir."""
from contextvars import ContextVar

_lang: ContextVar[str] = ContextVar("lang", default="tr")


def set_lang(value: str | None) -> None:
    _lang.set("en" if (value or "").lower().startswith("en") else "tr")


def get_lang() -> str:
    return _lang.get()


def tr(tr_text: str, en_text: str) -> str:
    return en_text if _lang.get() == "en" else tr_text


# Sabit hata/uyarı metinleri: Türkçe → İngilizce.
EN_MESSAGES: dict[str, str] = {
    "Yalnızca ekran görüntüsü (resim) yüklenebilir": "Only a screenshot (image) can be uploaded",
    "Listing bulunamadı": "Listing not found",
    "Ülke 2 harfli bir ISO kod olmalı (ör. US, GB, DE).": "The country must be a 2-letter ISO code (e.g. US, GB, DE).",
    "Fatura metni çok kısa.": "The invoice text is too short.",
    "Şablon bulunamadı": "Template not found",
    "Şablon adı boş olamaz": "The template name cannot be empty",
    "Şablon metni boş olamaz": "The template text cannot be empty",
    "Şablon metni çok uzun": "The template text is too long",
    "En fazla 50 şablon kaydedilebilir": "You can save up to 50 templates",
    "Geçersiz tarih": "Invalid date",
    "Bu mağaza Etsy'ye bağlı değil.": "This shop is not connected to Etsy.",
    "Bu mağazanın Etsy erişimi kaldırılmış; devam etmek için mağazayı yeniden bağla.": "This shop's Etsy access was removed; reconnect the shop to continue.",
    "Hiçbir değişiklik seçilmedi.": "No change was selected.",
    "Görsel listesi Etsy'dekiyle uyuşmuyor; sayfayı yenileyip tekrar dene.": "The image list does not match Etsy; refresh the page and try again.",
    "Aynı hedef birden fazla kez eklenmiş.": "The same destination was added more than once.",
    "İşlemi onaylamanız gerekiyor": "You need to confirm this action",
    "Sohbet bulunamadı": "Chat not found",
    "Not bulunamadı": "Note not found",
    "Bu dosyanın saklama süresi doldu": "This file's retention period has ended",
    "Oturum geçersiz veya süresi dolmuş": "Your session is invalid or has expired",
    "Yeni hedef için teslimat günleri (en az / en fazla) gerekli.": "Delivery days (min / max) are required for a new destination.",
    "Kimlik servisine ulaşılamadı": "Could not reach the sign-in service",
    "Silinecek sohbet seçilmedi": "No chat selected to delete",
    "Yüzde -100'ün altına inemez.": "The percentage cannot go below -100.",
    "Yapay zekâ her fotoğraf için alt metin üretemedi, tekrar dene.": "The AI could not write alt text for every photo; try again.",
    "En fazla teslimat günü, en azdan küçük olamaz.": "Maximum delivery days cannot be less than the minimum.",
    "Teslimat günü için hem en az hem en fazla değer gerekir.": "Delivery days need both a minimum and a maximum.",
    "Görsel bulunamadı": "Image not found",
    "Yapay zekâ beklenmeyen bir cevap verdi, tekrar dene.": "The AI returned an unexpected answer; try again.",
    "Bir hedef ya ülke ya da bölge olabilir, ikisi birden olamaz.": "A destination can be a country or a region, not both.",
    "Yapay zekâ faturadan okunabilir bir sonuç döndürmedi, tekrar dene.": "The AI could not read the invoice; try again.",
    "Onay için hesabının e-posta adresini yazmalısın": "Type your account email to confirm",
    "Taslak video dosyası bulunamadı; videoyu yeniden ekle.": "The draft video file was not found; add the video again.",
    "Giriş yapılmamış": "You are not signed in",
    "Dijital ürünlerden oluşan siparişe kargo faturası yazılamaz.": "A shipping invoice cannot be added to an order of digital items.",
    "Siparişte ürün kalemi yok.": "The order has no items.",
    "Bu fatura kalemi zaten kayıtlı (aynı fatura no, gönderi, tür ve tutar).": "This invoice line is already saved (same invoice no., shipment, type and amount).",
    "Taslak görsel dosyası bulunamadı; görseli yeniden ekle.": "The draft image file was not found; add the image again.",
    "Sipariş bulunamadı.": "Order not found.",
    "Bu Etsy mağazası başka bir hesaba bağlı. Önce o hesaptan bağlantıyı kaldırın.": "This Etsy shop is connected to another account. Disconnect it from that account first.",
    "Faturadan hiçbir gönderi satırı çıkarılamadı.": "No shipment lines could be read from the invoice.",
    "Para birimi 3 harfli bir ISO kod olmalı (ör. USD, EUR, TRY).": "The currency must be a 3-letter ISO code (e.g. USD, EUR, TRY).",
    "Öneri bulunamadı": "Suggestion not found",
    "Metinler güncellendi, sayfayı yenileyip tekrar deneyin": "The terms were updated; refresh the page and try again",
    "Metin boş olamaz.": "The text cannot be empty.",
    "Bulunacak metin boş olamaz.": "The text to find cannot be empty.",
    "Geçersiz görsel dosyası": "Invalid image file",
    "Kısa sürede çok fazla yapay zekâ isteği gönderildi. Birkaç dakika sonra tekrar dene.": "Too many AI requests in a short time. Try again in a few minutes.",
    "Bilinmeyen ya da süresi dolmuş bağlantı isteği. Tekrar deneyin.": "Unknown or expired connection request. Please try again.",
    "En fazla süre, en az süreden küçük olamaz.": "The maximum time cannot be less than the minimum.",
    "Sipariş bulunamadı — önce senkronize edin.": "Order not found — sync first.",
    "Dosya bulunamadı": "File not found",
    "Yazdığınız e-posta hesabınızla eşleşmiyor": "The email you typed does not match your account",
    "Yapay zekâ özellikleri kapalı. Ayarlar > Yapay Zekâ bölümünden açabilirsin.": "AI features are turned off. You can turn them on under Settings > AI.",
    "Taslak fotoğraf bulunamadı": "Draft photo not found",
    "Dosyada geçerli tutarlı hiçbir satır bulunamadı.": "No rows with a valid amount were found in the file.",
    "kind image veya video olmalı": "kind must be image or video",
    "Dosyada bir 'tutar' sütunu bulunamadı (Amount/Total/Tutar gibi bir başlık bekleniyor).": "No 'amount' column found in the file (expected a header like Amount or Total).",
    "Dosyada okunabilir satır bulunamadı.": "No readable rows found in the file.",
    "Zincirin kök dosyası bulunamadı; sayfayı yenile.": "The original file of this chain was not found; refresh the page.",
    "Mağaza bulunamadı": "Shop not found",
    "Eski .xls formatı için xlrd paketi kurulu değil.": "The old .xls format is not supported on this server.",
    "Listing için sağlık kaydı bulunamadı": "No health record found for the listing",
    "Mesaj boş olamaz.": "The message cannot be empty.",
    "Ek bulunamadı": "Attachment not found",
    "Taslak görsel dosyası bulunamadı; sayfayı yenile.": "The draft image file was not found; refresh the page.",
    "Listing yerelde bulunamadı": "Listing not found locally",
    "Yeni listing bulunamadı.": "New listing not found.",
    "Kopyalanacak listing yerelde yok; önce senkronize et.": "The listing to copy is not available locally; sync first.",
    "Resim 5 MB'dan büyük olamaz.": "The image cannot be larger than 5 MB.",
    "Yalnızca JPEG, PNG, WEBP veya GIF resim yüklenebilir.": "Only JPEG, PNG, WEBP or GIF images can be uploaded.",
    "Sayfa bulunamadı": "Page not found",
    "Mesaj bulunamadı": "Message not found",
    "Kullanıcı bulunamadı": "User not found",
    "Kullanıcının çalışma alanı yok.": "The user has no workspace.",
    "Bu işlemi kendi hesabına uygulayamazsın.": "You cannot do this to your own account.",
    "Sunucu ayarındaki (ADMIN_EMAILS) yöneticiye panelden dokunulamaz.": "Admins from the server setting (ADMIN_EMAILS) cannot be changed from the panel.",
    "Plan bulunamadı": "Plan not found",
    "Aktif plan yok.": "No active plan.",
    "Ücretli abonelik Lemon Squeezy panelinden iptal edilir.": "Paid subscriptions are cancelled from the Lemon Squeezy dashboard.",
    "Yalnızca plan atanabilir.": "Only a plan can be assigned.",
    "Bu kullanıcının ücretli bir aboneliği var.": "This user has a paid subscription.",
    "E-posta gönderilemedi (e-posta servisi yapılandırılmamış ya da hata verdi).": "The email could not be sent (email service not configured or failed).",
    "Askıdaki ya da engelli hesap yönetici yapılamaz.": "A suspended or blocked account cannot be made an admin.",
    "Yönetici hesabı askıya alınamaz; önce rolünü kullanıcıya çevir.": "An admin account cannot be suspended; change its role to user first.",
    "Yönetici hesabı silinemez; önce rolünü kullanıcıya çevir.": "An admin account cannot be deleted; change its role to user first.",
    "Onay için kullanıcının e-postasını aynen yaz.": "Type the user's email exactly to confirm.",
    "Supabase yapılandırılmamış": "Supabase is not configured",
    "Kimlik servisi jeton döndürmedi": "The sign-in service returned no token",
    "Hesabın askıya alındı. Destek için iletişim sayfasından bize yazabilirsin.": "Your account is suspended. You can reach us through the contact page.",
    "Hesabın engellendi.": "Your account is blocked.",
    "Ürün bulunamadı": "Product not found",
    "Zaten bir aboneliğin var; planını abonelik yönetiminden değiştirebilirsin.": "You already have a subscription; you can change your plan from subscription management.",
    "Ödeme sistemi yapılandırılmamış.": "Payments are not configured.",
    "Ödeme sağlayıcısına ulaşılamadı.": "Could not reach the payment provider.",
    "Ödeme sayfası açılamadı.": "Could not open the checkout page.",
    "Abonelik iptal edilemedi.": "Could not cancel the subscription.",
    "Model bulunamadı": "Model not found",
    "Bu sağlayıcıda aynı model zaten katalogda.": "This model is already in the catalog for this provider.",
    "Bu model bir göreve atanmış; önce görevi başka bir modele ata.": "This model is assigned to a task; assign the task to another model first.",
    "Görev bulunamadı": "Task not found",
    "Bu görev için uygun (aktif, aynı türde ve desteklenen) bir model seç.": "Pick a suitable model for this task (active, same type and supported).",
    "Süreler tam sayı (saniye) olmalı.": "Durations must be whole numbers (seconds).",
    "En az bir süre gir; süreler 1–60 sn arasında olmalı.": "Enter at least one duration; durations must be 1–60 seconds.",
    "Seçenek parametreleri düz değerler olmalı (metin, sayı, evet/hayır).": "Option parameters must be plain values (text, number, yes/no).",
    "Google görsel seçeneğinde çözünürlük (image_size) 1K, 2K ya da 4K olmalı.": "A Google image option needs a resolution (image_size) of 1K, 2K or 4K.",
    "Seçenek anahtarları benzersiz olmalı.": "Option keys must be unique.",
    "Görsel ve video modellerinde en az bir aktif fiyat seçeneği olmalı.": "Image and video models need at least one active price option.",
    "Yalnızca bir seçenek varsayılan olabilir.": "Only one option can be the default.",
    "Varsayılan seçenek aktif olmalı.": "The default option must be active.",
    "Çalışma alanı bulunamadı": "Workspace not found",
    "Miktar 0 olamaz.": "The amount cannot be 0.",
    "Plan için ödeme aralığı (aylık/yıllık) seçilmeli.": "Pick a billing interval (monthly/yearly) for a plan.",
    "Bu Lemon varyant numarası başka bir üründe kullanılıyor.": "This Lemon variant ID is already used by another product.",
    "Bu plana bağlı abonelik var; silmek yerine pasifleştir.": "This plan has subscriptions; deactivate it instead of deleting.",
    "İş başlatılamadı (bulunamadı ya da zaten sırada).": "Could not start the job (not found or already queued).",
    "Kredin bitti. Ayarlar > Plan ve krediler bölümünden kredi alabilirsin.": "You are out of credits. You can buy more under Settings > Plan and credits.",
    "Sipariş bulunamadı": "Order not found",
    "Resim bulunamadı": "Image not found",
    "Gönderilen bilgiler geçersiz.": "The submitted information is invalid.",
    "Beklenmeyen bir hata oluştu. Sorun sürerse destek ekibine şu kodu ilet.": "An unexpected error occurred. If it keeps happening, send this code to support.",
}

# Değişken parça içeren metinler: Türkçe ön ek → İngilizce ön ek (geri kalanı olduğu gibi kalır).
EN_PREFIXES: list[tuple[str, str]] = [
    ("Bilinmeyen sağlayıcı:", "Unknown provider:"),
    ("Kimlik servisi hata verdi", "The sign-in service returned an error"),
    ("Yapay zekâ sağlayıcısı hata verdi:", "The AI provider returned an error:"),
    ("Fiyat en az ", "The price must be at least "),
    ("Bu mağazada '", "This shop has no exchange rate data for '"),
    ("Desteklenmeyen dosya türü:", "Unsupported file type:"),
    ("İade süresi şunlardan biri olmalı:", "The return window must be one of:"),
    ("Etsy mağaza bilgisi alınamadı:", "Could not load Etsy shop info:"),
    ("SEO önerisi üretilemedi:", "Could not generate the SEO suggestion:"),
    ("Öneri zaten '", "The suggestion is already '"),
    ("Yapay zekâ faturayı okuyamadı:", "The AI could not read the invoice:"),
    ("Gemini bir görsel döndürmedi, tekrar dene.", "Gemini did not return an image; try again."),
    ("Gemini görsel üretemedi:", "Gemini could not generate the image:"),
    ("Beklenen 13 etiket, alınan:", "Expected 13 tags, got:"),
    ("Etsy'ye bağlanılamadı:", "Could not connect to Etsy:"),
]


def translate_detail(detail):
    """Hata yanıtındaki metni arayüz diline çevirir; Türkçe arayüzde ya da bilinmeyen metinde dokunmaz."""
    if _lang.get() != "en" or not isinstance(detail, str):
        return detail
    if detail in EN_MESSAGES:
        return EN_MESSAGES[detail]
    for tr_prefix, en_prefix in EN_PREFIXES:
        if detail.startswith(tr_prefix):
            return en_prefix + detail[len(tr_prefix):]
    if detail.startswith("Etsy API: "):
        return "Etsy API: " + translate_detail(detail[len("Etsy API: "):])
    return detail

"""Destek taleplerinin ortak sözlüğü: tür, durum, öncelik, kaynak, konu etiketleri ve yönetici kuyruk görünümleri.
Hem kullanıcı/yönetici uçları hem asistan aracı buradan okur; ekran anahtarı gönderir, metni burada üretilir."""
import re

CATEGORIES = ("bug", "question", "feature", "billing", "other")
STATUSES = ("open", "waiting_user", "resolved")
PRIORITIES = ("low", "normal", "urgent")
SOURCES = ("web", "assistant", "error")  # web: Yardım & Destek ekranı | assistant: sohbet asistanı | error: otomatik hata bildirimi

# Yönetici kuyruk görünümleri (queue.py). "open": çözülmemiş hepsi.
VIEWS = ("open", "mine", "unassigned", "unread", "waiting", "overdue", "resolved", "all")
OVERDUE_HOURS = 24  # yönetici sırasındaki talep bu kadar saattir yanıtsızsa "geciken"

# anahtar -> (Türkçe ad, İngilizce ad, kelime kalıpları). Kalıplar yalnızca öneri içindir; etiketi yönetici onaylar.
LABELS: dict[str, tuple[str, str, str]] = {
    "photos": ("Fotoğraf / görsel", "Photos / images", r"foto|görsel|resim|image|photo|upload|yükle"),
    "etsy_connection": ("Etsy bağlantısı", "Etsy connection", r"etsy.*(bağlan|connect|token|yetki|auth)|bağlantı|disconnect|sync|senkron"),
    "billing": ("Fatura / ödeme", "Billing / payment", r"fatura|ödeme|kredi|credit|invoice|payment|refund|iade|abonelik|subscription"),
    "listing_editor": ("Listing editörü", "Listing editor", r"editör|editor|listing|etiket|tag|başlık|title|varyasyon|variation|yayınla|publish"),
    "ai": ("Yapay zekâ üretimi", "AI generation", r"yapay zek|\bai\b|üret|generate|video|prompt"),
    "orders_finance": ("Sipariş / finans", "Orders / finance", r"sipariş|order|finans|finance|kâr|profit|maliyet|cost|kargo|shipping"),
    "assistant": ("Asistan", "Assistant", r"asistan|assistant|sohbet|chat"),
    "account": ("Hesap / giriş", "Account / login", r"giriş|login|şifre|password|hesap|account|e-?posta|email|2fa"),
    "research": ("Keşfet / araştırma", "Discover / research", r"keşfet|discover|anahtar kelime|keyword|araştırma|research|hacim|volume"),
    "other": ("Diğer", "Other", r"$^"),
}
_PATTERNS = {key: re.compile(p, re.I) for key, (_, _, p) in LABELS.items()}


def label_options() -> list[dict]:
    """Ekranda seçilecek etiketler: {key, tr, en}."""
    return [{"key": k, "tr": tr, "en": en} for k, (tr, en, _) in LABELS.items()]


def suggest_labels(*texts: str) -> list[str]:
    """Konu ve ilk mesajdaki kelimelere göre etiket önerisi (en çok 3). Kaydetmez; yönetici onaylar."""
    blob = " ".join(texts)
    return [key for key, pattern in _PATTERNS.items() if pattern.search(blob)][:3]


def clean_labels(values) -> list[str]:
    """Bilinmeyen anahtarları atar, sırayı korur, tekrarı kaldırır."""
    return list(dict.fromkeys(v for v in values if v in LABELS))

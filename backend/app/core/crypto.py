"""Veritabanında şifreli saklanan alanlar (Etsy erişim/yenileme belirteçleri).

`TOKEN_ENCRYPTION_KEY` virgülle ayrılmış Fernet anahtarları alır; ilki şifrelemede kullanılır, hepsi çözmede denenir.
Anahtar döndürmek için yeni anahtarı listenin başına ekle, eskileri tüm kayıtlar yeniden yazılana kadar tut.
Anahtar üretmek: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from app.core.config import settings

_PREFIX = "enc:v1:"
_fernet: MultiFernet | None = None


def _get_fernet() -> MultiFernet:
    global _fernet
    if _fernet is None:
        keys = [k.strip() for k in settings.token_encryption_key.split(",") if k.strip()]
        if not keys:
            raise RuntimeError("TOKEN_ENCRYPTION_KEY ayarlanmamış; belirteçler şifrelenemez.")
        _fernet = MultiFernet([Fernet(k) for k in keys])
    return _fernet


class EncryptedText(TypeDecorator):
    """Python tarafında düz metin, veritabanında Fernet ile şifreli metin. Anahtar yoksa ya da veri bozuksa hata verir
    (sessizce düz metin yazmaz/okumaz)."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return _PREFIX + _get_fernet().encrypt(value.encode()).decode()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if not value.startswith(_PREFIX):
            raise RuntimeError("Şifrelenmemiş belirteç bulundu; kayıt yeniden bağlanmalı.")
        try:
            return _get_fernet().decrypt(value[len(_PREFIX):].encode()).decode()
        except InvalidToken as exc:
            raise RuntimeError("Belirteç çözülemedi (TOKEN_ENCRYPTION_KEY yanlış ya da değişmiş).") from exc

"""Tek kullanımlık (geçici) e-posta adreslerini tanır. Liste `disposable_domains.txt` dosyasındadır; aynı liste
Supabase'deki `blocked_email_domains` tablosuna da yüklenir ve kayıt anında `hook_block_disposable_email` ile uygulanır.
Burada ikinci bir güvence olarak kullanılır: kanca kapalı olsa bile böyle bir adrese uygulama kullanıcısı açılmaz."""
from functools import lru_cache
from pathlib import Path

LIST_FILE = Path(__file__).with_name("disposable_domains.txt")
MESSAGE = "Disposable email addresses can't be used. / Tek kullanımlık e-posta adresleriyle kayıt olunamaz."


@lru_cache(maxsize=1)
def _domains() -> frozenset[str]:
    lines = LIST_FILE.read_text(encoding="utf-8").splitlines()
    return frozenset(line.strip() for line in lines if line.strip() and not line.startswith("#"))


def is_disposable(email: str) -> bool:
    """`a@x.mailinator.com` gibi alt alan adlarını da yakalar."""
    domain = email.rsplit("@", 1)[-1].strip().lower().rstrip(".")
    parts = domain.split(".")
    blocked = _domains()
    return any(".".join(parts[i:]) in blocked for i in range(len(parts) - 1))

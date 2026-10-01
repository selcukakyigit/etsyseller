"""Tek kullanımlık e-posta listesini güncel kaynaktan indirir, `app/auth/disposable_domains.txt` dosyasını ve Supabase'deki
`blocked_email_domains` tablosunu yeniler.

Çalıştır:  python scripts/update_disposable_domains.py
"""
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.disposable import LIST_FILE  # noqa: E402

SOURCE = "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf"
HEADER = [
    "# Tek kullanımlık e-posta alan adları. Kaynak: github.com/disposable-email-domains/disposable-email-domains",
    "# Güncelleme: python scripts/update_disposable_domains.py  (dosyayı ve veritabanı tablosunu yeniler)",
]


def load_into_db(domains: list[str]) -> None:
    from sqlalchemy import text

    from app.core.db import engine

    with engine.begin() as conn:
        conn.execute(text("delete from public.blocked_email_domains"))
        for i in range(0, len(domains), 1000):
            conn.execute(
                text("insert into public.blocked_email_domains(domain) values (:d) on conflict do nothing"),
                [{"d": d} for d in domains[i : i + 1000]],
            )


if __name__ == "__main__":
    resp = httpx.get(SOURCE, timeout=60)
    resp.raise_for_status()
    domains = sorted({line.strip().lower() for line in resp.text.splitlines() if line.strip() and not line.startswith("#")})
    if len(domains) < 1000:  # beklenmedik derecede kısa liste: bozuk indirme olabilir, üzerine yazma
        sys.exit(f"Liste şüpheli derecede kısa ({len(domains)}), güncellenmedi.")
    LIST_FILE.write_text("\n".join(HEADER + domains) + "\n", encoding="utf-8")
    load_into_db(domains)
    print(f"{len(domains)} alan adı dosyaya ve veritabanına yazıldı.")

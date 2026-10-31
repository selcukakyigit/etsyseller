"""Hukuki metin sürümü iki yerde tutulur (frontend legal.ts ve backend config). Ayrışırlarsa kabul ekranı 409 verir ve kimse devam edemez."""
import re
from pathlib import Path

import pytest

from app.core.config import Settings

LEGAL_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "legal.ts"


@pytest.mark.skipif(not LEGAL_TS.exists(), reason="frontend kaynağı yok")
def test_backend_legal_version_matches_frontend():
    match = re.search(r'LEGAL_VERSION\s*=\s*"([^"]+)"', LEGAL_TS.read_text(encoding="utf-8"))
    assert match, "legal.ts içinde LEGAL_VERSION bulunamadı"
    # Ortam değişkeni değil, kodun varsayılanı karşılaştırılır (üretimde LEGAL_VERSION ortam değişkeni tanımlıysa o geçerlidir).
    assert Settings.model_fields["legal_version"].default == match.group(1)

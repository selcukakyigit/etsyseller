"""Analyzer: belge → yapılandırılmış veri. Her modül kendi "profilini" kaydeder (ne çıkarılacağı + varsa kural tabanlı
okuyucu); okuma yolu ve maliyet kontrolü burada, bir kez yazılır.

Yol her zaman en ucuzdan pahalıya:
    0. Önbellek  — aynı içerik (SHA-256) bu çalışma alanında daha önce okunduysa: 0 token.
    1. Tablo     — Excel/CSV: profilin sütun okuyucusu, yapay zekâ yok.
    2. Kural     — metin katmanı olan PDF / HTML / yapıştırılan metin: profilin kural tabanlı okuyucusu (makine çıktısı
                   raporlar gibi sabit etiketli belgeler), yapay zekâ yok.
    3. Metin+AI  — kural yetmezse yalnızca METİN modele gider (görüntüye göre çok ucuz).
    4. Görüntü+AI — taranmış PDF, fotoğraf, ya da metin yolu güvenilir sonuç vermediyse.
Fotoğraflar, profil `ocr` istiyorsa önce yerel OCR ile metne çevrilip 2-3. yoldan okunur (basılı rapor tablosu yapay zekâsız
okunur; el yazısı OCR'da anlamsız satırlar olarak kalır ve kural okuyucuya girmez). Görüntü+AI yalnızca OCR işe yaramazsa.

AI çağrıları kullanım ölçümüne (billing.metering) "document" göreviyle yazılır; çağıran uç nokta önce AI iznini
(kredi, hız sınırı, AI kapalı mı) kontrol etmiş olmalıdır.
"""
import base64
import csv
import hashlib
import html
import io
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modkit.models import AnalyzerCache

log = logging.getLogger("app.modkit.analyzer")

MIN_PDF_TEXT_CHARS = 80  # bunun altı = metin katmanı yok (taranmış PDF); görüntü yoluna düşülür
MAX_TEXT_CHARS = 12000  # bundan uzun metin kesilerek AI'ya gitmez (satır kaybı riski); dosya doğrudan gönderilir
MAX_PASTE_CHARS = 20000
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp", "image/gif")


class AnalyzerError(Exception):
    pass


@dataclass
class Profile:
    key: str
    prompt: str
    parse_text: Callable[[str], dict | None] | None = None  # kural tabanlı okuyucu; emin değilse None döner
    parse_table: Callable[[list[list]], dict] | None = None  # Excel/CSV satırları → veri (AnalyzerError fırlatabilir)
    usable: Callable[[dict], bool] = field(default=lambda d: bool(d))
    max_tokens: int = 2000
    ocr: bool = False  # fotoğraflar önce yerel OCR ile metne çevrilir (basılı raporlar için)


@dataclass
class Result:
    data: dict
    source: str  # cache | table | rule | text | vision
    sha256: str


PROFILES: dict[str, Profile] = {}


def register(profile: Profile) -> Profile:
    PROFILES[profile.key] = profile
    return profile


def _profile(key: str) -> Profile:
    try:
        return PROFILES[key]
    except KeyError as exc:
        raise AnalyzerError(f"Bilinmeyen belge profili: {key}") from exc


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_kind(filename: str, content_type: str) -> str:
    lower = (filename or "").lower()
    if lower.endswith((".xlsx", ".xls", ".csv")):
        return "table"
    if lower.endswith((".html", ".htm")):
        return "html"
    if lower.endswith(".txt") or content_type == "text/plain":
        return "text"
    if content_type == "application/pdf" or lower.endswith(".pdf"):
        return "pdf"
    if content_type.startswith("image/") or lower.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return "image"
    raise AnalyzerError(f"Desteklenmeyen dosya türü: {filename}")


# --------------------------------------------------------------- yerel okuyucular (ücretsiz) ----

def pdf_text(content: bytes) -> str:
    """PDF'in metin katmanı (yerel, AI'sız); şifreli/bozuk/taranmış PDF'te boş döner."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        return re.sub(r"[ \t]+", " ", "\n".join((page.extract_text() or "") for page in reader.pages)).strip()
    except Exception:  # noqa: BLE001
        return ""


MIN_OCR_CHARS = 40  # bunun altı = fotoğraftan metin okunamadı; görüntü yoluna düşülür
_ocr_engine = None
_CAMEL = re.compile(r"(?<=[a-z])(?=[A-Z])")


def ocr_text(content: bytes) -> str:
    """Fotoğraftaki basılı metin (yerel OCR, AI'sız). Aynı satırdaki parçalar soldan sağa birleştirilir: tablo satırı
    "Plate Size: 4031x1114mm Planned Process Time: 6min58,7s" gibi tek satır olur. OCR kurulu değilse ya da okuyamazsa boş."""
    global _ocr_engine
    try:
        if _ocr_engine is None:
            from rapidocr_onnxruntime import RapidOCR

            _ocr_engine = RapidOCR()
        found, _ = _ocr_engine(content)
    except Exception:  # noqa: BLE001
        log.warning("OCR çalışmadı", exc_info=True)
        return ""
    boxes = sorted(((sum(p[1] for p in b) / 4, b[3][1] - b[0][1], b[0][0], str(t)) for b, t, _c in found or []), key=lambda x: x[0])
    rows: list[list[tuple]] = []
    for box in boxes:  # y'si bir önceki parçanın yarım satır yüksekliği içindeyse aynı satır
        if rows and abs(box[0] - rows[-1][-1][0]) <= max(box[1], rows[-1][-1][1]) * 0.6:
            rows[-1].append(box)
        else:
            rows.append([box])
    text = "\n".join(" ".join(t for _y, _h, _x, t in sorted(row, key=lambda x: x[2])) for row in rows)
    return _CAMEL.sub(" ", text)  # OCR bazen bitişik okur ("ProcessTime"); etiketler makine metniyle aynı anahtara düşsün


def html_text(content: bytes) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", content.decode("utf-8", errors="ignore"))
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h[1-6])>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"[ \t]+", " ", html.unescape(text)).strip()


def read_table(content: bytes, filename: str) -> list[list]:
    lower = filename.lower()
    if lower.endswith(".csv"):
        rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig", errors="ignore"))))
    elif lower.endswith(".xls"):
        try:
            import xlrd
        except ImportError as exc:
            raise AnalyzerError("Eski .xls formatı için xlrd paketi kurulu değil.") from exc
        sheet = xlrd.open_workbook(file_contents=content).sheet_by_index(0)
        rows = [sheet.row_values(i) for i in range(sheet.nrows)]
    else:
        from openpyxl import load_workbook

        try:
            rows = [list(r) for r in load_workbook(io.BytesIO(content), read_only=True, data_only=True).active.iter_rows(values_only=True)]
        except Exception as exc:  # noqa: BLE001
            raise AnalyzerError("Excel dosyası okunamadı.") from exc
    rows = [r for r in rows if any(c not in (None, "") for c in r)]
    if not rows:
        raise AnalyzerError("Dosyada okunabilir satır bulunamadı.")
    return rows


# --------------------------------------------------------------- yapay zekâ ----

def extract_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    try:
        data = json.loads(match.group(0) if match else text)
    except (json.JSONDecodeError, AttributeError, TypeError) as exc:
        raise AnalyzerError("Yapay zekâ belgeden okunabilir bir sonuç döndürmedi, tekrar dene.") from exc
    if not isinstance(data, dict):
        raise AnalyzerError("Yapay zekâ belgeden okunabilir bir sonuç döndürmedi, tekrar dene.")
    return data


def _model():
    from app.ai.vision import VisionError, text_model

    try:
        return text_model("document")
    except VisionError as exc:
        raise AnalyzerError(str(exc)) from exc


def ai_from_text(profile: Profile, text: str) -> dict:
    """Yalnızca metin gider — ucuz yol."""
    from app.ai.client import get_anthropic_client, get_openai_client, openai_limits
    from app.billing import metering

    model = _model()
    prompt = profile.prompt + "\n\nBelge metni:\n" + text[:MAX_TEXT_CHARS]
    try:
        if model.provider == "anthropic":
            resp = get_anthropic_client().messages.create(model=model.model_id, max_tokens=profile.max_tokens, messages=[{"role": "user", "content": prompt}])
            raw = "".join(b.text for b in resp.content if b.type == "text")
        else:
            resp = get_openai_client().chat.completions.create(model=model.model_id, messages=[{"role": "user", "content": prompt}], **openai_limits(model.model_id, profile.max_tokens))
            raw = resp.choices[0].message.content or ""
        metering.record_response("document", model, resp)
    except Exception as exc:  # noqa: BLE001
        raise AnalyzerError(f"Yapay zekâ belgeyi okuyamadı: {str(exc)[:200]}") from exc
    return extract_json(raw)


def ai_from_file(profile: Profile, content: bytes, content_type: str) -> dict:
    """Taranmış PDF ya da fotoğraf — görüntü/dosya destekli model (pahalı yol)."""
    from app.ai.client import get_anthropic_client, get_openai_client, openai_limits
    from app.ai.images import for_llm
    from app.billing import metering

    model = _model()
    content, content_type = for_llm(content, content_type)  # büyük fotoğraf 5 MB sınırına sığsın
    b64 = base64.b64encode(content).decode()
    try:
        if model.provider == "anthropic":
            media_type = content_type if content_type in IMAGE_TYPES else "application/pdf"
            doc_type = "image" if media_type.startswith("image/") else "document"
            resp = get_anthropic_client().messages.create(
                model=model.model_id,
                max_tokens=profile.max_tokens,
                messages=[{"role": "user", "content": [
                    {"type": doc_type, "source": {"type": "base64", "media_type": media_type, "data": b64}},
                    {"type": "text", "text": profile.prompt},
                ]}],
            )
            raw = "".join(b.text for b in resp.content if b.type == "text")
        else:
            if content_type == "application/pdf":
                part = {"type": "file", "file": {"filename": "belge.pdf", "file_data": f"data:application/pdf;base64,{b64}"}}
            else:
                part = {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}"}}
            resp = get_openai_client().chat.completions.create(
                model=model.model_id,
                messages=[{"role": "user", "content": [{"type": "text", "text": profile.prompt}, part]}],
                **openai_limits(model.model_id, profile.max_tokens),
            )
            raw = resp.choices[0].message.content or ""
        metering.record_response("document", model, resp)
    except Exception as exc:  # noqa: BLE001
        raise AnalyzerError(f"Yapay zekâ belgeyi okuyamadı: {str(exc)[:200]}") from exc
    return extract_json(raw)


# --------------------------------------------------------------- önbellek ----

def _cached(db: Session, workspace_id: int, profile: str, digest: str) -> dict | None:
    row = db.scalar(select(AnalyzerCache).where(
        AnalyzerCache.workspace_id == workspace_id, AnalyzerCache.profile == profile, AnalyzerCache.sha256 == digest
    ))
    if row is None:
        return None
    try:
        return json.loads(row.result_json)
    except json.JSONDecodeError:
        return None


def _store(db: Session, workspace_id: int, profile: str, digest: str, data: dict, source: str) -> None:
    try:
        db.add(AnalyzerCache(workspace_id=workspace_id, profile=profile, sha256=digest, result_json=json.dumps(data, ensure_ascii=False, default=str), source=source))
        db.commit()
    except IntegrityError:  # aynı anda iki istek: ilki yazdı, sonuç aynı
        db.rollback()


# --------------------------------------------------------------- giriş noktaları ----

Gate = Callable[[], None] | None


def _ai_gate(gate: Gate) -> None:
    """Yapay zekâ çağrılmadan hemen önce izin kontrolü (kredi, hız sınırı, AI kapalı mı). Önbellekten, tablodan ya da
    kural okuyucudan gelen sonuç ücretsizdir; kontrol yalnızca gerçekten AI'ya gidilecekse yapılır."""
    if gate is not None:
        gate()


def _from_text(profile: Profile, text: str, gate: Gate = None) -> tuple[dict, str] | None:
    """Kural → metin+AI. Güvenilir sonuç yoksa None (çağıran görüntü yoluna düşebilir)."""
    if profile.parse_text is not None:
        try:
            data = profile.parse_text(text)
        except Exception:  # noqa: BLE001 — kural okuyucu hatası AI yolunu engellemesin
            log.warning("Kural okuyucu hata verdi (%s)", profile.key, exc_info=True)
            data = None
        if data is not None and profile.usable(data):
            return data, "rule"
    _ai_gate(gate)
    data = ai_from_text(profile, text)
    return (data, "text") if profile.usable(data) else None


def analyze_file(db: Session, workspace_id: int, profile_key: str, content: bytes, filename: str, content_type: str, gate: Gate = None) -> Result:
    profile = _profile(profile_key)
    digest = sha256(content)
    hit = _cached(db, workspace_id, profile.key, digest)
    if hit is not None:
        return Result(hit, "cache", digest)
    kind = file_kind(filename, content_type)
    if kind == "table" and profile.parse_table is not None:
        data, source = profile.parse_table(read_table(content, filename)), "table"
    elif kind == "table":  # profilin sütun okuyucusu yok: tablo metne çevrilip metin yolundan okunur (yine ucuz)
        text = "\n".join(" | ".join("" if c is None else str(c) for c in row) for row in read_table(content, filename))
        got = _from_text(profile, text[:MAX_TEXT_CHARS], gate)
        if got is None:
            raise AnalyzerError("Belgeden güvenilir bir sonuç çıkarılamadı.")
        data, source = got
    elif kind in ("html", "text"):
        text = html_text(content) if kind == "html" else content.decode("utf-8", errors="ignore")
        got = _from_text(profile, text[:MAX_PASTE_CHARS], gate)
        if got is None:
            raise AnalyzerError("Belgeden güvenilir bir sonuç çıkarılamadı.")
        data, source = got
    elif kind == "pdf":
        text, got = pdf_text(content), None
        if len(text) >= MIN_PDF_TEXT_CHARS:
            # Kural okuyucu metin uzunluğundan bağımsız denenir (ücretsiz); AI metin yolu yalnızca sığan metinde.
            if len(text) <= MAX_TEXT_CHARS:
                try:
                    got = _from_text(profile, text, gate)
                except AnalyzerError:
                    log.info("PDF metin yolu başarısız; PDF doğrudan gönderiliyor (%s)", profile.key)
            elif profile.parse_text is not None:
                rule = profile.parse_text(text)
                got = (rule, "rule") if rule is not None and profile.usable(rule) else None
        if got is None:
            _ai_gate(gate)
            got = (ai_from_file(profile, content, "application/pdf"), "vision")
        data, source = got
    else:
        got = None
        text = ocr_text(content) if profile.ocr else ""
        if len(text) >= MIN_OCR_CHARS:
            try:
                got = _from_text(profile, text[:MAX_TEXT_CHARS], gate)
            except AnalyzerError:
                log.info("OCR metin yolu başarısız; görüntü gönderiliyor (%s)", profile.key)
        if got is None:
            _ai_gate(gate)
            got = (ai_from_file(profile, content, content_type or "image/jpeg"), "vision")
        data, source = got
    _store(db, workspace_id, profile.key, digest, data, source)
    return Result(data, source, digest)


def analyze_text(db: Session, workspace_id: int, profile_key: str, text: str, gate: Gate = None, min_chars: int = 20) -> Result:
    """Yapıştırılan metin (telefonun "metni kopyala" özelliği, e-posta gövdesi…). Kullanıcının kısa notları için `min_chars`
    düşürülebilir."""
    profile = _profile(profile_key)
    text = (text or "").strip()
    if len(text) < min_chars:
        raise AnalyzerError("Metin çok kısa.")
    text = text[:MAX_PASTE_CHARS]
    digest = sha256(re.sub(r"\s+", " ", text).encode())
    hit = _cached(db, workspace_id, profile.key, digest)
    if hit is not None:
        return Result(hit, "cache", digest)
    got = _from_text(profile, text, gate)
    if got is None:
        raise AnalyzerError("Metinden güvenilir bir sonuç çıkarılamadı.")
    _store(db, workspace_id, profile.key, digest, got[0], got[1])
    return Result(got[0], got[1], digest)

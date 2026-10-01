"""Etsy listing fotoğrafları için Gemini 2.5 Flash Image ("nano banana") entegrasyonu.

Üç kullanım şekli, hepsi aynı `_run` çağrısını paylaşır:
- `regenerate_image`: var olan bir fotoğrafı yeniden oluşturur (sihirli değnek — tekli/toplu aynı fonksiyon).
- `generate_from_text`: sıfırdan (kaynak fotoğraf olmadan) yeni bir görsel üretir — ör. henüz hiç
  fotoğrafı olmayan yeni bir listing için.
"""
import mimetypes

from app.core.config import settings

"""Prompt mimarisi: katmanlar birbiriyle çelişmesin diye ayrı tutulur.
  1. IDENTITY_LOCK  — her zaman: ürünün KİMLİĞİ (ne olduğu) değişmez.
  2. QUALITY_BASELINE — her zaman: genel fotoğraf kalitesi beklentisi.
  3. CAMERA_DIRECTIVE — yalnızca kamera açısı seçildiyse: kompozisyonu/çekim açısını DEĞİŞTİRMESİ gerektiğini
     açıkça söyler ve bunun IDENTITY_LOCK'u ihlal etmediğini belirtir — aksi halde model "hiçbir şeyi değiştirme"
     talimatını "kamerayı da sabit tut" diye yorumlayıp isteği görmezden gelebiliyor (gözlemlendi).
  4. SCENE_DIRECTIVE — yalnızca serbest metin girildiyse: sahne/obje eklemeleri.
Kamera ve sahne talimatları kasıtlı olarak AYRI parametreler (`camera_prompt` / `prompt`) — tek bir metin
kutusunda birleştirilip modele "ek talimat" olarak sunulduğunda kamera isteği IDENTITY_LOCK'un genel
"değiştirme" vurgusunun altında kalıp uygulanmıyordu."""

IDENTITY_LOCK = (
    "Bu bir Etsy ürün fotoğrafı. Ürünün kendisini (şekil, renk, desen, logo, yazı, oran, malzeme) birebir koru — "
    "asla değiştirme, uydurma ya da farklı bir ürün üretme. Orijinal fotoğrafın en-boy oranını koru."
)

QUALITY_BASELINE = (
    "Sonuç doğal, profesyonel bir stüdyo/ürün fotoğrafı kalitesinde olsun: temiz ışık, gerçekçi gölge/yansıma, "
    "net odak, dengeli kompozisyon. Yapay/dijital değil, gerçek bir kamerayla çekilmiş gibi görünmeli."
)

CAMERA_DIRECTIVE_TPL = (
    "\n\nKAMERA/ÇEKİM TALİMATI — bunu MUTLAKA uygula: {camera_prompt} Bu bir kamera/kompozisyon değişikliğidir; "
    "sahneyi bu açıya göre yeniden düzenlemen, gerekirse şu an görünmeyen kısımları (ör. ürünün başka bir yüzü, "
    "arkasındaki duvar/zemin) mantıklı biçimde tamamlaman NORMAL ve BEKLENEN bir şeydir. ÖNEMLİ: ürünün kendisi de "
    "bu yeni kamera açısına göre DOĞAL PERSPEKTİFLE (açılı/kısalmış) görünmeli — sahne dönerken ürünü olduğu gibi "
    "düz/karşıdan bakan bir çıkartma gibi sabit bırakma, o da yeni açıya göre 3 boyutlu şekilde dönmüş görünsün. "
    "Yukarıdaki \"ürünü koru\" kuralı yalnızca ürünün KİMLİĞİNİ (ne olduğunu, rengini, desenini) korumanı ister — "
    "kamerayı, kompozisyonu ya da ürünün perspektifini sabit tutmanı istemez, bu talimatı görmezden gelme."
)

DISTANCE_DIRECTIVE_TPL = (
    "\n\nÇEKİM MESAFESİ/KADRAJ TALİMATI — bunu MUTLAKA uygula: {distance_prompt}"
)

SCENE_DIRECTIVE_TPL = (
    "\n\nSAHNE TALİMATI: {prompt}\n\nBu talimatı uygula, ama yalnızca talimatın gerektirdiği kısmı değiştir (ör. "
    "yalnızca arka plan/sahne/model ekleniyorsa) — talimatta geçmeyen her şeyi (ürünün kendisi, diğer detaylar) "
    "olduğu gibi koru."
)

SUBJECT_REFERENCE_DIRECTIVE = (
    "\n\nÖNEMLİ — ürün kimliği referansı: {ordinal} verilen görsel, ÜRÜNÜN KENDİSİNİN net/temiz bir referans "
    "fotoğrafıdır. Düzenlenecek asıl sahnede birden fazla obje olsa ya da ürün net seçilemese bile, hangi "
    "objenin ürün olduğuna bu referanstan karar ver ve onun şeklini/rengini/desenini/oranını BİREBİR bu "
    "referansa göre koru."
)


def _build_prompt(prompt: str | None, camera_prompt: str | None, distance_prompt: str | None = None) -> str:
    parts = [IDENTITY_LOCK, " ", QUALITY_BASELINE]
    if camera_prompt and camera_prompt.strip():
        parts.append(CAMERA_DIRECTIVE_TPL.format(camera_prompt=camera_prompt.strip()))
    if distance_prompt and distance_prompt.strip():
        parts.append(DISTANCE_DIRECTIVE_TPL.format(distance_prompt=distance_prompt.strip()))
    if prompt and prompt.strip():
        parts.append(SCENE_DIRECTIVE_TPL.format(prompt=prompt.strip()))
    return "".join(parts)


class ImageGenError(Exception):
    pass


def _provider_ready() -> None:
    if not settings.google_api_key:
        raise ImageGenError("Gemini API anahtarı tanımlı değil. Ayarlar > API anahtarları bölümünden ekleyin.")


def _run(parts: list) -> tuple[bytes, str]:
    _provider_ready()
    from app.ai.client import get_google_client
    from google.genai import types

    client = get_google_client()
    try:
        response = client.models.generate_content(
            model=settings.google_image_model,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                # Çözünürlük yükseldikçe fiyat da artar; Ayarlar'dan seçilebilir (varsayılan 2K — Etsy'nin
                # önerdiği ≥2000px eşiğini karşılar).
                image_config=types.ImageConfig(image_size=settings.google_image_size),
            ),
        )
    except Exception as exc:  # noqa: BLE001
        text = str(exc)
        if "RESOURCE_EXHAUSTED" in text or "429" in text:
            raise ImageGenError(
                "Gemini API kotanız doldu (ücretsiz kademe günlük/dakikalık limiti). Google AI Studio'dan "
                "kotanızı kontrol edin ya da bir süre sonra tekrar deneyin."
            ) from exc
        raise ImageGenError(f"Gemini görsel üretemedi: {text[:200]}") from exc

    texts: list[str] = []
    for candidate in response.candidates or []:
        for part in candidate.content.parts or []:
            if part.inline_data and part.inline_data.data:
                mime = part.inline_data.mime_type or "image/png"
                return part.inline_data.data, mime
            if part.text:
                texts.append(part.text.strip())

    # Görsel yoksa nedenini elden geldiğince açığa çıkar: model bazen görsel yerine metin (ör. reddetme
    # gerekçesi) döndürüyor, ya da safety/finish_reason bunu açıklıyor — "tekrar dene" tek başına yeterli
    # teşhis vermiyor, kullanıcı aynı hatayla defalarca karşılaşabiliyor.
    reasons: list[str] = []
    block_reason = getattr(response.prompt_feedback, "block_reason", None) if response.prompt_feedback else None
    if block_reason:
        reasons.append(f"istek engellendi: {block_reason}")
    for candidate in response.candidates or []:
        fr = candidate.finish_reason
        if fr and str(fr) not in ("FinishReason.STOP", "STOP"):
            reasons.append(f"bitiş nedeni: {fr}")
    if texts:
        reasons.append(f"model metni: {' '.join(texts)[:200]}")

    detail = f" ({'; '.join(reasons)})" if reasons else ""
    raise ImageGenError(f"Gemini bir görsel döndürmedi, tekrar dene.{detail}")


def regenerate_image(
    image_bytes: bytes,
    content_type: str,
    prompt: str | None = None,
    reference: tuple[bytes, str] | None = None,
    camera_prompt: str | None = None,
    distance_prompt: str | None = None,
    subject_reference: tuple[bytes, str] | None = None,
) -> tuple[bytes, str]:
    """Tek bir ürün fotoğrafını yeniden oluşturur. `prompt` sahne talimatı, `camera_prompt` (kamera açısı
    küpünden) ve `distance_prompt` (mesafe/kadraj seçiciden) ayrı, öncelikli talimat katmanları olarak
    eklenir — bkz. `_build_prompt`, hepsi kasıtlı olarak birbirine karıştırılmaz. `reference`: (bytes,
    content_type) — ör. bir model/mockup fotoğrafı; verilirse ürün onun üstüne/yanına doğal şekilde
    yerleştirilir. `subject_reference`: sahnede birden fazla obje olduğunda "ürün bu" diye işaret eden
    ayrı, temiz bir ürün fotoğrafı. Döner: (yeni görsel bytes, mime)."""
    from google.genai import types

    full_prompt = _build_prompt(prompt, camera_prompt, distance_prompt)

    parts = [types.Part.from_bytes(data=image_bytes, mime_type=content_type)]
    if reference is not None:
        ref_bytes, ref_type = reference
        parts.append(types.Part.from_bytes(data=ref_bytes, mime_type=ref_type))
        full_prompt += (
            "\n\nİkinci verilen görsel bir referans (ör. model/mockup) fotoğrafıdır; ürünü onun üzerine/içine "
            "ışık ve perspektif uyumlu, gerçekçi şekilde yerleştir."
        )
    if subject_reference is not None:
        subj_bytes, subj_type = subject_reference
        parts.append(types.Part.from_bytes(data=subj_bytes, mime_type=subj_type))
        ordinal = "üçüncü" if reference is not None else "ikinci"
        full_prompt += SUBJECT_REFERENCE_DIRECTIVE.format(ordinal=ordinal)
    parts.append(types.Part.from_text(text=full_prompt))
    return _run(parts)


def generate_from_text(prompt: str, reference: tuple[bytes, str] | None = None) -> tuple[bytes, str]:
    """Kaynak fotoğraf olmadan, yalnızca metin talimatından yeni bir görsel üretir — sıfırdan listing
    oluştururken kullanılır. `reference` verilirse (ör. aynı listing'in başka bir fotoğrafı ya da bir
    stil/model referansı) o görsele bakarak tutarlı üretir."""
    from google.genai import types

    full_prompt = (
        "Etsy'de satılacak bir ürünün profesyonel, gerçekçi (yapay/dijital görünmeyen) bir ürün/pazarlama "
        f"fotoğrafını üret. İstek: {prompt.strip()}\n\n"
        "Gerçek bir kamerayla çekilmiş gibi doğal ışık, gölge ve kompozisyon kullan. Ürünün kadrajda yalnızca "
        "BİR KEZ göründüğünden emin ol — asla ikinci bir hayalet/kopya/yansıma kopyası ekleme."
    )
    parts: list = []
    if reference is not None:
        ref_bytes, ref_type = reference
        parts.append(types.Part.from_bytes(data=ref_bytes, mime_type=ref_type))
        full_prompt += (
            "\n\nVerilen referans görseldeki ÜRÜNÜN KENDİSİNİ (şekli, oranı, üzerindeki YAZI/LOGO/METNİ harf "
            "harf, rengi, malzemesi, deseni) BİREBİR AYNI şekilde koru — asla değiştirme, uydurma, çarpıtma ya "
            "da yazıyı yanlış/bulanık/tekrar eden şekilde yeniden çizme. Yalnızca sahneyi/açıyı/mesafeyi/ışığı "
            "isteğe göre farklılaştır. Referansın en-boy oranına yakın kal, aşırı uzun/dar bir kadraj üretme."
        )
    parts.append(types.Part.from_text(text=full_prompt))
    return _run(parts)


def guess_extension(mime: str) -> str:
    return mimetypes.guess_extension(mime) or ".png"

"""Etsy listing fotoğrafları için Gemini 2.5 Flash Image ("nano banana") entegrasyonu.

Üç kullanım şekli, hepsi aynı `_run` çağrısını paylaşır:
- `regenerate_image`: var olan bir fotoğrafı yeniden oluşturur (sihirli değnek — tekli/toplu aynı fonksiyon).
- `generate_from_text`: sıfırdan (kaynak fotoğraf olmadan) yeni bir görsel üretir — ör. henüz hiç
  fotoğrafı olmayan yeni bir listing için.
"""
import mimetypes

from app.ai import catalog
from app.billing import metering
from app.core.i18n import tr

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

NO_BRAND = (
    "\n\nMARKA KURALI: Başkalarının marka/ticari marka adı, logosu ya da sloganı görselde OLMASIN (Stanley, Yeti, Hydro Flask, "
    "Nike vb.) — ürün şekli bilinen bir markaya benzese bile marka yazısı UYDURMA. İSTİSNA: satıcının KENDİ markası/logosu — "
    "istekte adı verilmişse ya da logo görseli olarak referans verilmişse — istenen yere aynen (harfi, rengi, oranı bozmadan) "
    "yerleştirilir. Kişiselleştirme yazısı ve referans fotoğrafta zaten bulunan yazı da korunur."
)

LOGO_DIRECTIVE = (
    "\n\nLOGO TALİMATI: {ordinal} verilen görsel satıcının KENDİ logosudur. Onu ürünün üzerine, istenen yere (istek bir yer "
    "belirtmiyorsa ürünün doğal, görünür ve küçük bir noktasına) yerleştir: logonun şeklini, harflerini, renklerini ve oranını "
    "BİREBİR koru; yeniden çizme, çarpıtma, yazısını değiştirme, ikinci kopya ekleme. Ürünün yüzeyine uygun perspektif, ışık ve "
    "malzeme (baskı/kabartma/oyma) uyumu ver. Logo dışında başka marka ekleme."
)

CAMERA_DIRECTIVE_TPL = (
    "\n\nKAMERA TALİMATI — bunu MUTLAKA uygula: {camera_prompt}\n"
    "Bu bir KAMERA konumu değişikliğidir: dünya (duvar, zemin, mobilya, ürün, ışık, gölgeler) sabit kalır, yalnızca kameranın bakış noktası "
    "değişir. Ürünü ya da başka bir nesneyi tek başına döndürme, eğme, çarpıtma. Görüntünün TAMAMINI (arka plan, duvar/zemin düzlemleri, "
    "mobilya, ürün) yeni bakış noktasından tutarlı tek bir perspektifle yeniden çiz: aynı düzlemdeki nesneler aynı kaçış noktalarını paylaşır "
    "(ör. duvardaki bir ürün, duvarla birlikte aynı açıyla kısalır; duvardan bağımsız dönmüş gibi görünmez). Yeni bakış noktasında görünmeyen "
    "kısımları (ürünün yan yüzü, odanın görünmeyen köşesi, arka plan) mantıklı biçimde tamamla. Ürünün kimliği (şekil, renk, desen, yazı, oran, "
    "malzeme) değişmez; yalnızca bakış noktasına göre görünümü değişir. \"Ürünü koru\" kuralı kompozisyonu ya da perspektifi sabit tutmanı "
    "istemez; bu kamera talimatını görmezden gelme."
)

DISTANCE_DIRECTIVE_TPL = (
    "\n\nÇEKİM MESAFESİ/KADRAJ TALİMATI — bunu MUTLAKA uygula: {distance_prompt}\n"
    "Kadraj kamera mesafesiyle belirlenir: kamerayı ürüne yaklaştır ya da geri çek; görüntüyü dijital olarak büyütüp küçültme. Perspektif "
    "tutarlı kalır, ürünün kimliği (şekil, renk, yazı, oran) değişmez, kadrajın dışında kalan çevreyi gerekiyorsa mantıklı biçimde tamamla."
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
    parts.append(NO_BRAND)
    return "".join(parts)


class ImageGenError(Exception):
    pass


# Modelin desteklediği en-boy oranları. Kaynak fotoğraf belirgin biçimde geniş/dar ise (ör. 2.3:1 duvar panosu) sahne de ona yakın bir oranda üretilir; aksi halde model kareye
# sığdırıp ürünün uçlarını keser.
_ASPECTS = {"1:1": 1.0, "2:3": 2 / 3, "3:2": 1.5, "3:4": 0.75, "4:3": 4 / 3, "4:5": 0.8, "5:4": 1.25, "9:16": 9 / 16, "16:9": 16 / 9, "21:9": 21 / 9, "4:1": 4.0, "1:4": 0.25}
FULL_PRODUCT = (
    "\n\nÜRÜN KADRAJDA TAMAMEN görünsün: hiçbir kenarından kesilmesin, ucu/köşesi kadraj dışında kalmasın; kaynak görseldeki en-boy oranını ({ratio} civarı) koru, ürünü kısaltma, ezme ya da uzatma."
)


def source_aspect(image_bytes: bytes) -> tuple[str | None, float | None]:
    """Kaynak belirgin biçimde geniş (>=1.5) ya da dar (<=0.67) ise en yakın desteklenen oran ve gerçek oran; kareye yakınsa (None, oran), okunamazsa (None, None)."""
    import io
    import math

    from PIL import Image

    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            ratio = im.width / im.height
    except Exception:  # noqa: BLE001 - okunamayan görselde model kendi oranını seçer
        return None, None
    if 0.67 < ratio < 1.5:
        return None, ratio
    return min(_ASPECTS, key=lambda k: abs(math.log(_ASPECTS[k] / ratio))), ratio


def _choose(model_db_id: int | None, variant_key: str | None, task: str = "image") -> tuple[catalog.ResolvedModel, catalog.Variant | None]:
    """Kullanıcının seçtiği görsel modeli ve seçeneği; seçim yoksa görevin ("image", "upscale") modeli ve varsayılan seçeneği.
    Şimdilik yalnızca Google (Gemini görsel modelleri) destekleniyor."""
    try:
        return catalog.resolve_choice(task, model_db_id, variant_key)
    except catalog.NotConfigured as exc:
        raise ImageGenError(str(exc)) from exc


def _run(parts: list, aspect_ratio: str | None = None, model_db_id: int | None = None, variant_key: str | None = None, task: str = "image") -> tuple[bytes, str]:
    """`aspect_ratio` verilmezse model girdi görselinin oranını korur (listing fotoğrafları); verilirse ("4:1", "8:1",
    "1:1"…) o oranda üretir. gemini-3.1-flash-image 4:1 ve 8:1'i de kabul ediyor (banner'lar, 2026-10-05'te denendi)."""
    model, variant = _choose(model_db_id, variant_key, task)
    from app.ai.client import get_google_client
    from google.genai import types

    client = get_google_client()
    # Çözünürlük seçilen seçenekten gelir (Yönetim > Modeller); fiyatı da o seçenek belirler. Seçenek yoksa 2K — Etsy'nin
    # önerdiği ≥2000px eşiğini karşılar.
    image_size = str((variant.params if variant else {}).get("image_size") or "2K")
    image_config = types.ImageConfig(image_size=image_size, aspect_ratio=aspect_ratio)
    try:
        response = client.models.generate_content(
            model=model.model_id,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(response_modalities=["IMAGE"], image_config=image_config),
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
                # Yalnızca görsel dönen çağrı ücretlendirilir (Google da görsel başına ücret alır).
                metering.record_units("image", model, variant)
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


def _ordinal(n: int) -> str:
    """`n`. görsel (1'den başlar) için Türkçe sıra sözcüğü; istemler görselleri verilme sırasıyla anar."""
    return {1: "birinci", 2: "ikinci", 3: "üçüncü", 4: "dördüncü"}.get(n, f"{n}.")


def regenerate_image(
    image_bytes: bytes,
    content_type: str,
    prompt: str | None = None,
    reference: tuple[bytes, str] | None = None,
    camera_prompt: str | None = None,
    distance_prompt: str | None = None,
    subject_reference: tuple[bytes, str] | None = None,
    model_db_id: int | None = None,
    variant_key: str | None = None,
    logo: tuple[bytes, str] | None = None,
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
    if logo is not None:
        parts.append(types.Part.from_bytes(data=logo[0], mime_type=logo[1]))
        full_prompt += LOGO_DIRECTIVE.format(ordinal=_ordinal(len(parts)))
    aspect, ratio = source_aspect(image_bytes)
    if aspect and ratio:
        full_prompt += FULL_PRODUCT.format(ratio=f"{ratio:.1f}:1" if ratio >= 1 else f"1:{1 / ratio:.1f}")
    parts.append(types.Part.from_text(text=full_prompt))
    return _run(parts, aspect, model_db_id, variant_key)


def generate_from_text(
    prompt: str, reference: tuple[bytes, str] | None = None, model_db_id: int | None = None, variant_key: str | None = None,
    logo: tuple[bytes, str] | None = None,
) -> tuple[bytes, str]:
    """Kaynak fotoğraf olmadan, yalnızca metin talimatından yeni bir görsel üretir — sıfırdan listing
    oluştururken kullanılır. `reference` verilirse (ör. aynı listing'in başka bir fotoğrafı ya da bir
    stil/model referansı) o görsele bakarak tutarlı üretir. Model ve seçenek (çözünürlük) kullanıcının seçimidir."""
    from google.genai import types

    full_prompt = (
        "Etsy'de satılacak bir ürünün profesyonel, gerçekçi (yapay/dijital görünmeyen) bir ürün/pazarlama "
        f"fotoğrafını üret. İstek: {prompt.strip()}\n\n"
        "Gerçek bir kamerayla çekilmiş gibi doğal ışık, gölge ve kompozisyon kullan. Ürünün kadrajda yalnızca "
        "BİR KEZ göründüğünden emin ol — asla ikinci bir hayalet/kopya/yansıma kopyası ekleme."
        + NO_BRAND
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
    if logo is not None:
        parts.append(types.Part.from_bytes(data=logo[0], mime_type=logo[1]))
        full_prompt += LOGO_DIRECTIVE.format(ordinal=_ordinal(len(parts)))
    parts.append(types.Part.from_text(text=full_prompt))
    return _run(parts, model_db_id=model_db_id, variant_key=variant_key)


UPSCALE_SIZES = ("2K", "4K")

UPSCALE_PROMPT = (
    "Bu görseli YALNIZCA daha yüksek çözünürlüğe yükselt (upscale). İçeriği, kompozisyonu, kadrajı, renkleri, ürünü ve üzerindeki tüm "
    "yazı/logoyu birebir koru; hiçbir nesne ekleme, çıkarma ya da değiştirme, sahneyi yeniden çizme. Yalnızca keskinliği ve ince "
    "detayı artır, sıkıştırma gürültüsünü ve bulanıklığı gider. Orijinal en-boy oranını koru."
)


def upscale_variant(size: str) -> tuple[catalog.ResolvedModel, catalog.Variant]:
    """"upscale" görevinin modeli ve istenen çözünürlüğün (2K/4K) fiyat seçeneği; yönetici o boyut için seçenek tanımlamadıysa hata."""
    if size not in UPSCALE_SIZES:
        raise ValueError(f"Boyut {' ya da '.join(UPSCALE_SIZES)} olmalı.")
    try:
        model = catalog.resolve_ready("upscale")
    except catalog.NotConfigured as exc:
        raise ImageGenError(str(exc)) from exc
    variant = next((v for v in model.variants if str(v.params.get("image_size", "")).upper() == size), None)
    if variant is None:
        raise ImageGenError(tr(f"{size} yükseltme şu an kullanılamıyor.", f"{size} upscaling is not available right now."))
    return model, variant


def upscale_image(image_bytes: bytes, content_type: str, size: str) -> tuple[bytes, str]:
    """Aynı fotoğrafı yalnızca çözünürlüğü artırarak yeniden üretir (içerik değişmez). Fiyat, modelin o boyuttaki seçeneğindendir."""
    from google.genai import types

    model, variant = upscale_variant(size)
    parts = [types.Part.from_bytes(data=image_bytes, mime_type=content_type), types.Part.from_text(text=UPSCALE_PROMPT)]
    return _run(parts, None, model.id, variant.key, "upscale")


def generate_with_references(prompt: str, references: list[tuple[bytes, str]], aspect_ratio: str) -> tuple[bytes, str]:
    """Referans görsellerle (ör. mağazanın ürün fotoğrafları) ve istenen oranda yeni bir görsel üretir. Talimatı çağıran
    hazırlar (bkz. banners/prompts.py); burada yalnızca görseller ve metin modele iletilir."""
    from google.genai import types

    parts: list = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in references]
    parts.append(types.Part.from_text(text=prompt))
    return _run(parts, aspect_ratio=aspect_ratio)


def guess_extension(mime: str) -> str:
    return mimetypes.guess_extension(mime) or ".png"

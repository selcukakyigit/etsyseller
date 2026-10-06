"""Video üretimi (Replicate). Model, seçenek ve süre katalogdan gelir (Yönetim > Modeller); burada yalnızca sağlayıcıyla
konuşulur.

Video üretimi onlarca saniye sürdüğü için iş iki adımdır: `start` tahmini başlatır ve kimliğini döner, `status` durumu
sorar. Sonucu kaydetmek ve kredisini düşmek çağıranın işidir (bkz. listings/drafts.py), çünkü sonucun nereye ait olduğunu
o bilir.

Seçeneğin parametreleri (ör. {"resolution": "720p", "draft": false}) modele olduğu gibi gider; `prompt`, `duration` ve
varsa başlangıç görseli (`image`) her video modelinde bu adlarla beklenir. Farklı adlar kullanan bir model eklenirse
burada eşlenir."""
import base64
from dataclasses import dataclass

import httpx

from app.ai import catalog
from app.ai.client import REPLICATE_API, replicate_headers
from app.core.i18n import tr

REQUEST_TIMEOUT = 30
DOWNLOAD_TIMEOUT = 120


class VideoGenError(Exception):
    pass


@dataclass(frozen=True)
class Prediction:
    status: str  # running | succeeded | failed
    output_url: str | None = None
    error: str | None = None


def choose(model_db_id: int | None, variant_key: str | None) -> tuple[catalog.ResolvedModel, catalog.Variant | None]:
    try:
        return catalog.resolve_choice("video", model_db_id, variant_key)
    except catalog.NotConfigured as exc:
        raise VideoGenError(str(exc)) from exc


def durations(model: catalog.ResolvedModel) -> list[int]:
    return [int(d) for d in model.options.get("durations") or [5]]


def _provider_error(exc: Exception) -> VideoGenError:
    detail = ""
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            detail = str(exc.response.json().get("detail") or "")
        except ValueError:
            detail = exc.response.text
    detail = (detail or str(exc))[:200]
    return VideoGenError(tr(f"Video sağlayıcısı hata verdi: {detail}", f"The video provider returned an error: {detail}"))


def start(
    model: catalog.ResolvedModel, variant: catalog.Variant | None, prompt: str, duration: int, image: tuple[bytes, str] | None = None,
) -> str:
    """Tahmini başlatır, kimliğini döner. `model_id` "sahip/ad" ise modelin son sürümü, "sahip/ad:sürüm" ise o sürüm
    kullanılır."""
    payload_input: dict = {"prompt": prompt, "duration": duration, **(variant.params if variant else {})}
    if image is not None:
        data, mime = image
        payload_input["image"] = f"data:{mime or 'image/jpeg'};base64,{base64.b64encode(data).decode()}"
    name, _, version = model.model_id.partition(":")
    if version:
        url, body = f"{REPLICATE_API}/predictions", {"version": version, "input": payload_input}
    else:
        url, body = f"{REPLICATE_API}/models/{name}/predictions", {"input": payload_input}
    try:
        r = httpx.post(url, json=body, headers=replicate_headers(), timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
    except httpx.HTTPError as exc:
        raise _provider_error(exc) from exc
    return str(r.json()["id"])


def status(prediction_id: str) -> Prediction:
    try:
        r = httpx.get(f"{REPLICATE_API}/predictions/{prediction_id}", headers=replicate_headers(), timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
    except httpx.HTTPError as exc:
        raise _provider_error(exc) from exc
    data = r.json()
    state = data.get("status")
    if state == "succeeded":
        output = data.get("output")
        url = output[0] if isinstance(output, list) and output else output
        if not isinstance(url, str) or not url:
            return Prediction("failed", error=tr("Model video döndürmedi.", "The model returned no video."))
        return Prediction("succeeded", output_url=url)
    if state in ("failed", "canceled"):
        detail = str(data.get("error") or state)[:200]
        return Prediction("failed", error=tr(f"Video üretilemedi: {detail}", f"Could not generate the video: {detail}"))
    return Prediction("running")


def download(url: str) -> tuple[bytes, str]:
    try:
        r = httpx.get(url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True)
        r.raise_for_status()
    except httpx.HTTPError as exc:
        raise _provider_error(exc) from exc
    mime = (r.headers.get("content-type") or "video/mp4").split(";")[0].strip()
    return r.content, mime if mime.startswith("video/") else "video/mp4"

"""Sağlayıcıdan bağımsız araç kullanan (tool-use) sohbet döngüsü: OpenAI ve Claude (Anthropic).

`run_agent`, modele araçları sunar; model bir araç çağırırsa `execute(name, args)` ile çalıştırıp sonucu geri verir ve
model nihai metni yazana kadar (en fazla MAX_ROUNDS tur) devam eder."""
import base64
import json
import logging
from typing import Callable

from app.ai.client import get_anthropic_client, get_openai_client
from app.core.config import settings

log = logging.getLogger(__name__)

MAX_ROUNDS = 9
MAX_TOKENS = 2500


class AssistantError(Exception):
    """Kullanıcıya gösterilecek anlaşılır hata (anahtar yok, sağlayıcı hatası vb.)."""


def provider_ready(provider: str) -> bool:
    return bool(settings.anthropic_api_key if provider == "anthropic" else settings.openai_api_key)


def available_providers() -> list[dict]:
    return [
        {"id": "openai", "label": f"OpenAI ({settings.openai_model})", "ready": provider_ready("openai")},
        {"id": "anthropic", "label": f"Claude ({settings.anthropic_model})", "ready": provider_ready("anthropic")},
    ]


def _image(i: dict) -> tuple[str, str]:
    """(media type, base64) — büyük resimler sağlayıcı sınırına göre küçültülür (bkz. ai/images.py)."""
    from app.ai.images import for_llm
    from app.core import blobstore

    data, ctype = for_llm(blobstore.read(i["path"]), i["content_type"])
    return ctype, base64.b64encode(data).decode()


def run_agent(
    provider: str,
    system: str,
    history: list[dict],
    user_text: str,
    images: list[dict],
    tools: list[dict],
    execute: Callable[[str, dict], dict],
) -> str:
    """history: [{"role": "user"|"assistant", "content": str}]. images: [{"path", "content_type"}] (yalnızca bu mesajın resimleri).
    Döner: asistanın nihai metni."""
    if not provider_ready(provider):
        name = "Claude (Anthropic)" if provider == "anthropic" else "OpenAI"
        raise AssistantError(f"{name} API anahtarı tanımlı değil. Ayarlar > API anahtarları bölümünden ekleyin ya da diğer sağlayıcıyı seçin.")
    try:
        if provider == "anthropic":
            return _run_anthropic(system, history, user_text, images, tools, execute)
        return _run_openai(system, history, user_text, images, tools, execute)
    except AssistantError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("Asistan sağlayıcı hatası (%s)", provider)
        raise AssistantError(f"Yapay zekâ sağlayıcısı hata verdi: {str(exc)[:300]}") from exc


def _tool_result(execute: Callable[[str, dict], dict], name: str, args: dict) -> str:
    try:
        return json.dumps(execute(name, args), ensure_ascii=False, default=str)
    except Exception as exc:  # noqa: BLE001 — model hatayı görüp kendini düzeltebilsin
        log.exception("Araç hatası: %s", name)
        return json.dumps({"error": f"{type(exc).__name__}: {str(exc)[:300]}"}, ensure_ascii=False)


# ------------------------------------------------------------------ OpenAI

def _run_openai(system, history, user_text, images, tools, execute) -> str:
    client = get_openai_client()
    content: list[dict] | str = user_text
    if images:
        content = [{"type": "text", "text": user_text}] + [
            {"type": "image_url", "image_url": {"url": "data:{};base64,{}".format(*_image(i))}} for i in images
        ]
    messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": content}]
    oa_tools = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in tools]
    for _ in range(MAX_ROUNDS):
        resp = client.chat.completions.create(model=settings.openai_model, messages=messages, tools=oa_tools, max_tokens=MAX_TOKENS)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return (msg.content or "").strip()
        messages.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [{"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}} for c in msg.tool_calls],
        })
        for c in msg.tool_calls:
            try:
                args = json.loads(c.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            messages.append({"role": "tool", "tool_call_id": c.id, "content": _tool_result(execute, c.function.name, args)})
    return "Çok fazla adım gerekti; isteği daha küçük parçalara bölüp tekrar dener misin?"


# ------------------------------------------------------------------ Claude

def _run_anthropic(system, history, user_text, images, tools, execute) -> str:
    client = get_anthropic_client()
    blocks: list[dict] = [
        {"type": "image", "source": dict(zip(("type", "media_type", "data"), ("base64", *_image(i))))} for i in images
    ]
    blocks.append({"type": "text", "text": user_text})
    messages = [*history, {"role": "user", "content": blocks}]
    for _ in range(MAX_ROUNDS):
        resp = client.messages.create(model=settings.anthropic_model, max_tokens=MAX_TOKENS, system=system, messages=messages, tools=tools)
        if resp.stop_reason != "tool_use":
            return "".join(b.text for b in resp.content if b.type == "text").strip()
        assistant_blocks = []
        results = []
        for b in resp.content:
            if b.type == "text":
                assistant_blocks.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                assistant_blocks.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": _tool_result(execute, b.name, b.input or {})})
        messages.append({"role": "assistant", "content": assistant_blocks})
        messages.append({"role": "user", "content": results})
    return "Çok fazla adım gerekti; isteği daha küçük parçalara bölüp tekrar dener misin?"

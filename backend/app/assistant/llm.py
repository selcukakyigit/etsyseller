"""Sağlayıcıdan bağımsız araç kullanan (tool-use) sohbet döngüsü: OpenAI ve Claude (Anthropic).

`run_agent`, modele araçları sunar; model bir araç çağırırsa `execute(name, args)` ile çalıştırıp sonucu geri verir ve
model nihai metni yazana kadar (en fazla MAX_ROUNDS tur) devam eder.

İstem önbelleği (prompt caching): istem `static` (araçlar + sabit kurallar, her istekte aynı) ve `dynamic` (mağaza
bilgisi) olarak gelir; sabit kısım başta durur. OpenAI aynı başlangıcı kendiliğinden önbelleğe alır. Claude'da sabit
kısmın sonuna ve her turda son mesaja işaret konur: bir istek içindeki araç turları da bir öncekinin önbelleğinden okur.
Her turun token kullanımı `Usage`'da toplanır (maliyet izleme)."""
import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Callable

from app.ai import catalog
from app.ai.catalog import ResolvedModel
from app.ai.client import get_anthropic_client, get_openai_client
from app.core.i18n import tr

log = logging.getLogger(__name__)

MAX_ROUNDS = 9
MAX_TOKENS = 2500
_CACHE = {"type": "ephemeral"}


class AssistantError(Exception):
    """Kullanıcıya gösterilecek anlaşılır hata (anahtar yok, sağlayıcı hatası vb.)."""


@dataclass
class Usage:
    """Bir isteğin tüm turlarının toplamı. input_tokens önbellekten okunanlar dahil toplam girdidir."""

    provider: str
    model: str
    rounds: int = 0
    input_tokens: int = 0
    cached_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    tools: list[str] = field(default_factory=list)


@dataclass
class AgentResult:
    text: str
    usage: Usage


def _choice_id(m: ResolvedModel) -> str:
    """Seçicideki kimlik: katalog modelinin numarası; katalog okunamıyorsa (.env'e düşülmüşse) sağlayıcı adı."""
    return str(m.id) if m.id is not None else m.provider


def available_providers() -> list[dict]:
    """Asistandaki model seçicinin seçenekleri: katalogdaki aktif metin modelleri (Yönetim > Modeller)."""
    return [{"id": _choice_id(m), "label": m.label, "ready": catalog.ready(m)} for m in catalog.choices("llm")]


def default_choice() -> str:
    return _choice_id(catalog.resolve("assistant"))


def pick_model(choice: str | None) -> ResolvedModel:
    """Kullanıcının seçtiği model; seçim geçersizse ya da artık aktif değilse asistan görevinin modeli. Eski istemciler
    sağlayıcı adı ("openai" / "anthropic") gönderebilir; o sağlayıcının ilk aktif modeli kullanılır."""
    if choice and choice.isdigit():
        model = catalog.by_id(int(choice), "llm")
        if model is not None:
            return model
    if choice:
        model = next((m for m in catalog.choices("llm") if m.provider == choice), None)
        if model is not None:
            return model
    return catalog.resolve("assistant")


def missing_key_message() -> str:
    return tr(
        "Seçili model şu an kullanılamıyor (sağlayıcı anahtarı tanımlı değil). Yukarıdan başka bir model seç.",
        "The selected model is unavailable right now (no provider key is set). Pick another model above.",
    )


def _too_many_steps() -> str:
    return tr("Çok fazla adım gerekti; isteği daha küçük parçalara bölüp tekrar dener misin?", "This needed too many steps; could you split the request into smaller parts and try again?")


def _image(i: dict) -> tuple[str, str]:
    """(media type, base64) — büyük resimler sağlayıcı sınırına göre küçültülür (bkz. ai/images.py)."""
    from app.ai.images import for_llm
    from app.core import blobstore

    data, ctype = for_llm(blobstore.read(i["path"]), i["content_type"])
    return ctype, base64.b64encode(data).decode()


def run_agent(
    model: ResolvedModel,
    static: str,
    dynamic: str,
    history: list[dict],
    user_text: str,
    images: list[dict],
    tools: list[dict],
    execute: Callable[[str, dict], dict],
) -> AgentResult:
    """history: [{"role": "user"|"assistant", "content": str}]. images: [{"path", "content_type"}] (yalnızca bu mesajın resimleri)."""
    if not catalog.ready(model):
        raise AssistantError(missing_key_message())
    usage = Usage(provider=model.provider, model=model.model_id)
    try:
        run = _run_anthropic if model.provider == "anthropic" else _run_openai
        text = run(static, dynamic, history, user_text, images, tools, execute, usage)
    except AssistantError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("Asistan sağlayıcı hatası (%s/%s)", model.provider, model.model_id)
        raise AssistantError(tr(f"Yapay zekâ sağlayıcısı hata verdi: {str(exc)[:300]}", f"The AI provider returned an error: {str(exc)[:300]}")) from exc
    return AgentResult(text, usage)


def _tool_result(execute: Callable[[str, dict], dict], name: str, args: dict, usage: Usage) -> str:
    usage.tools.append(name)
    try:
        return json.dumps(execute(name, args), ensure_ascii=False, default=str)
    except Exception as exc:  # noqa: BLE001 — model hatayı görüp kendini düzeltebilsin
        log.exception("Araç hatası: %s", name)
        return json.dumps({"error": f"{type(exc).__name__}: {str(exc)[:300]}"}, ensure_ascii=False)


# ------------------------------------------------------------------ OpenAI


def _run_openai(static, dynamic, history, user_text, images, tools, execute, usage: Usage) -> str:
    client = get_openai_client()
    content: list[dict] | str = user_text
    if images:
        content = [{"type": "text", "text": user_text}] + [
            {"type": "image_url", "image_url": {"url": "data:{};base64,{}".format(*_image(i))}} for i in images
        ]
    # Sabit kısım başta: OpenAI aynı başlangıcı (araçlar + sistem isteminin başı) kendiliğinden önbelleğe alır.
    messages = [{"role": "system", "content": f"{static}\n\n{dynamic}"}, *history, {"role": "user", "content": content}]
    oa_tools = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in tools]
    for _ in range(MAX_ROUNDS):
        resp = client.chat.completions.create(model=usage.model, messages=messages, tools=oa_tools, max_tokens=MAX_TOKENS)
        _add_openai_usage(usage, resp)
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
            messages.append({"role": "tool", "tool_call_id": c.id, "content": _tool_result(execute, c.function.name, args, usage)})
    return _too_many_steps()


def _add_openai_usage(usage: Usage, resp) -> None:
    usage.rounds += 1
    u = getattr(resp, "usage", None)
    if u is None:
        return
    usage.input_tokens += u.prompt_tokens or 0
    usage.output_tokens += u.completion_tokens or 0
    details = getattr(u, "prompt_tokens_details", None)
    usage.cached_tokens += (getattr(details, "cached_tokens", 0) or 0) if details else 0


# ------------------------------------------------------------------ Claude


def _mark_last_message(messages: list[dict]) -> None:
    """Önbellek işaretini son mesajın son bloğuna taşır (Claude en fazla 4 işaret kabul eder; eskiler kaldırılır)."""
    for m in messages:
        if isinstance(m["content"], list):
            for block in m["content"]:
                block.pop("cache_control", None)
    last = messages[-1]
    if isinstance(last["content"], str):
        last["content"] = [{"type": "text", "text": last["content"]}]
    last["content"][-1]["cache_control"] = _CACHE


def _run_anthropic(static, dynamic, history, user_text, images, tools, execute, usage: Usage) -> str:
    client = get_anthropic_client()
    system = [{"type": "text", "text": static, "cache_control": _CACHE}, {"type": "text", "text": dynamic}]
    blocks: list[dict] = [
        {"type": "image", "source": dict(zip(("type", "media_type", "data"), ("base64", *_image(i))))} for i in images
    ]
    blocks.append({"type": "text", "text": user_text})
    messages = [*({"role": h["role"], "content": h["content"]} for h in history), {"role": "user", "content": blocks}]
    for _ in range(MAX_ROUNDS):
        _mark_last_message(messages)
        resp = client.messages.create(model=usage.model, max_tokens=MAX_TOKENS, system=system, messages=messages, tools=tools)
        _add_anthropic_usage(usage, resp)
        if resp.stop_reason != "tool_use":
            return "".join(b.text for b in resp.content if b.type == "text").strip()
        assistant_blocks = []
        results = []
        for b in resp.content:
            if b.type == "text":
                assistant_blocks.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                assistant_blocks.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": _tool_result(execute, b.name, b.input or {}, usage)})
        messages.append({"role": "assistant", "content": assistant_blocks})
        messages.append({"role": "user", "content": results})
    return _too_many_steps()


def _add_anthropic_usage(usage: Usage, resp) -> None:
    usage.rounds += 1
    u = getattr(resp, "usage", None)
    if u is None:
        return
    read = getattr(u, "cache_read_input_tokens", 0) or 0
    write = getattr(u, "cache_creation_input_tokens", 0) or 0
    usage.input_tokens += (u.input_tokens or 0) + read + write
    usage.cached_tokens += read
    usage.cache_write_tokens += write
    usage.output_tokens += u.output_tokens or 0

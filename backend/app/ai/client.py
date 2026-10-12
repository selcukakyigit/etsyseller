"""AI sağlayıcı istemcileri. Kitaplıklar (openai, anthropic, google-genai) yalnızca ilk kullanımda yüklenir: üçü birlikte
açılışta ~100 MB bellek tutuyor ve Render'ın 512 MB sınırında bu yük her özellik kullanılmasa bile ödeniyordu.

Anahtar katalogdan gelir (panelden girilen, yoksa .env; bkz. ai/catalog.py). `api_key` verilirse o kullanılır
(ör. panelde kaydetmeden önce anahtarı denemek için)."""
from typing import TYPE_CHECKING

from app.ai import catalog

if TYPE_CHECKING:
    import anthropic
    import openai
    from google import genai


def get_openai_client(api_key: str | None = None) -> "openai.OpenAI":
    import openai

    return openai.OpenAI(api_key=api_key or catalog.api_key("openai"))


def get_anthropic_client(api_key: str | None = None) -> "anthropic.Anthropic":
    import anthropic

    return anthropic.Anthropic(api_key=api_key or catalog.api_key("anthropic"))


def get_google_client(api_key: str | None = None) -> "genai.Client":
    from google import genai

    return genai.Client(api_key=api_key or catalog.api_key("google"))


def openai_limits(model_id: str, max_tokens: int | None = None) -> dict:
    """OpenAI çağrısının çıktı sınırı ve akıl yürütme ayarı, modelin ailesine göre. gpt-5 ve o-serisi modeller `max_tokens`'ı reddeder,
    `max_completion_tokens` ister; bu sınıra gizli akıl yürütme token'ları da sayıldığından akıl yürütme en aza indirilir ve sınıra pay eklenir.
    Diğer modeller (gpt-4o, gpt-4o-mini…) `max_tokens` kullanır. Çağrıya `**openai_limits(model, n)` olarak eklenir."""
    if model_id.startswith("gpt-5"):
        effort = {"reasoning_effort": "minimal"}
    elif model_id.startswith(("o1", "o3", "o4")):
        effort = {"reasoning_effort": "low"}
    else:
        return {} if max_tokens is None else {"max_tokens": max_tokens}
    return effort if max_tokens is None else {**effort, "max_completion_tokens": max_tokens + 1000}


REPLICATE_API = "https://api.replicate.com/v1"


def replicate_headers(api_key: str | None = None) -> dict[str, str]:
    """Replicate'in resmi SDK'sı yerine doğrudan HTTP (httpx zaten bağımlılık): tahmin oluşturup sonucu beklemek birkaç
    satırlık iş, ayrı bir kitaplık belleğe değmez."""
    return {"Authorization": f"Bearer {api_key or catalog.api_key('replicate')}"}


def replicate_account(api_key: str | None = None) -> dict:
    """Anahtarın sahibi olan hesap; anahtar geçersizse httpx.HTTPStatusError."""
    import httpx

    r = httpx.get(f"{REPLICATE_API}/account", headers=replicate_headers(api_key), timeout=15)
    r.raise_for_status()
    return r.json()

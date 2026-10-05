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

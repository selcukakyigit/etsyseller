"""AI sağlayıcı istemcileri. Kitaplıklar (openai, anthropic, google-genai) yalnızca ilk kullanımda yüklenir: üçü birlikte
açılışta ~100 MB bellek tutuyor ve Render'ın 512 MB sınırında bu yük her özellik kullanılmasa bile ödeniyordu."""
from typing import TYPE_CHECKING

from app.core.config import settings

if TYPE_CHECKING:
    import anthropic
    import openai
    from google import genai


def get_openai_client() -> "openai.OpenAI":
    import openai

    return openai.OpenAI(api_key=settings.openai_api_key)


def get_anthropic_client() -> "anthropic.Anthropic":
    import anthropic

    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def get_google_client() -> "genai.Client":
    from google import genai

    return genai.Client(api_key=settings.google_api_key)

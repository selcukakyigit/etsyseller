import openai

from app.core.config import settings


def get_client() -> openai.OpenAI:
    return openai.OpenAI(api_key=settings.openai_api_key)

import anthropic
import openai
from google import genai

from app.core.config import settings


def get_openai_client() -> openai.OpenAI:
    return openai.OpenAI(api_key=settings.openai_api_key)


def get_anthropic_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def get_google_client() -> genai.Client:
    return genai.Client(api_key=settings.google_api_key)

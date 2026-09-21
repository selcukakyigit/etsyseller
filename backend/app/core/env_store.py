import re
from pathlib import Path

from app.core.config import settings

ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"

# Maps a Settings attribute name to its .env variable name — only these may
# be changed through the settings page, everything else in .env (DB url,
# cookie flags, etc.) is deployment config, not a per-app credential.
MANAGED_KEYS = {
    "etsy_api_key": "ETSY_API_KEY",
    "etsy_shared_secret": "ETSY_SHARED_SECRET",
    "openai_api_key": "OPENAI_API_KEY",
    "openai_model": "OPENAI_MODEL",
    "anthropic_api_key": "ANTHROPIC_API_KEY",
    "anthropic_model": "ANTHROPIC_MODEL",
    "ai_provider": "AI_PROVIDER",
}

SECRET_KEYS = {"etsy_api_key", "etsy_shared_secret", "openai_api_key", "anthropic_api_key"}

# Fixed display width regardless of the real secret's length (some keys, e.g.
# OpenAI's, run past 150 chars — mirroring the true length broke the settings
# page layout), so the mask is always a short, constant-width placeholder.
MASK_DOTS = 16


def mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 4:
        return "•" * len(value)
    return "•" * MASK_DOTS + value[-4:]


def set_env_values(values: dict[str, str]) -> None:
    """Persist attribute->value pairs to .env (updating existing lines or
    appending new ones) and update the in-memory settings singleton so the
    change takes effect immediately, without restarting the server."""
    env_names = {MANAGED_KEYS[key]: value for key, value in values.items() if key in MANAGED_KEYS}
    if not env_names:
        return

    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    updated = set()
    for i, line in enumerate(lines):
        match = re.match(r"^([A-Z0-9_]+)=", line)
        if match and match.group(1) in env_names:
            lines[i] = f"{match.group(1)}={env_names[match.group(1)]}"
            updated.add(match.group(1))

    for name, value in env_names.items():
        if name not in updated:
            lines.append(f"{name}={value}")

    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    for key, value in values.items():
        if key in MANAGED_KEYS:
            setattr(settings, key, value)

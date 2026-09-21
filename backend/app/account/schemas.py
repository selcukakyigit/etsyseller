from pydantic import BaseModel


class ProfileUpdateIn(BaseModel):
    name: str | None = None


class ApiKeysOut(BaseModel):
    etsy_api_key: str
    etsy_shared_secret: str
    openai_api_key: str
    openai_model: str
    anthropic_api_key: str
    anthropic_model: str
    ai_provider: str


class ApiKeysUpdateIn(BaseModel):
    """All fields optional and blank-means-unchanged — only non-empty values
    overwrite the stored key, so the masked value returned by GET can be
    round-tripped through the form without wiping the real secret."""

    etsy_api_key: str | None = None
    etsy_shared_secret: str | None = None
    openai_api_key: str | None = None
    openai_model: str | None = None
    anthropic_api_key: str | None = None
    anthropic_model: str | None = None
    ai_provider: str | None = None


class ApiKeyTestOut(BaseModel):
    ok: bool
    message: str


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str

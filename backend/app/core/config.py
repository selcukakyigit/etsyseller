from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    etsy_api_key: str = ""
    etsy_shared_secret: str = ""
    etsy_redirect_uri: str = "http://localhost:8000/api/shops/connect/callback"

    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    frontend_url: str = "http://localhost:3000"
    database_url: str = "sqlite:///./data.db"

    session_cookie_name: str = "session_token"
    session_max_age_days: int = 90
    # Set to True once the app is served over HTTPS; browsers drop Secure
    # cookies over plain http, which local dev still uses.
    session_cookie_secure: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()

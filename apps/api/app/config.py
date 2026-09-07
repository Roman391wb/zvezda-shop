from urllib.parse import urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://atelier:atelier@localhost:5432/atelier"
    app_env: str = "development"
    public_origin: str = ""
    trusted_proxy_cidrs: str = ""
    seed_demo_data: bool = False
    admin_password_hash: str | None = None
    admin_bootstrap_login: str | None = None
    admin_session_secret: str | None = None
    admin_cookie_secure: bool = False
    media_root: str = "/app/media"
    max_upload_bytes: int = 10 * 1024 * 1024
    max_video_upload_bytes: int = 60 * 1024 * 1024
    store_name: str = ""
    store_whatsapp_number: str = ""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def production_requirements(self):
        if self.app_env != "production":
            return self
        if not self.admin_session_secret or len(self.admin_session_secret) < 32:
            raise ValueError("ADMIN_SESSION_SECRET must be set to a strong value in production")
        if not self.admin_cookie_secure:
            raise ValueError("ADMIN_COOKIE_SECURE=true is required in production")
        parsed = urlparse(self.public_origin)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("PUBLIC_ORIGIN must be an HTTPS origin in production")
        if "@postgres:" not in self.database_url or "postgresql+asyncpg" not in self.database_url:
            raise ValueError("DATABASE_URL must use the internal PostgreSQL service in production")
        if self.seed_demo_data:
            raise ValueError("SEED_DEMO_DATA must be false in production")
        return self


settings = Settings()

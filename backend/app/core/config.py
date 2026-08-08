"""Application configuration."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables.

    Attributes:
        app_name: Human-readable name of the service.
        environment: Deployment environment name (e.g. "development", "production").
        database_url: Connection string for the Prisma-managed database.
        cors_origins: Comma-separated frontend origins allowed to call this
            API with credentials (cookies), e.g.
            "https://app.example.com,https://staging.example.com". Kept as a
            plain string field (not list[str]) because pydantic-settings
            tries to JSON-parse env values for list-typed fields before any
            validator runs, which crashes on a plain comma-separated string
            — see cors_origins_list for the parsed form.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Sales Guru API"
    environment: str = "development"
    database_url: str = "file:./dev.db"
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse cors_origins into a list of origins.

        Returns:
            The configured origins, split on commas with whitespace trimmed.
        """
        origins = self.cors_origins.split(",")
        return [origin.strip() for origin in origins if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance.

    Returns:
        The process-wide Settings singleton.
    """
    return Settings()

"""Application configuration."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables.

    Attributes:
        app_name: Human-readable name of the service.
        environment: Deployment environment name (e.g. "development", "production").
        database_url: Connection string for the Prisma-managed database.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Sales Guru API"
    environment: str = "development"
    database_url: str = "file:./dev.db"


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance.

    Returns:
        The process-wide Settings singleton.
    """
    return Settings()

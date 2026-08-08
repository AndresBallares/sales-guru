"""Tests for application configuration.

CORS_ORIGINS must be set via a real environment variable (monkeypatch.setenv),
not passed to the Settings constructor directly — a constructor kwarg
bypasses pydantic-settings' EnvSettingsSource entirely, which is exactly the
code path that broke in practice (see cors_origins' docstring in config.py).

monkeypatch.delenv is required even for the "default" case: importing
app.core.db (transitively, via app.main) instantiates Prisma(), which loads
.env into the real process environment as a side effect (use_dotenv=True by
default) — independent of, and earlier than, pydantic-settings' own
_env_file handling. Without delenv, a CORS_ORIGINS value in the developer's
local .env leaks into every test in the process, not just this file.
"""

import pytest
from app.core.config import Settings


def test_cors_origins_defaults_to_local_dev_frontend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no override, CORS_ORIGINS defaults to the local Vite dev server."""
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    settings = Settings(_env_file=None)

    assert settings.cors_origins_list == ["http://localhost:5173"]


def test_cors_origins_splits_a_comma_separated_env_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A real CORS_ORIGINS env var, comma-separated, is parsed into a list."""
    monkeypatch.setenv(
        "CORS_ORIGINS", "https://app.example.com, https://staging.example.com"
    )

    settings = Settings(_env_file=None)

    assert settings.cors_origins_list == [
        "https://app.example.com",
        "https://staging.example.com",
    ]


def test_cors_origins_single_env_value(monkeypatch: pytest.MonkeyPatch) -> None:
    """A single-origin CORS_ORIGINS env var (no commas) still works."""
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")

    settings = Settings(_env_file=None)

    assert settings.cors_origins_list == ["https://app.example.com"]

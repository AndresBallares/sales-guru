"""Application configuration."""

from functools import lru_cache

from pydantic import Field, model_validator
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
        anthropic_api_key: Key for the Marketing Strategist Agent's LLM
            calls (PRD.md §6). None until set — endpoints that need it
            raise a clear error rather than the app failing to start.
        frontend_url: Base URL of the SPA. Only used to build the browser
            redirect target at the end of the Meta OAuth callback (the
            callback is hit directly by Meta, not via the frontend's own
            API client, so it can't rely on CORS_ORIGINS for this).
        backend_url: Base URL of this API itself. Only used to build the
            absolute, publicly-fetchable URL for a stored ProductImage
            (app/api/product_image.py) — Meta's own servers fetch that
            URL directly for ad creative images, not through the
            browser, so a relative path won't do. In dev this is
            "http://localhost:8000", which Meta genuinely cannot
            reach — a known limitation, not a bug (image-backed ad
            creatives only really work once deployed).
        meta_app_id: Meta App ID for the OAuth connection (PRD.md build
            step 6). None until set — the connect endpoint raises a clear
            error rather than the app failing to start.
        meta_app_secret: Meta App Secret, paired with meta_app_id.
        meta_redirect_uri: Callback URL registered in the Meta App's OAuth
            settings, e.g. "http://localhost:8000/meta/callback" in dev.
        meta_token_encryption_key: Fernet key (app/core/crypto.py)
            encrypting MetaConnection.accessToken at rest — a real Meta
            access token has to be usable again for live Marketing API
            calls, so it's encrypted (reversible), not hashed like
            User.hashedPassword/Session.tokenHash. None until set —
            encrypting/decrypting a token raises a clear error rather
            than the app failing to start. Generate one with
            `python -c "from cryptography.fernet import Fernet;
            print(Fernet.generate_key().decode())"`.
        enable_scheduler: Whether the in-process APScheduler jobs
            (metrics collection + optimization evaluation, PRD.md build
            step 10) start with the app. Defaults on; the test suite
            turns it off (conftest.py) so background jobs never fire
            mid-test-run against a database tests are actively resetting.
        resend_api_key: API key for Resend (app/services/email.py), sending
            the forgot-password reset link. None until set — requesting a
            reset raises a clear error rather than the app failing to start.
        email_from: The "From" address on outgoing email, e.g.
            "onboarding@resend.dev" (Resend's own sandbox sender, usable
            with no domain verification — fine for MVP; a verified custom
            domain address once one exists).
        url_reachability_check_enabled: Whether POST .../products/{id}/
            check-url (app/services/url_reachability.py) is exposed at
            all. Off by default — this is a scaffold, not yet wired into
            publish (see that module's docstring).
        fake_meta_enabled: Test-only escape hatch (env var `FAKE_META`,
            confirmed 2026-09-09) that swaps every real Meta Graph API
            call (app/services/meta.py) for a canned fake response, and
            exposes POST .../meta/fake-connect (app/api/meta.py) to
            create a MetaConnection without real OAuth. Exists so e2e
            tests can drive a business past the Meta-connection step —
            which needs a real user's real Meta login, so it can't be
            driven any other way — through to a published campaign and
            its (canned, empty) results, without ever touching Meta's
            real API. Off by default; _forbid_in_production below makes
            it impossible to accidentally leave on in a real deployment.
        fake_llm_enabled: Test-only escape hatch (env var `FAKE_LLM`,
            confirmed 2026-09-09), same shape as fake_meta_enabled but for
            the Anthropic calls instead of Meta's: swaps the Marketing
            Strategist Agent (app/services/strategist.py) and Creative
            Agent (app/services/creative.py) for canned, deterministic,
            schema-valid output at the one shared call each makes, so an
            e2e run needs no real ANTHROPIC_API_KEY and never depends on
            live model output. Off by default; also covered by
            _forbid_in_production below.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Sales Guru API"
    environment: str = "development"
    database_url: str = "file:./dev.db"
    cors_origins: str = "http://localhost:5173"
    anthropic_api_key: str | None = None
    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"
    meta_app_id: str | None = None
    meta_app_secret: str | None = None
    meta_redirect_uri: str | None = None
    meta_token_encryption_key: str | None = None
    enable_scheduler: bool = True
    resend_api_key: str | None = None
    email_from: str = "onboarding@resend.dev"
    url_reachability_check_enabled: bool = False
    fake_meta_enabled: bool = Field(default=False, validation_alias="FAKE_META")
    fake_llm_enabled: bool = Field(default=False, validation_alias="FAKE_LLM")

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse cors_origins into a list of origins.

        Returns:
            The configured origins, split on commas with whitespace trimmed.
        """
        origins = self.cors_origins.split(",")
        return [origin.strip() for origin in origins if origin.strip()]

    @model_validator(mode="after")
    def _forbid_in_production(self) -> "Settings":
        """Refuse to construct Settings with a fake-dependency flag in production.

        The whole point of fake_meta_enabled/fake_llm_enabled is to let a
        test process skip a real external API entirely — enabling either
        in production would mean live campaigns silently never reach
        Meta, or never get a real AI-generated strategy/ad copy. Failing
        at Settings construction (get_settings() is called at app.main's
        module level, before the app object even exists) means a
        misconfigured deploy never boots, rather than boots and quietly
        fakes real customer campaigns.

        Returns:
            self, unchanged, when the combination is safe.

        Raises:
            ValueError: If fake_meta_enabled or fake_llm_enabled is True
                and environment is "production".
        """
        if self.fake_meta_enabled and self.environment == "production":
            raise ValueError(
                "FAKE_META must never be enabled when ENVIRONMENT=production"
            )
        if self.fake_llm_enabled and self.environment == "production":
            raise ValueError(
                "FAKE_LLM must never be enabled when ENVIRONMENT=production"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance.

    Returns:
        The process-wide Settings singleton.
    """
    return Settings()

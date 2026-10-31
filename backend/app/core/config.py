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
        strategist_model: Model for the Marketing Strategist Agent's plans
            (env `STRATEGIST_MODEL`).
        creative_model: Model for the Creative Agent, batches and single-slot
            regenerates (env `CREATIVE_MODEL`).
        optimizer_eval_model: Model for the Optimizer's routine evaluation,
            the recommendation call that runs about daily per live campaign
            (env `OPTIMIZER_EVAL_MODEL`). Haiku 5.5: on a 10-input comparison
            with Sonnet 5 it agreed on the action 9 of 10 times and on the
            auto-apply outcome 10 of 10, was more cautious on risk, and cost
            about a twentieth as much (PRD.md step 10).
        optimizer_test_eval_model: Model for the Optimizer's TEST_PLAN
            evaluation, a longer judgment that stays on Sonnet 5
            (env `OPTIMIZER_TEST_EVAL_MODEL`).
        avatar_import_enabled: Whether POST /businesses/{id}/avatars/import
            may call the model (env `AVATAR_IMPORT_ENABLED`). Off by default
            since each call costs tokens; FAKE_LLM turns the endpoint on with
            canned drafts.
        avatar_import_model: Model that reads a pasted research document
            into avatar drafts (env `AVATAR_IMPORT_MODEL`).
        log_level: Level for the app's own loggers (env `LOG_LEVEL`, a name such
            as INFO or DEBUG). Libraries stay at WARNING regardless; see
            app/core/log_config.py.
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
        dashboard_sample_enabled: Local-development switch (env var
            `DASHBOARD_SAMPLE_DATA`, 2026-10-10) that lets the campaign
            dashboard endpoints serve in-memory sample numbers on request
            (`?sample=true`, app/services/dashboard_sample.py) so the page
            can be seen populated before any real campaign has results.
            Separate from fake_meta_enabled on purpose: that one fakes every
            real Meta call, which a dev server using a real Meta connection
            can't have on. Off by default; _forbid_in_production below makes
            it impossible to boot a deployment with it on.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Sales Guru API"
    environment: str = "development"
    database_url: str = "file:./dev.db"
    cors_origins: str = "http://localhost:5173"
    anthropic_api_key: str | None = None
    log_level: str = "INFO"
    strategist_model: str = "claude-sonnet-5"
    creative_model: str = "claude-sonnet-5"
    optimizer_eval_model: str = "claude-haiku-5-5"
    optimizer_test_eval_model: str = "claude-sonnet-5"
    # Avatar import (POST /businesses/{id}/avatars/import): off until someone
    # sets AVATAR_IMPORT_ENABLED, because each call spends real tokens. Always
    # on under FAKE_LLM, which costs nothing.
    avatar_import_enabled: bool = False
    avatar_import_model: str = "claude-sonnet-5"
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
    dashboard_sample_enabled: bool = Field(
        default=False, validation_alias="DASHBOARD_SAMPLE_DATA"
    )
    # A SALES product priced at or above this optimizes for AddToCart
    # instead of Purchase (CREATIVE_TEST_PLAN, decided once at creation —
    # a high-ticket product rarely produces enough purchases to learn from).
    high_ticket_price_threshold: float = 500.0
    # Assumed share of add-to-carts that become purchases, used to turn the
    # target CAC into a target cost per add-to-cart for the cost cap. An
    # assumption, not measured data: tune it as real funnel data arrives.
    add_to_cart_to_purchase_rate: float = 0.10
    # Audience saturation (app/services/saturation.py). The rule fires when,
    # on two evaluations in a row (one per day): new reach per dollar over the
    # last 7 days is at most `saturation_reach_per_dollar_ratio` of the first
    # 14 days' rate, AND frequency over the last 7 days is at least
    # `saturation_min_frequency`, AND fewer than `saturation_max_first_time_ratio`
    # of the last 7 days' impressions went to people reached for the first
    # time, with spend holding up (at least `saturation_min_spend_7d`, and at
    # least `saturation_spend_floor_ratio` of the week before). Public guidance
    # on frequency is vendor blogs, not Meta, and disagrees (about 2.5-4 for a
    # cold audience), so every number here is a starting point to tune.
    saturation_min_days: int = 14
    saturation_min_spend_7d: float = 150.0
    saturation_min_impressions_7d: int = 10_000
    saturation_spend_floor_ratio: float = 0.9
    saturation_reach_per_dollar_ratio: float = 0.5
    saturation_min_frequency: float = 3.5
    saturation_max_first_time_ratio: float = 0.25
    saturation_consecutive_evaluations: int = 2
    saturation_cooldown_days: int = 14
    # What counts as "this business has run ads before" (Meta ad-account
    # history): lifetime spend AND clicks across the account at or above both.
    # Any spend used to count, which pushed an account off its first creative
    # test on a few dollars; a handful of clicks teaches nothing either.
    meaningful_history_min_spend: float = 500.0
    meaningful_history_min_clicks: int = 300

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
            ValueError: If fake_meta_enabled, fake_llm_enabled or
                dashboard_sample_enabled is True
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
        if self.dashboard_sample_enabled and self.environment == "production":
            raise ValueError(
                "DASHBOARD_SAMPLE_DATA must never be enabled when "
                "ENVIRONMENT=production"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance.

    Returns:
        The process-wide Settings singleton.
    """
    return Settings()

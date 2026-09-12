"""Idempotent dev-database seed script.

Run with `uv run python -m app.seed` (or `make seed`). Populates the local
dev database (whatever DATABASE_URL currently resolves to — see the
printed line at startup, and _DB_RESET.md/README.md's guardrail around
never running this or a reset against anything but a "test.db"-style
target) with one dev login, a demo "VENZI JEWELRY" business complete with
a brand profile, one product with photos, an audience, and one Sales
campaign carried all the way to generated creatives (via FAKE_LLM, so no
real ANTHROPIC_API_KEY is needed) — something to look at immediately
after a fresh `prisma db push`, without manually clicking through the
whole onboarding flow first.

Safe to run twice: every resource is checked for by name/email first and
only created if missing, rather than upserted/overwritten. Drives the
real FastAPI endpoints via TestClient rather than writing rows directly,
so every business rule/validation/default the app itself enforces is
exercised for real, the same way an actual signup would create this data.

Refuses to run at all against ENVIRONMENT=production (enforced by
Settings itself, app/core/config.py's _forbid_in_production, since this
sets FAKE_LLM) — there is no separate guard here beyond that, deliberately,
so there is exactly one place this rule lives.
"""

import os
import struct

# Must happen before app.core.config (and therefore app.main) is ever
# imported — Settings.get_settings() is @lru_cache'd and first evaluated
# at app.main's module level, so env vars set after that import has no
# effect (same ordering constraint tests/conftest.py already relies on
# for DATABASE_URL/ENABLE_SCHEDULER). Both env var lines must stay above
# every other import in this file for that reason.
os.environ.setdefault("FAKE_LLM", "1")
os.environ.setdefault("ENABLE_SCHEDULER", "false")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

_DEV_EMAIL = "dev@example.com"
_DEV_PASSWORD = "devpassword123"
_BUSINESS_NAME = "VENZI JEWELRY"
_PHOTO_COUNT = 4


def _placeholder_jpeg(width: int = 800, height: int = 800) -> bytes:
    """A minimal but structurally valid JPEG header.

    Same construction as tests/test_publish.py's _valid_jpeg — good
    enough to pass upload validation (app/schemas/product_image.py)
    without a real photo file on disk.
    """
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + struct.pack(">H", 11)
        + bytes([8])
        + struct.pack(">HH", height, width)
        + bytes([1])
        + bytes([1, 0x11, 0])
        + b"\xff\xd9"
    )


def _ensure_signed_in(client: TestClient) -> None:
    """Sign the dev user up, or log in if they already exist (idempotent)."""
    signup = client.post(
        "/auth/signup", json={"email": _DEV_EMAIL, "password": _DEV_PASSWORD}
    )
    if signup.status_code == 201:
        print(f"Created dev user {_DEV_EMAIL!r}")
        return
    login = client.post(
        "/auth/login", json={"email": _DEV_EMAIL, "password": _DEV_PASSWORD}
    )
    if login.status_code != 200:
        raise RuntimeError(
            f"Dev user {_DEV_EMAIL!r} exists but the known seed password no "
            "longer logs in — was its password changed? "
            f"({login.status_code}: {login.text})"
        )
    print(f"Dev user {_DEV_EMAIL!r} already exists, logged in")


def _ensure_business(client: TestClient) -> str:
    """Find or create the demo business, return its id."""
    existing = next(
        (b for b in client.get("/businesses").json() if b["name"] == _BUSINESS_NAME),
        None,
    )
    if existing is not None:
        print(f"Business {_BUSINESS_NAME!r} already exists ({existing['id']})")
        return str(existing["id"])

    response = client.post(
        "/businesses",
        json={
            "name": _BUSINESS_NAME,
            "industry": "FASHION_JEWELRY",
            "website": "https://venzijewelry.example",
            "description": (
                "VENZI is a family-owned New York fine jewelry house creating "
                "contemporary, sculptural jewelry for people who value "
                "individuality, artistry, and craftsmanship."
            ),
        },
    )
    response.raise_for_status()
    business_id = str(response.json()["id"])
    print(f"Created business {_BUSINESS_NAME!r} ({business_id})")
    return business_id


def _ensure_brand_profile(client: TestClient, business_id: str) -> None:
    """Create the business's brand profile if it doesn't have one yet."""
    existing = client.get(f"/businesses/{business_id}/brand-profile")
    if existing.status_code == 200:
        print("Brand profile already exists")
        return

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json={
            "description": (
                "Contemporary, sculptural fine jewelry in 18K gold with "
                "natural gemstones and diamonds — bold color, modern form, "
                "and decades of craftsmanship."
            ),
            "idealCustomer": (
                "Style-conscious professionals in their 30s-50s who see "
                "jewelry as wearable art, not just an accessory, and are "
                "willing to pay for genuine craftsmanship."
            ),
            "voiceTraits": ["LUXURIOUS", "ARTISANAL", "BOLD", "WARM"],
            "pricePositioning": "LUXURY",
            "tagline": "Wear the story.",
            "proofPoints": [
                "Family-owned New York atelier since 1998",
                "Every piece hand-finished in-house, never outsourced",
                "Ethically sourced natural gemstones and diamonds",
                "Free lifetime cleaning and inspection",
            ],
            "offer": "15% off a custom consultation booked this month",
        },
    )
    response.raise_for_status()
    print("Created brand profile")


def _ensure_product(client: TestClient, business_id: str) -> str:
    """Find or create the demo product (with placeholder photos), return its id."""
    existing_products = client.get(f"/businesses/{business_id}/products").json()
    if existing_products:
        product_id = str(existing_products[0]["id"])
        print(f"Product already exists ({product_id})")
        return product_id

    response = client.post(
        f"/businesses/{business_id}/products",
        json={
            "description": (
                "VENZI sells contemporary handcrafted fine jewelry—including "
                "rings, bracelets, necklaces, earrings, pendants, and bespoke "
                "pieces—crafted in 18K gold with natural gemstones, diamonds, "
                "and innovative ceramic."
            ),
            "url": "https://venzijewelry.example/collections/signature",
            "price": 1200.0,
            "margin": 0.55,
        },
    )
    response.raise_for_status()
    product_id = str(response.json()["id"])
    for position in range(_PHOTO_COUNT):
        upload = client.post(
            f"/businesses/{business_id}/products/{product_id}/images",
            files={
                "file": (
                    f"placeholder-{position}.jpg",
                    _placeholder_jpeg(),
                    "image/jpeg",
                )
            },
        )
        upload.raise_for_status()
    print(f"Created product {product_id} with {_PHOTO_COUNT} placeholder photos")
    return product_id


def _ensure_audience(client: TestClient, business_id: str) -> str:
    """Find or create the demo audience, return its id."""
    existing = client.get(f"/businesses/{business_id}/audiences").json()
    if existing:
        audience_id = str(existing[0]["id"])
        print(f"Audience already exists ({audience_id})")
        return audience_id

    response = client.post(
        f"/businesses/{business_id}/audiences",
        json={
            "description": "Style-conscious professionals, 30-55",
            "ageMin": 30,
            "ageMax": 55,
            "location": "New York metro",
            "interests": "fine jewelry, luxury fashion, art",
        },
    )
    response.raise_for_status()
    audience_id = str(response.json()["id"])
    print(f"Created audience {audience_id}")
    return audience_id


def _ensure_campaign(
    client: TestClient, business_id: str, product_id: str, audience_id: str
) -> None:
    """Find or create the demo campaign, carried through to generated creatives."""
    existing = client.get(f"/businesses/{business_id}/campaigns").json()
    if existing:
        print(f"Campaign already exists ({existing[0]['id']}), skipping generation")
        return

    campaign_id = str(
        client.post(
            f"/businesses/{business_id}/campaigns",
            json={
                "objective": "SALES",
                "productId": product_id,
                "audienceId": audience_id,
                "name": "Signature Collection Launch",
            },
        ).json()["id"]
    )
    strategy = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )
    strategy.raise_for_status()
    creatives = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )
    creatives.raise_for_status()
    print(
        f"Created campaign {campaign_id} with a generated strategy and "
        f"{len(creatives.json())} creative variants"
    )


def main() -> None:
    """Seed the database this process's DATABASE_URL resolves to."""
    settings = get_settings()
    print(
        f"Seeding against DATABASE_URL={settings.database_url!r} "
        f"(environment={settings.environment!r}, "
        f"fake_llm_enabled={settings.fake_llm_enabled})"
    )
    # Belt-and-suspenders beyond Settings._forbid_in_production (which
    # already refuses to construct Settings at all with FAKE_LLM=1 and
    # ENVIRONMENT=production) — fail before touching anything if that
    # somehow changes, rather than trust it silently.
    if settings.environment == "production":
        raise SystemExit("Refusing to seed: ENVIRONMENT=production")

    with TestClient(app) as client:
        _ensure_signed_in(client)
        business_id = _ensure_business(client)
        _ensure_brand_profile(client, business_id)
        product_id = _ensure_product(client, business_id)
        audience_id = _ensure_audience(client, business_id)
        _ensure_campaign(client, business_id, product_id, audience_id)

    print("Seed complete.")


if __name__ == "__main__":
    main()

"""Tests for GET /options — every fixed option list, fetched in one call."""

from fastapi.testclient import TestClient


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret123", "termsAccepted": True},
    )
    return client


def test_get_options_requires_a_session(client: TestClient) -> None:
    """Fetching the options with no session cookie returns 401."""
    response = client.get("/options")

    assert response.status_code == 401


def test_get_options_returns_every_list(client: TestClient) -> None:
    """All eight fixed lists come back in one response."""
    _signed_up_client(client)

    response = client.get("/options")

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {
        "industries",
        "objectives",
        "campaignStatuses",
        "ctas",
        "actionTypes",
        "eventVenues",
        "voiceTraits",
        "pricePositionings",
    }


def test_get_options_voice_traits_match_the_fixed_list(client: TestClient) -> None:
    """voiceTraits comes back in full, each with a display label."""
    _signed_up_client(client)

    response = client.get("/options")

    body = response.json()
    assert [option["value"] for option in body["voiceTraits"]] == [
        "LUXURIOUS",
        "PLAYFUL",
        "MINIMAL",
        "WARM",
        "BOLD",
        "ARTISANAL",
        "EDGY",
        "PROFESSIONAL",
    ]
    assert {"value": "LUXURIOUS", "label": "Luxurious"} in body["voiceTraits"]


def test_get_options_price_positionings_match_the_fixed_list(
    client: TestClient,
) -> None:
    """pricePositionings comes back in full, each with a display label."""
    _signed_up_client(client)

    response = client.get("/options")

    body = response.json()
    assert [option["value"] for option in body["pricePositionings"]] == [
        "AFFORDABLE",
        "MID",
        "PREMIUM",
        "LUXURY",
    ]
    assert {"value": "PREMIUM", "label": "Premium"} in body["pricePositionings"]


def test_get_options_industries_match_the_fixed_list(client: TestClient) -> None:
    """industries comes back in full, each with a display label — same
    fixed list and order as the former GET /businesses/industries."""
    _signed_up_client(client)

    response = client.get("/options")

    body = response.json()
    assert [option["value"] for option in body["industries"]] == [
        "ECOMMERCE",
        "FASHION_JEWELRY",
        "BEAUTY_COSMETICS",
        "REAL_ESTATE",
        "AUTOMOTIVE",
        "TRAVEL",
        "RESTAURANTS_FOOD",
        "SAAS_TECHNOLOGY",
        "PROFESSIONAL_SERVICES",
        "FITNESS_WELLNESS",
        "OTHER",
    ]
    assert {"value": "FASHION_JEWELRY", "label": "Fashion / Jewelry"} in body[
        "industries"
    ]
    assert {"value": "ECOMMERCE", "label": "E-commerce"} in body["industries"]


def test_get_options_objectives(client: TestClient) -> None:
    """objectives matches Objective (app/schemas/campaign.py) with the same
    labels the frontend used to hard-code."""
    _signed_up_client(client)

    response = client.get("/options")

    body = response.json()
    assert body["objectives"] == [
        {"value": "SALES", "label": "Sales"},
        {"value": "LEADS", "label": "Leads"},
        {"value": "TRAFFIC", "label": "Traffic"},
        {"value": "MESSAGES", "label": "Messages"},
        {"value": "AWARENESS", "label": "Awareness"},
    ]


def test_get_options_campaign_statuses(client: TestClient) -> None:
    """campaignStatuses covers every Campaign.status value with the same
    labels the frontend used to hard-code."""
    _signed_up_client(client)

    response = client.get("/options")

    body = response.json()
    assert body["campaignStatuses"] == [
        {"value": "DRAFT", "label": "Draft"},
        {"value": "READY", "label": "Ready"},
        {"value": "STRATEGY_GENERATED", "label": "Strategy generated"},
        {"value": "ADS_GENERATED", "label": "Ads generated"},
        {"value": "PENDING_APPROVAL", "label": "Pending approval"},
        {"value": "APPROVED", "label": "Approved"},
        {"value": "LIVE", "label": "Live"},
        {"value": "PAUSED", "label": "Paused"},
        {"value": "FAILED", "label": "Failed"},
    ]


def test_get_options_ctas(client: TestClient) -> None:
    """ctas matches CtaType (app/schemas/creative.py) with the same labels
    the frontend used to hard-code."""
    _signed_up_client(client)

    response = client.get("/options")

    body = response.json()
    assert body["ctas"] == [
        {"value": "SHOP_NOW", "label": "Shop Now"},
        {"value": "LEARN_MORE", "label": "Learn More"},
        {"value": "SIGN_UP", "label": "Sign Up"},
        {"value": "SUBSCRIBE", "label": "Subscribe"},
        {"value": "CONTACT_US", "label": "Contact Us"},
        {"value": "MESSAGE_PAGE", "label": "Send Message"},
        {"value": "GET_OFFER", "label": "Get Offer"},
        {"value": "DOWNLOAD", "label": "Download"},
        {"value": "BOOK_NOW", "label": "Book Now"},
    ]


def test_get_options_action_types(client: TestClient) -> None:
    """actionTypes matches ActionType (app/schemas/optimization.py) with
    the same labels the frontend used to hard-code."""
    _signed_up_client(client)

    response = client.get("/options")

    body = response.json()
    assert body["actionTypes"] == [
        {"value": "PAUSE_AD", "label": "Pause ad"},
        {"value": "INCREASE_BUDGET", "label": "Increase budget"},
        {"value": "DECREASE_BUDGET", "label": "Decrease budget"},
    ]


def test_get_options_event_venues(client: TestClient) -> None:
    """eventVenues matches the curated table (app/services/event_venues.py)
    with the same composed labels the frontend used to hard-code."""
    _signed_up_client(client)

    response = client.get("/options")

    body = response.json()
    assert body["eventVenues"] == [
        {
            "value": "jck_las_vegas",
            "label": "JCK Las Vegas — Las Vegas Convention Center, NV",
        },
        {
            "value": "couture_las_vegas",
            "label": "Couture — Wynn Las Vegas, NV",
        },
        {
            "value": "agta_gemfair_tucson",
            "label": "AGTA GemFair Tucson — Tucson Convention Center, AZ",
        },
        {
            "value": "ja_new_york",
            "label": "JA New York — Javits Center, NY",
        },
    ]

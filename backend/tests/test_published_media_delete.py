"""A photo or video that a published ad uses can't be deleted.

An ad on Meta keeps its local record (a creative, or a carousel card) pointing at the
media it shows, so deleting the media would leave the app unable to show what is
running. The refusal names the campaigns that use it.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from prisma import Prisma
from prisma.types import CreativeCreateInput

from tests.test_placement_assets import upload_photo, upload_video
from tests.test_product_image import _create_business, _signed_up_client

PHOTO_MESSAGE = "This photo is used by a published ad and can't be deleted."
VIDEO_MESSAGE = "This video is used by a published ad and can't be deleted."


def _setup(client: TestClient) -> tuple[str, str]:
    """A signed-in business with a product; returns (business_id, product_id)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Custom rings", "url": "https://acme.example/ring"},
    ).json()["id"]
    return business_id, product_id


def _delete(
    client: TestClient, business_id: str, product_id: str, image_id: str
) -> Any:
    return client.delete(
        f"/businesses/{business_id}/products/{product_id}/images/{image_id}"
    )


def _listed(client: TestClient, business_id: str, product_id: str) -> list[str]:
    response = client.get(f"/businesses/{business_id}/products/{product_id}/images")
    return [i["id"] for i in response.json()]


async def _campaign(
    client: TestClient,
    business_id: str,
    name: str | None,
    *,
    status: str = "LIVE",
    published: bool = True,
) -> str:
    created = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", **({"name": name} if name else {})},
    )
    assert created.status_code == 201, created.text
    campaign_id: str = created.json()["id"]
    seeder = Prisma()
    await seeder.connect()
    await seeder.campaign.update(
        where={"id": campaign_id},
        data={
            "status": status,
            **({"metaCampaignId": f"meta_{campaign_id}"} if published else {}),
        },
    )
    await seeder.disconnect()
    return campaign_id


async def _creative(
    campaign_id: str,
    *,
    as_ad: bool = True,
    feed: str | None = None,
    story: str | None = None,
    square: str | None = None,
    card_image: str | None = None,
) -> None:
    """A creative using the given media; `as_ad` links it to an ad (published)."""
    seeder = Prisma()
    await seeder.connect()
    try:
        ad_id = None
        if as_ad:
            ad_set = await seeder.adset.create(
                data={
                    "campaignId": campaign_id,
                    "name": "Ad set",
                    "budget": 50.0,
                    "optimizationGoal": "OFFSITE_CONVERSIONS",
                    "status": "LIVE",
                }
            )
            ad = await seeder.ad.create(
                data={"adSetId": ad_set.id, "name": "Ad", "status": "LIVE"}
            )
            ad_id = ad.id
        data: CreativeCreateInput = {
            "campaignId": campaign_id,
            "headline": "Headline",
            "bodyText": "Body",
            "cta": "SHOP_NOW",
            "status": "SELECTED" if as_ad else "GENERATED",
            "format": "CAROUSEL" if card_image else "SINGLE_IMAGE",
        }
        if ad_id is not None:
            data["adId"] = ad_id
        if feed is not None:
            data["productImageId"] = feed
        if story is not None:
            data["storyProductImageId"] = story
        if square is not None:
            data["squareProductImageId"] = square
        creative = await seeder.creative.create(data=data)
        if card_image is not None:
            await seeder.creativecard.create(
                data={
                    "creativeId": creative.id,
                    "position": 0,
                    "imageUrl": "http://x/1",
                    "productImageId": card_image,
                    "headline": "Card",
                    "linkUrl": "http://x",
                }
            )
    finally:
        await seeder.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["LIVE", "PAUSED", "ARCHIVED"])
async def test_a_photo_used_as_a_published_ads_main_image_cannot_be_deleted(
    client: TestClient, status: str
) -> None:
    business_id, product_id = _setup(client)
    photo = upload_photo(client, business_id, product_id, 1080, 1350)
    other = upload_photo(client, business_id, product_id, 1080, 1080)
    campaign_id = await _campaign(client, business_id, "Rings", status=status)
    await _creative(campaign_id, feed=photo)

    response = _delete(client, business_id, product_id, photo)

    assert response.status_code == 409
    assert response.json()["detail"] == f"{PHOTO_MESSAGE} Used by: Rings."
    # Nothing was deleted, and an unused photo still can be.
    assert photo in _listed(client, business_id, product_id)
    assert _delete(client, business_id, product_id, other).status_code == 204


@pytest.mark.asyncio
@pytest.mark.parametrize("slot", ["story", "square"])
async def test_a_photo_used_as_a_stories_or_square_asset_cannot_be_deleted(
    client: TestClient, slot: str
) -> None:
    business_id, product_id = _setup(client)
    feed = upload_photo(client, business_id, product_id, 1080, 1350)
    extra = upload_photo(
        client, business_id, product_id, 1080, 1920 if slot == "story" else 1080
    )
    campaign_id = await _campaign(
        client, business_id, "Placement test", status="PAUSED"
    )
    await _creative(
        campaign_id,
        feed=feed,
        story=extra if slot == "story" else None,
        square=extra if slot == "square" else None,
    )

    response = _delete(client, business_id, product_id, extra)

    assert response.status_code == 409
    assert response.json()["detail"].startswith(PHOTO_MESSAGE)
    assert "Placement test" in response.json()["detail"]
    assert extra in _listed(client, business_id, product_id)


@pytest.mark.asyncio
async def test_a_photo_used_by_a_published_carousel_card_cannot_be_deleted(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    photo = upload_photo(client, business_id, product_id, 1080, 1080)
    campaign_id = await _campaign(client, business_id, "Carousel", status="LIVE")
    await _creative(campaign_id, card_image=photo)

    response = _delete(client, business_id, product_id, photo)

    assert response.status_code == 409
    assert response.json()["detail"] == f"{PHOTO_MESSAGE} Used by: Carousel."
    assert photo in _listed(client, business_id, product_id)


@pytest.mark.asyncio
async def test_a_video_used_by_a_published_ad_says_video(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    video = upload_video(client, business_id, product_id, 1080, 1350)
    campaign_id = await _campaign(client, business_id, "Reels test", status="LIVE")
    await _creative(campaign_id, feed=video)

    response = _delete(client, business_id, product_id, video)

    assert response.status_code == 409
    assert response.json()["detail"] == f"{VIDEO_MESSAGE} Used by: Reels test."
    assert video in _listed(client, business_id, product_id)


@pytest.mark.asyncio
async def test_the_message_names_every_published_campaign_using_it(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    photo = upload_photo(client, business_id, product_id, 1080, 1080)
    for name in ("Spring rings", None, "Autumn rings", "Spring rings"):
        campaign_id = await _campaign(client, business_id, name)
        await _creative(campaign_id, feed=photo)

    response = _delete(client, business_id, product_id, photo)

    assert response.status_code == 409
    # Each campaign once, sorted; an unnamed one is "Untitled campaign".
    assert response.json()["detail"] == (
        f"{PHOTO_MESSAGE} Used by: Autumn rings, Spring rings, Untitled campaign."
    )


@pytest.mark.asyncio
async def test_a_photo_only_a_draft_in_a_published_campaign_uses_can_be_deleted(
    client: TestClient,
) -> None:
    """An unselected draft never became an ad, so nothing on Meta shows the photo."""
    business_id, product_id = _setup(client)
    photo = upload_photo(client, business_id, product_id, 1080, 1080)
    campaign_id = await _campaign(client, business_id, "Rings", status="LIVE")
    await _creative(campaign_id, as_ad=False, feed=photo)

    assert _delete(client, business_id, product_id, photo).status_code == 204
    assert photo not in _listed(client, business_id, product_id)


@pytest.mark.asyncio
async def test_a_photo_only_an_unpublished_campaign_uses_can_be_deleted(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    photo = upload_photo(client, business_id, product_id, 1080, 1080)
    campaign_id = await _campaign(
        client, business_id, "Draft", status="ADS_GENERATED", published=False
    )
    await _creative(campaign_id, as_ad=False, feed=photo)

    assert _delete(client, business_id, product_id, photo).status_code == 204


@pytest.mark.asyncio
async def test_a_photo_a_published_ad_does_not_use_can_still_be_deleted(
    client: TestClient,
) -> None:
    """A published ad using one photo doesn't lock the product's other photos."""
    business_id, product_id = _setup(client)
    used = upload_photo(client, business_id, product_id, 1080, 1350)
    spare = upload_photo(client, business_id, product_id, 1080, 1080)
    campaign_id = await _campaign(client, business_id, "Rings")
    await _creative(campaign_id, feed=used)

    assert _delete(client, business_id, product_id, spare).status_code == 204
    assert _listed(client, business_id, product_id) == [used]


@pytest.mark.asyncio
async def test_deleting_an_unknown_photo_is_still_a_404(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    assert _delete(client, business_id, product_id, "no-such-photo").status_code == 404

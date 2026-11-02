"""Naming a batch of ads at publish time.

An ad written for a library avatar carries that avatar's slug in its name (and so
in its UTM content); every other ad is named exactly as it always was. Slugged
names are kept unique within the campaign. Nothing here renames an ad that
already exists: names are only decided for ads about to be created.
"""

from collections.abc import Sequence

from prisma import Prisma
from prisma.models import Creative

from app.core.db import db
from app.services import creative_naming
from app.services.buyer_avatars import avatars_by_id


async def plan_ad_names(
    *,
    business_id: str,
    campaign_id: str,
    creatives: Sequence[Creative],
    client: Prisma = db,
) -> dict[str, str]:
    """The name each creative's ad will carry.

    Args:
        business_id: The business, whose avatar library resolves the slugs.
        campaign_id: The campaign the ads join; its existing ad names are taken.
        creatives: The creatives about to be published.
        client: The database client; only tests pass their own.

    Returns:
        The ad name by creative id.
    """
    avatars = await avatars_by_id(
        business_id,
        sorted({c.buyerAvatarId for c in creatives if c.buyerAvatarId}),
        client=client,
    )
    taken = {
        ad.name
        for ad in await client.ad.find_many(
            where={"adSet": {"is": {"campaignId": campaign_id}}}
        )
    }
    names: dict[str, str] = {}
    for creative in creatives:
        avatar = avatars.get(creative.buyerAvatarId or "")

        def named(slug: str | None, c: Creative = creative) -> str:
            return creative_naming.ad_name(
                c.avatar, c.concept, c.headline, c.pillar, slug=slug
            )

        if avatar is None or not (creative.avatar and creative.concept):
            name = named(None)
        else:
            slug = creative_naming.free_slug(
                creative_naming.avatar_slug(avatar.name),
                lambda candidate: named(candidate) in taken,
            )
            name = named(slug)
        names[creative.id] = name
        taken.add(name)
    return names
